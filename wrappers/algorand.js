// SPDX-License-Identifier: MIT
(function() {
const trace = makeTrace('Algorand');

const ALGOD_NETWORKS = {
  testnet: {
    rpc: 'https://testnet-api.algonode.cloud',
    indexer: 'https://testnet-idx.algonode.cloud',
    explorer: 'https://testnet.algoexplorer.io',
  },
  mainnet: {
    rpc: 'https://mainnet-api.algonode.cloud',
    indexer: 'https://mainnet-idx.algonode.cloud',
    explorer: 'https://algoexplorer.io',
  },
};

const ALGO_CDNS = [
  'https://cdn.jsdelivr.net/npm/algosdk@v2/dist/browser/algosdk.min.js',
  'https://unpkg.com/algosdk@v2/dist/browser/algosdk.min.js',
];

let algodClient = null;
let algosdk = null;
let walletAddr = null;

function decodeBox64(data) {
  const vals = [];
  for (let i = 0; i < data.length; i += 8) {
    vals.push(Number(algosdk.decodeUint64(data.slice(i, i + 8), 'safe')));
  }
  return vals;
}

function decodeBox8(data) {
  const vals = [];
  for (let i = 0; i < data.length; i += 1) {
    vals.push(data[i]);
  }
  return vals;
}

function parseGlobalState(state) {
  const kv = {};
  for (const s of state) {
    const key = decodeText(s.key);
    const val = s.value;
    kv[key] = val.type === 1 ? val.bytes : val.uint;
  }
  return kv;
}

function decodeText(arr) {
  try { return new TextDecoder().decode(arr); } catch { return String.fromCharCode(...arr); }
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Algorand',
  logo: 'img/logos/algorand.svg',
  defaultRpc: ALGOD_NETWORKS.testnet.rpc,
  defaultFactory: null,
  network: 'testnet',
  chainId: null,
  explorer: ALGOD_NETWORKS.testnet.explorer,
  configs: ALGOD_NETWORKS,

  setNetwork(network) {
    const cfg = ALGOD_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(ALGOD_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.defaultFactory = cfg.factory;
    this.explorer = cfg.explorer;
    this.network = network;
    algodClient = new algosdk.Algodv2('', cfg.rpc);
    console.log(`%c[Algorand] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
    console.log(`  RPC: ${cfg.rpc}`);
    console.log(`  Explorer: ${cfg.explorer}`);
  },

  async loadSDK() {
    if (typeof algosdk !== 'undefined' && algosdk) return true;
    for (const url of ALGO_CDNS) {
      try {
        await this.loadScript(url);
        if (typeof window.algosdk !== 'undefined') {
          algosdk = window.algosdk;
          const cfg = ALGOD_NETWORKS[this.network || 'testnet'];
          algodClient = new algosdk.Algodv2('', cfg.rpc);
          return true;
        }
      } catch {}
    }
    return false;
  },

  async connectWallet() {
    if (typeof window.algorand === 'undefined') throw new Error('Pera Wallet not detected');
    const accounts = await window.algorand.connect();
    walletAddr = accounts[0];
    console.log(`%c[Algorand] %cconnectWallet`, 'color:#888', 'color:#3dcf8e', this.shortenAddress(walletAddr));
    return { account: walletAddr, provider: null, networkName: this.network };
  },

  _appId(poolAddr) { return Number(poolAddr); },

  async _readGlobal(appId) {
    const info = await algodClient.getApplicationByID(appId).do();
    return parseGlobalState(info.params['global-state']);
  },

  async _readBox(appId, name) {
    const enc = new TextEncoder();
    const box = await algodClient.getApplicationBoxByName(appId, enc.encode(name)).do();
    return box.value;
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const appId = this._appId(poolAddr);
      const [balData, tokData, decData] = await Promise.all([
        this._readBox(appId, 'b'),
        this._readBox(appId, 't'),
        this._readBox(appId, 'd'),
      ]);
      const tokens = decodeBox64(tokData).filter(t => t !== 0).map(String);
      const amounts = decodeBox64(balData).filter(a => a !== 0).map(BigInt);
      const decimals = decodeBox8(decData).slice(0, tokens.length).map(Number);
      return { tokens, amounts, decimals };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const gs = await this._readGlobal(this._appId(poolAddr));
      return {
        supply: BigInt(gs.s || 0),
        atrSpreadTarget: BigInt(gs.at || 0),
        emaSpreadTarget: BigInt(gs.et || 0),
        atrPeriod: BigInt(gs.ap || 0),
        emaPeriod: BigInt(gs.ep || 0),
        atrSpread: BigInt(gs.ar || 0),
        spreadAdditive: BigInt(gs.sa || 0),
        txs: BigInt(gs.tx || 0),
      };
    });
  },

  async getTvwapPrices(poolAddr, secondsAgo) {
    return trace(`getTvwapPrices(${secondsAgo}s)`)(async () => {
      const tvwapK = await this.consult(poolAddr, secondsAgo);
      const bals = await this.getBalances(poolAddr);
      return window.reciprocity_math.getTvwapPrices(tvwapK, bals.amounts, bals.tokens);
    });
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const appId = this._appId(poolAddr);
      const args = [new TextEncoder().encode('ts')];
      const params = await algodClient.getTransactionParams().do();
      const txn = algosdk.makeApplicationCallTxnFromObject({
        from: walletAddr,
        appIndex: appId,
        onComplete: algosdk.OnApplicationComplete.NoPromoOC,
        appArgs: args,
        suggestedParams: params,
      });
      const dryrun = await algodClient.simulateTransactions(
        new algosdk.SimulateRequest({ txnGroups: [{ txns: [txn] }] })
      ).do();
      const logs = dryrun?.txnGroups?.[0]?.txnResults?.[0]?.txn?.logs || [];
      let combined = new Uint8Array(0);
      for (const log of logs) {
        const bytes = typeof log === 'string' ? algosdk.base64ToBytes(log) : log;
        combined = algosdk.mergeUint8Arrays(combined, bytes);
      }
      const vals = [];
      for (let i = 0; i < combined.length; i += 8) {
        vals.push(algosdk.decodeUint64(combined.slice(i, i + 8), 'safe'));
      }
      return {
        tvwap15m: BigInt(vals[0] || 0),
        accW15m: BigInt(vals[1] || 0),
        windowStart15m: BigInt(vals[2] || 0),
        tvwap1hr: BigInt(vals[3] || 0),
        accW1hr: BigInt(vals[4] || 0),
        windowStart1hr: BigInt(vals[5] || 0),
        tvwap24hr: BigInt(vals[6] || 0),
        accW24hr: BigInt(vals[7] || 0),
        windowStart24hr: BigInt(vals[8] || 0),
        lastTimestamp: BigInt(vals[9] || 0),
        currentK: BigInt(vals[10] || 0),
      };
    });
  },

  async consult(poolAddr, secondsAgo) {
    return trace(`consult(${secondsAgo}s)`)(async () => {
      const appId = this._appId(poolAddr);
      const args = [
        new TextEncoder().encode('c'),
        algosdk.encodeUint64(Number(secondsAgo)),
      ];
      const params = await algodClient.getTransactionParams().do();
      const txn = algosdk.makeApplicationCallTxnFromObject({
        from: walletAddr,
        appIndex: appId,
        onComplete: algosdk.OnApplicationComplete.NoPromoOC,
        appArgs: args,
        suggestedParams: params,
      });
      const dryrun = await algodClient.simulateTransactions(
        new algosdk.SimulateRequest({ txnGroups: [{ txns: [txn] }] })
      ).do();
      const logs = dryrun?.txnGroups?.[0]?.txnResults?.[0]?.txn?.logs || [];
      let combined = new Uint8Array(0);
      for (const log of logs) {
        const bytes = typeof log === 'string' ? algosdk.base64ToBytes(log) : log;
        combined = algosdk.mergeUint8Arrays(combined, bytes);
      }
      const val = combined.length >= 8 ? algosdk.decodeUint64(combined.slice(0, 8), 'safe') : 0;
      return BigInt(val);
    });
  },

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const appId = this._appId(poolAddr);
    const args = [new TextEncoder().encode('gs')];
    const params = await algodClient.getTransactionParams().do();
    const txn = algosdk.makeApplicationCallTxnFromObject({
      from: walletAddr,
      appIndex: appId,
      onComplete: algosdk.OnApplicationComplete.NoPromoOC,
      appArgs: args,
      suggestedParams: params,
    });
    const dryrun = await algodClient.simulateTransactions(
      new algosdk.SimulateRequest({ txnGroups: [{ txns: [txn] }] })
    ).do();
    const logs = dryrun?.txnGroups?.[0]?.txnResults?.[0]?.txn?.logs || [];
    let combined = new Uint8Array(0);
    for (const log of logs) {
      const bytes = typeof log === 'string' ? algosdk.base64ToBytes(log) : log;
      combined = algosdk.mergeUint8Arrays(combined, bytes);
    }
    const val = combined.length >= 8 ? algosdk.decodeUint64(combined.slice(0, 8), 'safe') : 0;
    return BigInt(val);
  },

  async getKonstant(poolAddr) {
    return this.consult(poolAddr, 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const appId = this._appId(poolAddr);
      const gs = await this._readGlobal(appId);
      const [balData, tokData, genData, wgtData] = await Promise.all([
        this._readBox(appId, 'b'),
        this._readBox(appId, 't'),
        this._readBox(appId, 'g'),
        this._readBox(appId, 'w'),
      ]);
      const tokens = decodeBox64(tokData).filter(t => t !== 0).map(String);
      const balances = decodeBox64(balData).filter(b => b !== 0).map(BigInt);
      const genesis = decodeBox64(genData).filter(g => g !== 0).map(BigInt);
      const weights = decodeBox64(wgtData).slice(0, tokens.length).map(BigInt);
      return {
        tokens,
        balances,
        genesis,
        factors: Number(gs.f || tokens.length),
        scale: BigInt(gs.sc || 0),
        atr_spread_target: BigInt(gs.at || ATR_SPREAD_TARGET),
        ema_spread_target: BigInt(gs.et || EMA_SPREAD_TARGET),
        atr_period: BigInt(gs.ap || ATR_PERIOD),
        ema_period: BigInt(gs.ep || EMA_PERIOD),
        atr_spread: BigInt(gs.ar || 0),
        spread_multiplier: BigInt(gs.sm || BASIS),
        supply: BigInt(gs.s || 0),
        weights,
      };
    });
  },


  async _sendAppCall(appId, args, foreignAssets, boxes, note) {
    const enc = new TextEncoder();
    const params = await algodClient.getTransactionParams().do();
    const txn = algosdk.makeApplicationCallTxnFromObject({
      from: walletAddr,
      appIndex: appId,
      onComplete: algosdk.OnApplicationComplete.NoPromoOC,
      appArgs: args.map(a => typeof a === 'string' ? enc.encode(a) : a),
      foreignAssets: foreignAssets || [],
      boxes: boxes || [],
      suggestedParams: params,
      note: note ? enc.encode(note) : undefined,
    });
    const signed = await window.algorand.signTransaction([txn]);
    const { txId } = await algodClient.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(algodClient, txId, 4);
    return txId;
  },

  BOXES: ['_p', '_h', '_f', '_r', '_o'],

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      const appId = this._appId(poolAddr);
      const balData = await this._readBox(appId, 'b');
      const balances = decodeBox64(balData).filter(b => b !== 0);
      const amountsIn = order.amountsIn.map(a => Number(a));

      const foreignAssets = order.tokensIn
        .concat(order.tokensOut)
        .filter((t, i, a) => t && a.indexOf(t) === i)
        .map(Number);

      const boxRefs = this.BOXES.map(name => ({ appIndex: appId, name: new TextEncoder().encode(name) }));

      const args = ['s'].concat(amountsIn.map(a => algosdk.encodeUint64(a)));
      args.push(algosdk.encodeUint64(Number(deadlineTs)));

      return await this._sendAppCall(appId, args, foreignAssets, boxRefs, 'swap');
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    // weights and INTEGER2 params are accepted for API consistency; Algorand contract
    // handles these through its own initialization parameters
    return trace('addLiquidity')(async () => {
      const appId = this._appId(poolAddr);
      const foreignAssets = tokens.filter(t => t).map(Number);
      const boxRefs = this.BOXES.map(name => ({ appIndex: appId, name: new TextEncoder().encode(name) }));
      const args = ['a'].concat(amounts.map(a => algosdk.encodeUint64(Number(a))));
      args.push(algosdk.encodeUint64(Number(deadlineTs)));
      return await this._sendAppCall(appId, args, foreignAssets, boxRefs, 'add_liquidity');
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      const appId = this._appId(poolAddr);
      const boxRefs = this.BOXES.map(name => ({ appIndex: appId, name: new TextEncoder().encode(name) }));
      const args = ['r', algosdk.encodeUint64(Number(shares))];
      args.push(algosdk.encodeUint64(Number(deadlineTs)));
      return await this._sendAppCall(appId, args, [], boxRefs, 'remove_liquidity');
    });
  },

  async getTokenSymbol(tokenAddr) {
    try {
      const asset = await algodClient.getAssetByID(Number(tokenAddr)).do();
      return asset.params['unit-name'] || asset.params.name || this.shortenAddress(tokenAddr);
    } catch {
      return this.shortenAddress(tokenAddr);
    }
  },

  async getTokenDecimals(tokenAddr) {
    try {
      const asset = await algodClient.getAssetByID(Number(tokenAddr)).do();
      return asset.params.decimals || 0;
    } catch {
      return 6;
    }
  },

  async getTokenBalance(tokenAddr, account) {
    try {
      const info = await algodClient.accountAssetInformation(account, Number(tokenAddr)).do();
      return BigInt(info['asset-holding']?.amount || 0);
    } catch {
      return 0n;
    }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    const appId = this._appId(poolAddr);
    try {
      const balData = await this._readBox(appId, 'b');
      const tokData = await this._readBox(appId, 't');
      const tokens = decodeBox64(tokData);
      const balances = decodeBox64(balData);
      const idx = tokens.indexOf(Number(tokenAddr));
      return idx >= 0 ? BigInt(balances[idx]) : 0n;
    } catch {
      return 0n;
    }
  },

  async approveIfNeeded() {},

  async getPoolCount(factoryAddr) {
    return trace('getPoolCount')(async () => {
      const appId = this._appId(factoryAddr);
      const gs = await this._readGlobal(appId);
      return Number(gs.cnt || 0);
    });
  },

  async getPools(factoryAddr) {
    return trace('getPools')(async () => {
      const appId = this._appId(factoryAddr);
      const gs = await this._readGlobal(appId);
      const count = Number(gs.cnt || 0);
      if (count === 0) return [];
      const boxData = await this._readBox(appId, 'pools');
      const poolIds = decodeBox64(boxData).slice(0, count);
      return poolIds.map(id => String(id));
    });
  },

  async getKnownTokens(factoryAddr) {
    return trace('getKnownTokens')(async () => {
      const appId = this._appId(factoryAddr);
      const gs = await this._readGlobal(appId);
      const count = Number(gs.kcnt || 0);
      if (count === 0) return [];
      const boxData = await this._readBox(appId, 'ktok');
      return decodeBox64(boxData).slice(0, count).map(String);
    });
  },

  async getApostolicChain(factoryAddr) {
    return trace('getApostolicChain')(async () => {
      const appId = this._appId(factoryAddr);
      const gs = await this._readGlobal(appId);
      const poolCount = Number(gs.cnt || 0);
      if (poolCount === 0) return { poolCount: 0, poolTokens: [] };
      const [countData, tokenData] = await Promise.all([
        this._readBox(appId, 'ptc'),
        this._readBox(appId, 'ptok'),
      ]);
      const tokenCounts = decodeBox64(countData).slice(0, poolCount);
      const allTokens = decodeBox64(tokenData);
      const poolTokens = [];
      let offset = 0;
      for (let i = 0; i < poolCount; i++) {
        const tc = Number(tokenCounts[i]);
        poolTokens.push(allTokens.slice(offset, offset + tc).map(String));
        offset += tc;
      }
      return { poolCount, poolTokens };
    });
  },

  async getGenesisTokens(factoryAddr) {
    return trace('getGenesisTokens')(async () => {
      const appId = this._appId(factoryAddr);
      const gs = await this._readGlobal(appId);
      return [String(gs.g1 || 0), String(gs.g2 || 0), String(gs.g3 || 0)];
    });
  },

  async isKnownToken(factoryAddr, tokenId) {
    return trace('isKnownToken')(async () => {
      const appId = this._appId(factoryAddr);
      try {
        const enc = new TextEncoder();
        const box = await algodClient.getApplicationBoxByName(appId, enc.encode('ikn')).do();
        const offset = Number(tokenId) * 8;
        if (offset + 8 > box.value.length) return false;
        const val = algosdk.decodeUint64(box.value.slice(offset, offset + 8), 'safe');
        return val === 1;
      } catch {
        return false;
      }
    });
  },

  async validateProvenance(factoryAddr, tokenIds) {
    const genesis = await this.getGenesisTokens(factoryAddr);
    const gs = await this._readGlobal(this._appId(factoryAddr));
    const poolCount = Number(gs.cnt || 0);
    const enforced = Number(gs.ge || 0);
    if (poolCount === 0 && enforced) {
      const genesisSet = genesis.filter(g => g !== '0').sort();
      const inputSet = tokenIds.map(String).sort();
      if (JSON.stringify(genesisSet) !== JSON.stringify(inputSet)) {
        throw new Error('First pool must use exactly the 3 genesis tokens');
      }
    } else if (poolCount > 0) {
      const known = await this.getKnownTokens(factoryAddr);
      const knownSet = new Set(known);
      const hasKnown = tokenIds.some(t => knownSet.has(String(t)));
      if (!hasKnown) {
        throw new Error('Pool must share at least 1 known token with existing pools');
      }
    }
    return true;
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () => {
      const appId = this._appId(poolAddr);
      const args = ['sf', algosdk.decodeAddress(newFounder).publicKey];
      return await this._sendAppCall(appId, args, [], [], 'set_founder');
    });
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () => {
      const appId = this._appId(poolAddr);
      const foreignAssets = [];
      const args = ['sff', algosdk.decodeAddress(fund).publicKey];
      return await this._sendAppCall(appId, args, foreignAssets, [], 'set_founder_fund');
    });
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () => {
      const appId = this._appId(poolAddr);
      const foreignAssets = [Number(token)];
      const args = ['cfr', algosdk.encodeUint64(Number(token))];
      return await this._sendAppCall(appId, args, foreignAssets, [], 'claim_founder_royalty');
    });
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () => {
      const appId = this._appId(poolAddr);
      const args = ['sp', algosdk.decodeAddress(newPromoter).publicKey];
      return await this._sendAppCall(appId, args, [], [], 'set_promoter');
    });
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () => {
      const appId = this._appId(poolAddr);
      const foreignAssets = [];
      const args = ['spf', algosdk.decodeAddress(fund).publicKey];
      return await this._sendAppCall(appId, args, foreignAssets, [], 'set_promoter_fund');
    });
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () => {
      const appId = this._appId(poolAddr);
      const foreignAssets = [Number(token)];
      const args = ['cpr', algosdk.encodeUint64(Number(token))];
      return await this._sendAppCall(appId, args, foreignAssets, [], 'claim_promoter_royalty');
    });
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const gs = await this._readGlobal(this._appId(poolAddr));
      return {
        factory: null,
        founder: String(gs.found || ''),
        founderFund: String(gs.ff || ''),
        promoter: String(gs.promo || ''),
        promoterFund: String(gs.pf || ''),
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      try {
        const boxData = await this._readBox(this._appId(poolAddr), 'r');
        const tokens = [];
        const amounts = [];
        for (let i = 0; i < boxData.length; i += 16) {
          if (i + 16 <= boxData.length) {
            const token = algosdk.decodeUint64(boxData.slice(i, i + 8), 'safe');
            const amt = algosdk.decodeUint64(boxData.slice(i + 8, i + 16), 'safe');
            if (token !== 0) { tokens.push(String(token)); amounts.push(BigInt(amt)); }
          }
        }
        return { tokens, amounts };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const boxData = await this._readBox(this._appId(poolAddr), 'r');
        const tokens = [];
        const amounts = [];
        for (let i = 0; i < boxData.length; i += 16) {
          if (i + 16 <= boxData.length) {
            const token = algosdk.decodeUint64(boxData.slice(i, i + 8), 'safe');
            const amt = algosdk.decodeUint64(boxData.slice(i + 8, i + 16), 'safe');
            if (token !== 0) { tokens.push(String(token)); amounts.push(BigInt(amt)); }
          }
        }
        return { tokens, amounts };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const boxData = await this._readBox(this._appId(poolAddr), 'r');
      for (let i = 0; i < boxData.length; i += 16) {
        if (i + 16 <= boxData.length) {
          const t = algosdk.decodeUint64(boxData.slice(i, i + 8), 'safe');
          if (String(t) === String(token)) return BigInt(algosdk.decodeUint64(boxData.slice(i + 8, i + 16), 'safe'));
        }
      }
    } catch {}
    return 0n;
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const boxData = await this._readBox(this._appId(poolAddr), 'r');
      for (let i = 0; i < boxData.length; i += 16) {
        if (i + 16 <= boxData.length) {
          const t = algosdk.decodeUint64(boxData.slice(i, i + 8), 'safe');
          if (String(t) === String(token)) return BigInt(algosdk.decodeUint64(boxData.slice(i + 8, i + 16), 'safe'));
        }
      }
    } catch {}
    return 0n;
  },

  isValidAddress(addr) {
    try { return algosdk.isValidAddress(addr); } catch { return false; }
  },

  async getBlock() {
    const status = await algodClient.status().do();
    return { currentBlock: Number(status['last-round']) };
  },

  async getLastTxBlock(poolAddr) {
    const cfg = ALGOD_NETWORKS[this.network || 'testnet'];
    if (!cfg || !cfg.indexer) return null;
    const res = await fetch(cfg.indexer + '/v2/transactions?address=' + poolAddr + '&limit=1');
    const data = await res.json();
    if (data.transactions && data.transactions.length > 0) return Number(data.transactions[0]['confirmed-round']);
    return null;
  },

  async getNonce(poolAddr) {
    const gs = await this._readGlobal(this._appId(poolAddr));
    return Number(gs.tx || 0);
  },
});

window.chainAPI_algorand = chainAPI;
})();
