// SPDX-License-Identifier: MIT
(function() {
const SOROBAN_NETWORKS = {
  futurenet: {
    rpc: 'https://rpc-futurenet.stellar.org',
    explorer: 'https://futurenet.stellarchain.io',
    passphrase: 'Test SDF Future Network ; October 2022',
    horizon: 'https://horizon-futurenet.stellar.org',
  },
  testnet: {
    rpc: 'https://soroban-testnet.stellar.org',
    explorer: 'https://testnet.stellarchain.io',
    passphrase: 'Test SDF Network ; September 2015',
    horizon: 'https://horizon-testnet.stellar.org',
  },
  mainnet: {
    rpc: 'https://soroban.stellar.org',
    explorer: 'https://stellarchain.io',
    passphrase: 'Public Global Stellar Network ; September 2015',
    horizon: 'https://horizon.stellar.org',
  },
};

let freighterAddr = null;
var _nativeApi = null;
var _freighterStatus = null;

console.debug('[Soroban-DEBUG] wrapper loaded. window.freighter:', window.freighter, 'type:', typeof window.freighter, 'keys:', window.freighter ? Object.keys(window.freighter) : 'N/A');
if (window.freighter && typeof window.freighter === 'object') {
  console.debug('[Soroban-DEBUG] freighter keys:', Object.keys(window.freighter));
  ['isConnected','requestAccess','getPublicKey','getNetworkDetails','signTransaction'].forEach(function(k) {
    console.debug('[Soroban-DEBUG] window.freighter.' + k + ':', typeof window.freighter[k]);
  });
}

const trace = makeTrace('Soroban');
// === Freighter postMessage protocol ===
function _freighterMsg(type, extra) {
  var msgId = Date.now() + Math.random();
  var ms = type === 'REQUEST_PUBLIC_KEY' || type === 'REQUEST_CONNECTION_STATUS' ? 2000 : type === 'REQUEST_ACCESS' ? 60000 : 30000;
  console.debug('[Soroban-DEBUG] _freighterMsg sending', type, 'msgId:', msgId, 'timeout:', ms, 'origin:', window.location.origin);
  return new Promise(function(resolve, reject) {
    var timeout = ms ? setTimeout(function() {
      window.removeEventListener('message', listener);
      console.debug('[Soroban-DEBUG] _freighterMsg TIMEOUT', type, msgId, ms + 'ms');
      resolve(type === 'REQUEST_ACCESS' ? {} : { publicKey: '' });
    }, ms) : null;
    function listener(event) {
      if (event.source !== window) return;
      if (event.data?.source !== 'FREIGHTER_EXTERNAL_MSG_RESPONSE') return;
      var matchMsgId = event.data?.messageId;
      var matchMsgIdD = event.data?.messagedId;
      if (matchMsgId !== msgId && matchMsgIdD !== msgId) return;
      if (timeout) clearTimeout(timeout);
      window.removeEventListener('message', listener);
      console.debug('[Soroban-DEBUG] _freighterMsg RESPONSE', type, msgId, 'matched on:', matchMsgId !== undefined ? 'messageId' : 'messagedId', 'data:', event.data);
      resolve(event.data);
    }
    window.addEventListener('message', listener, false);
    window.postMessage(
      { source: 'FREIGHTER_EXTERNAL_MSG_REQUEST', messageId: msgId, type: type, ...(extra || {}) },
      window.location.origin
    );
  });
}

// === ScVal conversion ===
function _toScVal(val, stack) {
  if (val && typeof val.toXDR === 'function' && val._switch !== undefined) return val;
  stack = stack || [];
  var t = typeof val;
  var short = '';
  if (val === null) short = 'null';
  else if (val === undefined) short = 'undefined';
  else if (t === 'bigint') short = val.toString();
  else if (t === 'number') short = String(val);
  else if (t === 'boolean') short = String(val);
  else if (t === 'string') short = (val.length > 60 ? val.slice(0, 8) + '…' + val.slice(-4) : val);
  else if (t === 'object') short = Array.isArray(val) ? 'arr[' + val.length + ']' : 'obj{' + Object.keys(val).length + '}';
  else short = String(val).slice(0, 60);
  console.debug('[Soroban-DBG] _toScVal', 'depth:' + stack.length, 'typeof:' + t, 'val:', short);
  if (val === null || val === undefined) return StellarSdk.xdr.ScVal.scvVoid();
  if (typeof val === 'bigint') return new StellarSdk.ScInt(val).toI128();
  if (typeof val === 'number') return StellarSdk.nativeToScVal(val);
  if (typeof val === 'boolean') return StellarSdk.nativeToScVal(val);
  if (typeof val === 'string') {
    if (/^\d+[smhdw]$/.test(val) || /^\d+[smh]r$/.test(val) || val === 'random' || val === 'now') return StellarSdk.xdr.ScVal.scvSymbol(val);
    if ((val.startsWith('C') || val.startsWith('G')) && val.length === 56) {
      try {
        var addr = StellarSdk.Address.fromString(val);
        console.debug('[Soroban-DBG] _toScVal Address ok:', val.slice(0, 8) + '…' + val.slice(-4), 'type:', addr.type || (val.startsWith('G') ? 'account' : 'contract'));
        return addr.toScVal();
      } catch (e) {
        console.warn('[Soroban-DBG] _toScVal Address FAILED:', val.slice(0, 8) + '…' + val.slice(-4), 'error:', e.message, e.stack);
      }
    }
    return StellarSdk.xdr.ScVal.scvString(val);
  }
  if (Array.isArray(val)) return StellarSdk.xdr.ScVal.scvVec(val.map(function(v) { return _toScVal(v, stack.concat(['arr'])); }));
  if (typeof val === 'object') {
    var entries = Object.entries(val).map(function(e) {
      var key;
      if (typeof e[0] === 'string' && e[0].length === 56 && (e[0].startsWith('C') || e[0].startsWith('G'))) {
        try {
          key = StellarSdk.Address.fromString(e[0]).toScVal();
          console.debug('[Soroban-DBG] _toScVal map-key Address ok:', e[0].slice(0, 8) + '…' + e[0].slice(-4));
        } catch (ee) {
          console.warn('[Soroban-DBG] _toScVal map-key Address FAILED for key:', e[0].slice(0, 8) + '…' + e[0].slice(-4), 'error:', ee.message);
          key = StellarSdk.xdr.ScVal.scvSymbol(e[0]);
        }
      } else {
        key = StellarSdk.xdr.ScVal.scvSymbol(e[0]);
      }
      return new StellarSdk.xdr.ScMapEntry({ key: key, val: _toScVal(e[1], stack.concat(['map-val'])) });
    });
    var sortedResult = StellarSdk.xdr.scvSortedMap(entries);
    var sortedKeys = entries.map(function(en) {
      try { return StellarSdk.scValToNative(en.key()); } catch (_) { return '?'; }
    }).join(', ');
    console.debug('[Soroban-DBG] _toScVal scvSortedMap done, entry count:', entries.length, 'sorted keys:', sortedKeys);
    return sortedResult;
  }
  return StellarSdk.xdr.ScVal.scvString(String(val));
}

function _parseSimResult(simRes) {
  if (!simRes) return null;
  try {
    var results = simRes.results;
    if (!results || !results[0] || !results[0].xdr) return null;
    var scval = StellarSdk.xdr.ScVal.fromXDR(results[0].xdr, 'base64');
    return StellarSdk.scValToNative(scval);
  } catch (e) {
    console.warn('[Soroban] parseSimResult failed:', e.message);
    return null;
  }
}

// === Transaction building ===
function _buildTx(source, seqNum, contract, method, args, passphrase) {
  var pk = StellarSdk.Keypair.random().publicKey();
  var account = new StellarSdk.Account(source || pk, seqNum || '0');
  return new StellarSdk.TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: passphrase,
  })
    .addOperation(StellarSdk.Operation.invokeContractFunction({
      contract: contract,
      function: method,
      args: (args || []).map(function(a) { return _toScVal(a); }),
      auth: [],
    }))
    .setTimeout(300)
    .build();
}

