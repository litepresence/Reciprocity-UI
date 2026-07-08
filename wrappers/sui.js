// SPDX-License-Identifier: MIT
(function() {
const SUI_NETWORKS = {
  testnet: {
    rpc: 'https://fullnode.testnet.sui.io',
    explorer: 'https://suiscan.xyz/testnet',
  },
  mainnet: {
    rpc: 'https://fullnode.mainnet.sui.io',
    explorer: 'https://suiscan.xyz/mainnet',
  },
};

let walletAddr = null;
let walletProvider = null;

const trace = makeTrace('Sui');

function parseFields(fields) {
  if (!fields || typeof fields !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v && typeof v === 'object' && v.type === 'address') { out[k] = v.value || v.fields?.name; continue; }
    if (v && typeof v === 'object' && 'fields' in v) { out[k] = parseFields(v.fields); continue; }
    if (v && typeof v === 'object' && 'value' in v) { out[k] = BigInt(v.value); continue; }
    out[k] = v;
  }
  return out;
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Sui',
  logo: 'img/logos/sui.svg',
  defaultRpc: SUI_NETWORKS.testnet.rpc,
  defaultFactory: null,
  network: 'testnet',
  chainId: null,
  explorer: SUI_NETWORKS.testnet.explorer,
  configs: SUI_NETWORKS,

  setNetwork(network) {
    const cfg = SUI_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(SUI_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[Sui] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() { return true; },

  async connectWallet() {
    const wallet = window.suiWallet || window.martian;
    if (!wallet) throw new Error('Sui Wallet or Martian not detected');
    walletProvider = wallet;
    const res = await wallet.connect();
    const addr = res?.accounts?.[0] || (typeof res === 'string' ? res : null);
    if (!addr) throw new Error('No account returned');
    walletAddr = addr;
    return { account: addr, provider: wallet, networkName: this.network };
  },

  async _getObject(objId) {
    const r = await this.rpcCall(this.defaultRpc, 'sui_getObject', [objId, { showContent: true }]);
    return r?.data?.content?.fields || null;
  },

  async _call(pkg, module, func, args) {
    const result = await this.rpcCall(this.defaultRpc, 'sui_dryRunTransactionBlock', [{
      sender: walletAddr || '0x0000000000000000000000000000000000000000000000000000000000000000',
      tx: {
        kind: 'ProgrammableTransaction',
        inputs: (args || []).map((a, i) => ({ kind: 'Input', index: i, type: 'pure', value: a })),
        transactions: [{ kind: 'MoveCall', target: `${pkg}::${module}::${func}`, arguments: (args || []).map((_, i) => ({ kind: 'Input', index: i })) }],
      },
    }]);
    const returns = result?.results?.[0]?.returnValues;
    if (!returns) return null;
    return this._parseReturns(returns);
  },

  _parseReturns(returnValues) {
    if (!returnValues || !returnValues.length) return null;
    const out = [];
    for (const [bytes, type] of returnValues) {
      const hex = typeof bytes === 'string' ? bytes : bytesToHex(new Uint8Array(bytes));
      if (type === 'u64' || type === 'u128') {
        out.push(BigInt(hex));
      } else if (type === 'address') {
        out.push('0x' + BigInt(hex).toString(16).padStart(64, '0'));
      } else if (type.startsWith('vector<')) {
        const inner = type.slice(7, -1);
        const els = [];
        const data = hexToBytes(hex);
        if (inner === 'u8') {
          data.forEach(b => els.push(b));
        } else if (inner === 'u64') {
          for (let i = 0; i < data.length; i += 8) {
            let v = 0n;
            for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(data[i + j]);
            els.push(v);
          }
        } else if (inner === 'address') {
          for (let i = 0; i < data.length; i += 32) {
            const addrHex = Array.from(data.slice(i, i + 32)).map(b => b.toString(16).padStart(2, '0')).join('');
            els.push('0x' + addrHex.replace(/^0+/, '') || '0x0');
          }
        }
        out.push(els);
      } else {
        out.push(hex);
      }
    }
    return out.length === 1 ? out[0] : out;
  },

  async _exec(pkg, module, func, args) {
    if (!walletProvider) throw new Error('Wallet not connected');
    const tx = {
      kind: 'ProgrammableTransaction',
      inputs: (args || []).map((a, i) => ({ kind: 'Input', index: i, type: 'pure', value: a })),
      transactions: [{ kind: 'MoveCall', target: `${pkg}::${module}::${func}`, arguments: (args || []).map((_, i) => ({ kind: 'Input', index: i })) }],
    };
    const result = await walletProvider.signAndExecuteTransactionBlock({ transactionBlock: tx });
    return result?.digest || result?.effects?.transactionDigest || '';
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const obj = await this._getObject(poolAddr);
      const tokens = obj?.tokens || obj?.token_addresses || [];
      const amounts = obj?.balances || obj?.token_balances || [];
      return {
        tokens: Array.isArray(tokens) ? tokens.map(String) : [],
        amounts: Array.isArray(amounts) ? amounts.map(BigInt) : [],
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const obj = await this._getObject(poolAddr);
      return {
        supply: BigInt(obj?.supply?.fields?.value || obj?.supply || 0),
        atrSpreadTarget: BigInt(obj?.atr_spread_target?.fields?.value || obj?.atr_spread_target || 0),
        emaSpreadTarget: BigInt(obj?.ema_spread_target?.fields?.value || obj?.ema_spread_target || 0),
        atrPeriod: BigInt(obj?.atr_period?.fields?.value || obj?.atr_period || 100),
        emaPeriod: BigInt(obj?.ema_period?.fields?.value || obj?.ema_period || 100),
        atrSpread: BigInt(obj?.atr_spread?.fields?.value || obj?.atr_spread || 0),
        spreadAdditive: BigInt(obj?.spread_additive?.fields?.value || obj?.spread_additive || 0),
        txs: BigInt(obj?.transactions || 0),
      };
    });
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const obj = await this._getObject(poolAddr);
      const extra = obj?.extra?.fields || obj?.extra || {};
      const get = (k) => extra[k]?.fields?.value || extra[k] || obj?.[k] || 0;
      return {
        tvwap15m: BigInt(get('tvwap_15m')),
        accK15m: BigInt(get('acc_k_15m')),
        accW15m: BigInt(get('acc_w_15m')),
        tvwap1hr: BigInt(get('tvwap_1hr')),
        accK1hr: BigInt(get('acc_k_1hr')),
        accW1hr: BigInt(get('acc_w_1hr')),
        tvwap24hr: BigInt(get('tvwap_24hr')),
        accK24hr: BigInt(get('acc_k_24hr')),
        accW24hr: BigInt(get('acc_w_24hr')),
        windowStart15m: BigInt(get('window_start_15m')),
        windowStart1hr: BigInt(get('window_start_1hr')),
        windowStart24hr: BigInt(get('window_start_24hr')),
        lastTimestamp: BigInt(get('last_timestamp')),
        currentK: await this.getKonstant(poolAddr),
      };
    });
  },

  async consult(poolAddr, secondsAgo) {
    return trace(`consult(${secondsAgo})`)(async () => {
      if (secondsAgo === 0) {
        const obj = await this._getObject(poolAddr);
        const tokens = (obj?.tokens || []).map(String);
        const balances = (obj?.balances || []).map(BigInt);
        const weights = (obj?.weights || []).map(BigInt);
        const scale = BigInt(obj?.scale || 0);
        const factors = Number(obj?.factors || 0);
        if (tokens.length === 0) return 0n;
        const genesis = (obj?.genesis || []).map(BigInt);
        return window.reciprocity_math.computeKonstant(balances, genesis, factors, scale, weights);
      }
      const winMap = { 900: '15m', 3600: '1hr', 86400: '24hr' };
      const win = winMap[secondsAgo];
      if (!win) throw new Error('InvalidPeriod: ' + secondsAgo);
      const obj = await this._getObject(poolAddr);
      const accW = BigInt(obj?.['acc_w_' + win] || 0);
      if (accW === 0n) throw new Error('ConsultInvalid: no TVWAP data for ' + secondsAgo);
      return BigInt(obj?.['tvwap_' + win] || 0);
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

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const obj = await this._getObject(poolAddr);
    return BigInt(obj?.supply?.fields?.value || obj?.supply || 0);
  },

  async getKonstant(poolAddr) {
    return await this.consult(poolAddr, 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const obj = await this._getObject(poolAddr);
      const tokens = (obj?.tokens || []).map(String);
      const balances = (obj?.balances || []).map(BigInt);
      const genesis = (obj?.genesis || []).map(BigInt);
      return {
        tokens,
        balances,
        genesis,
        factors: Number(obj?.factors || 0),
        scale: BigInt(obj?.scale || 0),
        atr_spread_target: BigInt(obj?.atr_spread_target?.fields?.value || obj?.atr_spread_target || 10),
        ema_spread_target: BigInt(obj?.ema_spread_target?.fields?.value || obj?.ema_spread_target || 50),
        atr_period: BigInt(obj?.atr_period?.fields?.value || obj?.atr_period || 100),
        ema_period: BigInt(obj?.ema_period?.fields?.value || obj?.ema_period || 100),
        atr_spread: BigInt(obj?.atr_spread?.fields?.value || obj?.atr_spread || 0),
        spread_additive: BigInt(obj?.spread_additive?.fields?.value || obj?.spread_additive || 0),
        spread_multiplier: BigInt(obj?.spread_multiplier?.fields?.value || obj?.spread_multiplier || 10000),
        supply: BigInt(obj?.supply?.fields?.value || obj?.supply || 0),
        weights: (obj?.weights || []).map(w => BigInt(w)),
      };
    });
  },



  async _packageOf(objId) {
    const obj = await this.rpcCall(this.defaultRpc, 'sui_getObject', [objId, { showType: true }]);
    const type = obj?.data?.type || '';
    const m = type.match(/^(0x[a-f0-9]+)::(\w+)/);
    return m ? { pkg: m[1], mod: m[2] } : null;
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      const info = await this._packageOf(poolAddr);
      if (!info) throw new Error('Cannot determine package from ' + poolAddr);
      return await this._exec(info.pkg, info.mod, 'swap', [
        order.tokensIn, order.amountsIn.map(String),
        order.tokensOut, order.amountsOut.map(String),
        order.minSharesOut.toString(),
        String(deadlineTs),
      ]);
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    // weights and INTEGER2 params are accepted for API consistency; Sui contract
    // handles these through its own initialization parameters
    return trace('addLiquidity')(async () => {
      const info = await this._packageOf(poolAddr);
      if (!info) throw new Error('Cannot determine package from ' + poolAddr);
      return await this._exec(info.pkg, info.mod, 'add_liquidity', [...tokens, ...amounts.map(String), minShares.toString(), String(deadlineTs)]);
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      const info = await this._packageOf(poolAddr);
      if (!info) throw new Error('Cannot determine package from ' + poolAddr);
      return await this._exec(info.pkg, info.mod, 'remove_liquidity', [shares.toString(), minTokensOut.map(String), String(deadlineTs)]);
    });
  },

  async getTokenSymbol(tokenAddr) { return this.shortenAddress(tokenAddr); },
  async getTokenDecimals(tokenAddr) { return 9; },

  async getTokenBalance(tokenAddr, account) {
    try {
      const r = await this.rpcCall(this.defaultRpc, 'sui_getBalance', [account, tokenAddr]);
      return BigInt(r?.totalBalance || 0);
    } catch { return 0n; }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    try {
      const r = await this.rpcCall(this.defaultRpc, 'sui_getBalance', [poolAddr, tokenAddr]);
      return BigInt(r?.totalBalance || 0);
    } catch { return 0n; }
  },

  async approveIfNeeded() { return; },
  async getPoolCount(factoryAddr) {
    try {
      const obj = await this._getObject(factoryAddr);
      return Number(obj?.pool_count ?? 0);
    } catch { return 0; }
  },
  async getPools(factoryAddr) {
    return trace('getPools')(async () => {
      const info = await this._packageOf(factoryAddr);
      if (!info) throw new Error('Cannot determine package from ' + factoryAddr);
      const eventType = `${info.pkg}::factory::PoolCreatedEvent`;
      const events = await this.rpcCall(this.defaultRpc, 'suix_queryEvents', [{
        MoveEventType: eventType,
      }]);
      const seen = new Set();
      const pools = [];
      for (const e of (events?.data || [])) {
        const pid = e.parsedJson?.pool_id;
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          pools.push(pid);
        }
      }
      return pools;
    });
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async _adminExec(poolAddr, funcName, args) {
    const info = await this._packageOf(poolAddr);
    if (!info) throw new Error('Cannot determine package from ' + poolAddr);
    return await this._exec(info.pkg, info.mod, funcName, args);
  },

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () =>
      this._adminExec(poolAddr, 'set_founder', [newFounder])
    );
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () =>
      this._adminExec(poolAddr, 'set_founder_fund', [fund])
    );
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () =>
      this._adminExec(poolAddr, 'claim_founder_royalty', [token])
    );
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () =>
      this._adminExec(poolAddr, 'set_promoter', [newPromoter])
    );
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () =>
      this._adminExec(poolAddr, 'set_promoter_fund', [fund])
    );
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () =>
      this._adminExec(poolAddr, 'claim_promoter_royalty', [token])
    );
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const obj = await this._getObject(poolAddr);
      const extra = obj?.extra?.fields || obj?.extra || {};
      const get = (k) => extra[k]?.fields?.value || extra[k] || obj?.[k] || null;
      return {
        factory: get('factory'),
        founder: get('founder'),
        founderFund: get('founder_fund'),
        promoter: get('promoter'),
        promoterFund: get('promoter_fund'),
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      try {
        const obj = await this._getObject(poolAddr);
        const extra = obj?.extra?.fields || obj?.extra || {};
        const get = (k) => extra[k]?.fields?.value || extra[k] || obj?.[k] || [];
        const tokens = get('founder_royalty_tokens');
        const amounts = get('founder_royalty_amounts');
        return { tokens: (Array.isArray(tokens) ? tokens : []).map(String), amounts: (Array.isArray(amounts) ? amounts : []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const obj = await this._getObject(poolAddr);
        const extra = obj?.extra?.fields || obj?.extra || {};
        const get = (k) => extra[k]?.fields?.value || extra[k] || obj?.[k] || [];
        const tokens = get('promoter_royalty_tokens');
        const amounts = get('promoter_royalty_amounts');
        return { tokens: (Array.isArray(tokens) ? tokens : []).map(String), amounts: (Array.isArray(amounts) ? amounts : []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const obj = await this._getObject(poolAddr);
      const extra = obj?.extra?.fields || obj?.extra || {};
      const get = (k) => extra[k]?.fields?.value || extra[k] || obj?.[k] || [];
      const tokens = get('founder_royalty_tokens');
      const amounts = get('founder_royalty_amounts');
      const idx = (Array.isArray(tokens) ? tokens : []).map(String).indexOf(token);
      return idx >= 0 ? BigInt((Array.isArray(amounts) ? amounts : [])[idx] || 0) : 0n;
    } catch { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const obj = await this._getObject(poolAddr);
      const extra = obj?.extra?.fields || obj?.extra || {};
      const get = (k) => extra[k]?.fields?.value || extra[k] || obj?.[k] || [];
      const tokens = get('promoter_royalty_tokens');
      const amounts = get('promoter_royalty_amounts');
      const idx = (Array.isArray(tokens) ? tokens : []).map(String).indexOf(token);
      return idx >= 0 ? BigInt((Array.isArray(amounts) ? amounts : [])[idx] || 0) : 0n;
    } catch { return 0n; }
  },

  isValidAddress(addr) {
    return typeof addr === 'string' && addr.startsWith('0x') && addr.length >= 42;
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 16) return addr;
    return addr.slice(0, 8) + '\u2026' + addr.slice(-6);
  },

  async getBlock() {
    const seq = await this.rpcCall(this.defaultRpc, 'suix_getLatestCheckpointSequenceNumber', []);
    return { currentBlock: Number(seq) };
  },

  async getLastTxBlock(poolAddr) {
    const result = await this.rpcCall(this.defaultRpc, 'suix_queryTransactionBlocks', [{
      filter: { FromAddress: poolAddr },
      options: { showInput: false },
      order: 'descending',
      limit: 1,
    }]);
    if (result.data && result.data.length > 0) return Number(result.data[0].checkpoint);
    return null;
  },

  async getNonce(poolAddr) {
    const obj = await this._getObject(poolAddr);
    return Number(obj?.transactions || 0);
  },
});

window.chainAPI_sui = chainAPI;
})();