function _passphrase(network) {
  var cfg = SOROBAN_NETWORKS[network];
  return cfg ? cfg.passphrase : 'Test SDF Network ; September 2015';
}

function _horizonUrl(network) {
  var cfg = SOROBAN_NETWORKS[network];
  return cfg ? cfg.horizon : 'https://horizon-testnet.stellar.org';
}

function _toContractOrder(order) {
  var c = {
    amount_to_sell: { amounts: {}, shares: BigInt(order.sharesIn || 0) },
    min_to_receive: { amounts: {}, shares: BigInt(order.minSharesOut || 0) },
  };
  for (var i = 0; i < (order.tokensIn || []).length; i++) c.amount_to_sell.amounts[order.tokensIn[i]] = BigInt(order.amountsIn[i]);
  for (var i = 0; i < (order.tokensOut || []).length; i++) c.min_to_receive.amounts[order.tokensOut[i]] = BigInt(order.amountsOut[i]);
  return c;
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Soroban',
  logo: 'img/logos/stellar.svg',
  defaultRpc: SOROBAN_NETWORKS.testnet.rpc,
  defaultFactory: 'CBTL3ATX5ARWSC2DCIDIOJIIXDDTNLFTBGPB2VSN4LBYPOPJIXNX4EFC',
  network: 'testnet',
  chainId: null,
  explorer: SOROBAN_NETWORKS.testnet.explorer,
  configs: SOROBAN_NETWORKS,
  _poolConfigCache: {},

  setNetwork(network) {
    var cfg = SOROBAN_NETWORKS[network];
    if (!cfg) throw new Error('Unknown network: ' + network + '. Supported: ' + Object.keys(SOROBAN_NETWORKS).join(', '));
    this.defaultRpc = cfg.rpc;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log('%c[Soroban] %cNetwork: ' + network, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() {
    _nativeApi = (window.freighter && (typeof window.freighter.isConnected === 'function' || typeof window.freighter.requestAccess === 'function')) ? window.freighter : null;
    console.debug('[Soroban-DEBUG] loadSDK _nativeApi:', !!_nativeApi, 'window.freighter:', window.freighter);
    if (_nativeApi && typeof _nativeApi.isConnected === 'function') {
      try {
        console.debug('[Soroban-DEBUG] loadSDK calling native isConnected...');
        var s = await _nativeApi.isConnected();
        console.debug('[Soroban-DEBUG] loadSDK native isConnected returned:', s);
        _freighterStatus = { isConnected: !!(s && s.isConnected) };
        console.debug('[Soroban-DEBUG] loadSDK native path done, freighter:', _freighterStatus);
      } catch (e) {
        console.debug('[Soroban-DEBUG] loadSDK native isConnected threw:', e.message);
        _freighterStatus = null;
      }
      return typeof StellarSdk !== 'undefined';
    }
    console.debug('[Soroban-DEBUG] loadSDK no native API, using postMessage');
    try {
      var status = await _freighterMsg('REQUEST_CONNECTION_STATUS');
      console.debug('[Soroban-DEBUG] loadSDK postMessage status:', status);
      if (status && status.isConnected) {
        _freighterStatus = { isConnected: true };
      } else if (status && status.publicKey) {
        _freighterStatus = { isConnected: true, publicKey: status.publicKey };
      } else {
        _freighterStatus = { isConnected: false };
      }
    } catch (_) {
      _freighterStatus = null;
    }
    return typeof StellarSdk !== 'undefined';
  },

  async connectWallet() {
    var pubKeyResp;
    console.debug('[Soroban-DEBUG] connectWallet _nativeApi:', !!_nativeApi, '_nativeApi?.requestAccess:', typeof (_nativeApi && _nativeApi.requestAccess));
    if (_nativeApi && typeof _nativeApi.requestAccess === 'function') {
      try {
        console.debug('[Soroban-DEBUG] connectWallet calling native requestAccess...');
        pubKeyResp = await _nativeApi.requestAccess();
        console.debug('[Soroban-DEBUG] connectWallet native requestAccess returned:', pubKeyResp);
      } catch (e) {
        console.debug('[Soroban-DEBUG] connectWallet native requestAccess threw:', e.message);
        throw new Error('Freighter rejected connection: ' + e.message);
      }
      if (pubKeyResp && pubKeyResp.error) {
        throw new Error('Freighter rejected connection: ' + (pubKeyResp.error.message || pubKeyResp.error));
      }
      freighterAddr = pubKeyResp.address || pubKeyResp.publicKey;
      if (!freighterAddr) throw new Error('Freighter is locked — please unlock it first, then connect');
    } else {
      console.debug('[Soroban-DEBUG] connectWallet no native API, using postMessage');
      try {
        pubKeyResp = await _freighterMsg('REQUEST_ACCESS');
        console.debug('[Soroban-DEBUG] connectWallet postMessage returned:', pubKeyResp);
      } catch (e) {
        console.debug('[Soroban-DEBUG] connectWallet postMessage threw:', e.message);
        throw new Error('Freighter wallet not installed — download from https://freighter.app');
      }
      if (pubKeyResp && pubKeyResp.apiError) {
        throw new Error('Freighter rejected connection: ' + (pubKeyResp.apiError.message || 'access denied'));
      }
      if (!pubKeyResp || !pubKeyResp.publicKey) {
        throw new Error('Freighter is locked — please unlock it first, then connect');
      }
      freighterAddr = pubKeyResp.publicKey;
    }
    console.log('%c[Soroban] %cconnectWallet', 'color:#888', 'color:#3dcf8e', this.shortenAddress(freighterAddr));

    var netName = this.network;
    if (_nativeApi && typeof _nativeApi.getNetworkDetails === 'function') {
      try {
        var netResp = await _nativeApi.getNetworkDetails();
        if (netResp && netResp.network) {
          var matched = false;
          for (var k in SOROBAN_NETWORKS) {
            if (SOROBAN_NETWORKS[k].passphrase === netResp.networkPassphrase) {
              if (this.network !== k) this.setNetwork(k);
              matched = true;
              netName = k;
              break;
            }
          }
          if (!matched) {
            console.warn('[Soroban] Freighter on unknown network: ' + netResp.network + ', using UI setting');
          }
        }
      } catch (e) {
        console.warn('[Soroban] Could not get network from Freighter, using UI setting');
      }
    } else {
      try {
        var netResp = await _freighterMsg('REQUEST_NETWORK_DETAILS');
        if (netResp && netResp.networkDetails && netResp.networkDetails.network) {
          netName = netResp.networkDetails.network;
          var matched = false;
          for (var k in SOROBAN_NETWORKS) {
            if (SOROBAN_NETWORKS[k].passphrase === netResp.networkDetails.networkPassphrase) {
              if (this.network !== k) this.setNetwork(k);
              matched = true;
              netName = k;
              break;
            }
          }
          if (!matched) {
            console.warn('[Soroban] Freighter on unknown network: ' + netResp.networkDetails.network + ', using UI setting');
          }
        }
      } catch (e) {
        console.warn('[Soroban] Could not get network from Freighter, using UI setting');
      }
    }

    return { account: freighterAddr, provider: null, networkName: netName };
  },

  async _simulate(contract, method, args) {
    if (typeof StellarSdk === 'undefined') throw new Error('StellarSdk not loaded');
    var pp = _passphrase(this.network);
    var tx = _buildTx(null, '0', contract, method, args, pp);
    var xdr = tx.toEnvelope().toXDR('base64');
    var res = await this.rpcCall(this.defaultRpc, 'simulateTransaction', { transaction: xdr });
    if (res.error) throw new Error(res.error);
    return _parseSimResult(res);
  },

  async _send(contract, method, args) {
    if (typeof StellarSdk === 'undefined') throw new Error('StellarSdk not loaded');
    if (!freighterAddr) throw new Error('Connect Freighter first');

    var pp = _passphrase(this.network);

    // 1. Get sequence number from Horizon
    var seqNum = '0';
    try {
      var horizonUrl = _horizonUrl(this.network);
      var acctResp = await fetch(horizonUrl + '/accounts/' + freighterAddr);
      if (acctResp.ok) {
        var acctData = await acctResp.json();
        seqNum = acctData.sequence;
      }
    } catch (e) {
      try {
        // Fallback: get seq num from RPC getLedgerEntries
        var raw = StellarSdk.StrKey.decodeEd25519PublicKey(freighterAddr);
        var kp = StellarSdk.Keypair.fromPublicKey(raw);
        var key = StellarSdk.xdr.LedgerKey.account(kp.xdrAccountId()).toXDR('base64');
        var ledgerResp = await this.rpcCall(this.defaultRpc, 'getLedgerEntries', { keys: [key] });
        if (ledgerResp && ledgerResp.entries && ledgerResp.entries[0]) {
          var entry = StellarSdk.xdr.LedgerEntry.fromXDR(ledgerResp.entries[0].xdr, 'base64');
          seqNum = entry.data.account().seqNum().toString();
        } else {
          throw new Error('Account not found on ledger');
        }
      } catch (e2) {
        throw new Error('Cannot get sequence number: fund your account first');
      }
    }

    // 2. Build transaction
    console.debug('[Soroban-DBG] _send building tx:', {
      contract: (contract || '').slice(0, 8) + '…' + (contract || '').slice(-4),
      method: method,
      args_count: (args || []).length,
      args_types: (args || []).map(function(a) { return typeof a === 'object' && !Array.isArray(a) && a !== null ? 'obj{' + Object.keys(a).length + '}' : typeof a; }),
    });
    var tx = _buildTx(freighterAddr, seqNum, contract, method, args, pp);
    var txXdr = tx.toEnvelope().toXDR('base64');

    // 3. Simulate
    var simRes = await this.rpcCall(this.defaultRpc, 'simulateTransaction', { transaction: txXdr });
    console.debug('[Soroban-DBG] _send simulateTransaction result:', JSON.parse(JSON.stringify(simRes)));
    if (simRes.error) {
      console.warn('[Soroban-DBG] _send simRes.error:', simRes.error, 'simRes.result:', simRes.result, 'simRes.transactionData:', simRes.transactionData);
      throw new Error(simRes.error);
    }

    // 4. Assemble with simulation (adds footprint, auth, resource fee)
    var builder;
    try {
      builder = StellarSdk.rpc.assembleTransaction(tx, simRes);
    } catch (e) {
      // If assembleTransaction fails (restore needed or auth issue), try direct signing
      throw new Error('Transaction assembly failed: ' + e.message);
    }
    var assembledTx = builder.build();
    var assembledXdr = assembledTx.toEnvelope().toXDR('base64');
    console.debug('[Soroban-DBG] _send assembledTx XDR (base64 first 120):', assembledXdr.slice(0, 120));

    // 5. Sign with Freighter
    var signResp;
    try {
      signResp = await _freighterMsg('SUBMIT_TRANSACTION', {
        transactionXdr: assembledXdr,
        networkPassphrase: pp,
      });
    } catch (e) {
      throw new Error('Freighter signing failed: ' + e.message);
    }
    if (!signResp || !signResp.signedTransaction) {
      throw new Error('Freighter rejected the transaction');
    }

    // 6. Submit signed transaction
    var sendResp = await this.rpcCall(this.defaultRpc, 'sendTransaction', { transaction: signResp.signedTransaction });
    if (sendResp.error) {
      console.warn('[Soroban-DBG] _send sendTransaction error:', sendResp.error);
      throw new Error(sendResp.error);
    }
    var hash = sendResp.hash || sendResp.txHash || sendResp.id;
    console.log('%c[Soroban] %ctransaction: ' + hash, 'color:#888', 'color:#3dcf8e');

    // 7. Poll getTransaction until included or timeout
    var deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      var txResp = await this.rpcCall(this.defaultRpc, 'getTransaction', { hash: hash });
      if (txResp.status === 'SUCCESS') {
        console.log('%c[Soroban] %ctransaction confirmed in ledger', 'color:#888', 'color:#3dcf8e');
        delete this._poolConfigCache[contract];
        return hash;
      }
      if (txResp.status === 'FAILED') {
        throw new Error('Transaction failed: ' + JSON.stringify(txResp.result || txResp));
      }
      await new Promise(function(r) { setTimeout(r, 2000); });
    }
    throw new Error('Transaction not included after 30s — try again');
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      var r = await this._simulate(poolAddr, 'get_balances', []);
      var map = r || {};
      return {
        tokens: Object.keys(map),
        amounts: Object.values(map).map(BigInt),
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      var r = await this._simulate(poolAddr, 'get_status', []);
      if (!r) return { supply: 0n, atrSpread: 0n, spreadAdditive: 0n };
      return {
        supply: BigInt(r[0] ?? 0),
        atrSpreadTarget: BigInt(r[1] ?? 0),
        emaSpreadTarget: BigInt(r[2] ?? 0),
        atrPeriod: BigInt(r[3] ?? 0),
        emaPeriod: BigInt(r[4] ?? 0),
        atrSpread: BigInt(r[5] ?? 0),
        spreadAdditive: BigInt(r[6] ?? 0),
        avgSpread: BigInt(r[7] ?? 0),
        spreadMultiplier: BigInt(r[8] ?? 0),
        lpRoyalties: r[9] ?? [],
        txs: BigInt(r[10] ?? 0),
      };
    });
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      var r = await this._simulate(poolAddr, 'get_tvwap_state', []);
      if (!r) return {};
      var w15 = r[0] || {};
      var w1h = r[1] || {};
      var w24 = r[2] || {};
      return {
        tvwap15m: BigInt(w15.tvwap ?? 0),
        accK15m: BigInt(w15.acc_k ?? 0),
        accW15m: BigInt(w15.acc_w ?? 0),
        windowStart15m: BigInt(w15.start ?? 0),
        tvwap1hr: BigInt(w1h.tvwap ?? 0),
        accK1hr: BigInt(w1h.acc_k ?? 0),
        accW1hr: BigInt(w1h.acc_w ?? 0),
        windowStart1hr: BigInt(w1h.start ?? 0),
        tvwap24hr: BigInt(w24.tvwap ?? 0),
        accK24hr: BigInt(w24.acc_k ?? 0),
        accW24hr: BigInt(w24.acc_w ?? 0),
        windowStart24hr: BigInt(w24.start ?? 0),
        lastTimestamp: BigInt(r[3] ?? 0),
        currentK: await this.getKonstant(poolAddr),
      };
    });
  },

  async consult(poolAddr, window) {
    return trace('consult(' + window + ')')(async () => {
      var val = window === 'now' ? 0 : Number(window);
      var r = await this._simulate(poolAddr, 'consult', [val]);
      return BigInt(r ?? 0);
    });
  },

  async getTvwapPrices(poolAddr, secondsAgo) {
    return trace('getTvwapPrices')(async () => {
      var tvwapK = await this.consult(poolAddr, secondsAgo);
      var bals = await this.getBalances(poolAddr);
      var tokens = bals.tokens || [];
      var balances = (bals.amounts || []).map(BigInt);
      return window.reciprocity_math.getTvwapPrices(tvwapK, balances, tokens);
    });
  },

  async getLPToken(poolAddr) {
    try {
      var r = await this._simulate(poolAddr, 'get_lp_token', []);
      if (r) return String(r);
    } catch (e) {}
    return poolAddr;
  },

  async getSupply(poolAddr) {
    var r = await this._simulate(poolAddr, 'get_supply', []);
    return BigInt(r ?? 0);
  },

  async getKonstant(poolAddr) {
    return await this.consult(poolAddr, 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      var cached = this._poolConfigCache[poolAddr];
      if (cached) return cached;
      var r = await this._simulate(poolAddr, 'get_pool_config', []);
      var wgt;
      try { wgt = await this._simulate(poolAddr, 'get_weights', []).catch(() => []); } catch(e) { wgt = []; }
      var config = {
        tokens: (r && (r.tokens || r[0]) || []).map(String),
        balances: Object.values(r && (r.balances || r[1]) || {}).map(BigInt),
        genesis: Object.values(r && (r.genesis || r[2]) || {}).map(BigInt),
        factors: Number((r && (r.factors ?? r[3])) ?? 0),
        scale: BigInt((r && (r.scale ?? r[4])) ?? 0),
        atr_spread_target: BigInt((r && (r.atr_spread_target ?? r[5])) ?? ATR_SPREAD_TARGET),
        ema_spread_target: BigInt((r && (r.ema_spread_target ?? r[6])) ?? EMA_SPREAD_TARGET),
        atr_period: BigInt((r && (r.atr_period ?? r[7])) ?? 0),
        ema_period: BigInt((r && (r.ema_period ?? r[8])) ?? 0),
        spread_multiplier: BigInt((r && (r.spread_multiplier ?? r[9])) ?? BASIS),
        supply: BigInt((r && (r.supply ?? r[10])) ?? 0),

        weights: (wgt || []).map(BigInt),
      };
      this._poolConfigCache[poolAddr] = config;
      return config;
    });
  },

  async _onchainQuoteSwap(poolAddr, order) {
    var r = await this._simulate(poolAddr, 'quote_swap', [_toContractOrder(order)]);
    if (!r) return null;
    var quote = r.ok || r;
    var tokensOutMap = quote.tokens_out || {};
    var feesMap = quote.fees || {};
    var outTokens = order.tokensOut || [];
    var outAmounts = new Array(outTokens.length).fill(0n);
    var feeAmounts = new Array(outTokens.length).fill(0n);
    for (var i = 0; i < outTokens.length; i++) {
      var addr = outTokens[i];
      if (tokensOutMap[addr] !== undefined) outAmounts[i] = BigInt(tokensOutMap[addr]);
      if (feesMap[addr] !== undefined) feeAmounts[i] = BigInt(feesMap[addr]);
    }
    return {
      tokensOut: outTokens,
      amountsOut: outAmounts,
      reciprocity: BigInt(quote.reciprocity ?? 0),
      feeAmounts: feeAmounts,
    };
  },

  // verifyQuote inherited from chainAPI_base

  // ponytail: view-only quote via quote_swap — checks reciprocity sign but
  // not auth, deadlines, or resource fees. Use _send-based simulation (build
  // a swap tx → simulateTransaction) for full validation before mainnet.
  async simulateSwap(poolAddr, order) {
    return this._onchainQuoteSwap(poolAddr, order);
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      return await this._send(poolAddr, 'swap', [freighterAddr, _toContractOrder(order), deadlineTs]);
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () => {
      var tokensIn = {};
      for (var i = 0; i < tokens.length; i++) {
        tokensIn[tokens[i]] = BigInt(amounts[i]);
      }
      console.debug('[Soroban-DBG] addLiquidity args:', {
        poolAddr: (poolAddr || '').slice(0, 8) + '…' + (poolAddr || '').slice(-4),
        freighterAddr: (freighterAddr || '').slice(0, 8) + '…' + (freighterAddr || '').slice(-4),
        tokensIn_keys: Object.keys(tokensIn).map(function(k) { return k.slice(0, 6) + '…' + k.slice(-4); }),
        tokensIn_vals: Object.values(tokensIn).map(function(v) { return v.toString(); }),
        minShares: String(minShares),
      });
      console.debug('[Soroban-DBG] addLiquidity tokensIn raw:', tokensIn);
      return await this._send(poolAddr, 'add_liquidity', [freighterAddr, tokensIn, BigInt(minShares), weights || [], BigInt(atrSpreadTarget || 0), BigInt(emaSpreadTarget || 0), BigInt(atrPeriod || 0), BigInt(emaPeriod || 0), deadlineTs]);
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      var pd = await this.getPoolConfig(poolAddr);
      var minTokens = {};
      for (var i = 0; i < pd.tokens.length; i++) {
        if (i < minTokensOut.length) {
          minTokens[pd.tokens[i]] = BigInt(minTokensOut[i]);
        }
      }
      return await this._send(poolAddr, 'remove_liquidity', [freighterAddr, BigInt(shares), minTokens, deadlineTs]);
    });
  },

  async getTokenSymbol(tokenAddr) {
    try {
      var r = await this._simulate(tokenAddr, 'symbol', []);
      if (r) return String(r);
    } catch (e) {}
    return this.shortenAddress(tokenAddr);
  },

  async getTokenDecimals(tokenAddr) {
    try {
      var r = await this._simulate(tokenAddr, 'decimals', []);
      if (r !== null && r !== undefined) return Number(r);
    } catch (e) {}
    return 7;
  },

  async getTokenBalance(tokenAddr, account) {
    try {
      var r = await this._simulate(tokenAddr, 'balance', [account]);
      return BigInt(r ?? 0);
    } catch (e) { return 0n; }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    try {
      var r = await this._simulate(tokenAddr, 'balance', [poolAddr]);
      return BigInt(r ?? 0);
    } catch (e) { return 0n; }
  },

  async approveIfNeeded(tokenAddr, spender, owner, amount) {
    var a = 0n;
    try {
      a = BigInt(await this._simulate(tokenAddr, 'allowance', [owner, spender]) ?? 0);
      console.debug('[Soroban-DBG] approveIfNeeded allowance:', { token: (tokenAddr || '').slice(0, 8) + '…', spender: (spender || '').slice(0, 8) + '…', owner: (owner || '').slice(0, 8) + '…', allowance: a.toString(), amount: String(amount) });
    } catch (e) {
      console.debug('[Soroban-DBG] approveIfNeeded allowance call failed:', e.message);
    }
    if (a < BigInt(amount)) {
      var ledgerInfo = await this.rpcCall(this.defaultRpc, 'getLatestLedger', {});
      var curLedger = Number(ledgerInfo?.sequence ?? 0);
      if (curLedger === 0) throw new Error('Cannot determine current ledger for expiration');
      var expiry = Math.min(curLedger + 17280, 0xFFFFFFFF);
      console.debug('[Soroban-DBG] approveIfNeeded approving', { token: (tokenAddr || '').slice(0, 8) + '…', amount: String(amount), curLedger: curLedger, expiry: expiry });
      var expScVal = StellarSdk.xdr.ScVal.scvU32(expiry);
      return await this._send(tokenAddr, 'approve', [owner, spender, BigInt(amount), expScVal]);
    } else {
      console.debug('[Soroban-DBG] approveIfNeeded already sufficient, skipping');
    }
  },

  async getPoolCount(factoryAddr) {
    try {
      var r = await this._simulate(factoryAddr, 'get_pool_count', []);
      return Number(r ?? 0);
    } catch (e) { return 0; }
  },

  async getPools(factoryAddr) {
    try {
      var r = await this._simulate(factoryAddr, 'get_pools', []);
      return (r || []).map(String);
    } catch (e) { return []; }
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () =>
      this._send(poolAddr, 'set_founder', [freighterAddr, newFounder])
    );
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () =>
      this._send(poolAddr, 'set_founder_fund', [freighterAddr, fund])
    );
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () =>
      this._send(poolAddr, 'claim_founder_royalty', [freighterAddr, token])
    );
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () =>
      this._send(poolAddr, 'set_promoter', [freighterAddr, newPromoter])
    );
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () =>
      this._send(poolAddr, 'set_promoter_fund', [freighterAddr, fund])
    );
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () =>
      this._send(poolAddr, 'claim_promoter_royalty', [freighterAddr, token])
    );
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      var r = await this._simulate(poolAddr, 'get_admin_state', []);
      if (!r) return {};
      return {
        factory: r[0] || null,
        founder: r[1] || null,
        founderFund: r[2] || null,
        promoter: r[3] || null,
        promoterFund: r[4] || null,
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      try {
        var r = await this._simulate(poolAddr, 'get_founder_royalties', []);
        return { tokens: Object.keys(r || {}), amounts: Object.values(r || {}).map(BigInt) };
      } catch (e) { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        var r = await this._simulate(poolAddr, 'get_promoter_royalties', []);
        return { tokens: Object.keys(r || {}), amounts: Object.values(r || {}).map(BigInt) };
      } catch (e) { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      var r = await this._simulate(poolAddr, 'get_founder_royalties', []);
      var map = r || {};
      return BigInt(map[token] ?? 0);
    } catch (e) { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      var r = await this._simulate(poolAddr, 'get_promoter_royalties', []);
      var map = r || {};
      return BigInt(map[token] ?? 0);
    } catch (e) { return 0n; }
  },

  isValidAddress(addr) {
    if (typeof addr !== 'string') return false;
    if (addr.length !== 56) return false;
    return addr.startsWith('G') || addr.startsWith('C');
  },

  async getBlock() {
    const ledgerInfo = await this.rpcCall(this.defaultRpc, 'getLatestLedger', {});
    return { currentBlock: Number(ledgerInfo.sequence) };
  },

  async getLastTxBlock(poolAddr) {
    const result = await this.rpcCall(this.defaultRpc, 'getTransactions', [{
      filters: [{ contractId: poolAddr }],
      limit: 1,
      order: 'desc',
    }]);
    if (result.transactions && result.transactions.length > 0) return Number(result.transactions[0].ledger);
    return null;
  },

  async getNonce(poolAddr) {
    // Direct simulate to avoid trace logging in the 2s polling loop
    const r = await this._simulate(poolAddr, 'get_status', []);
    return r ? Number(r[10] ?? 0) : 0;
  },
});

window.chainAPI_soroban = chainAPI;
})();
