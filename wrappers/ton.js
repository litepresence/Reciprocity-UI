// SPDX-License-Identifier: MIT
(function() {
const TON_NETWORKS = {
  testnet: {
    rpc: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    apiKey: '',  // Optional: get from https://toncenter.com
    explorer: 'https://testnet.tonscan.org',
  },
  mainnet: {
    rpc: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: '',
    explorer: 'https://tonscan.org',
  },
};

const TON_CDNS = [
  'https://cdn.jsdelivr.net/npm/tonweb@0/dist/tonweb.min.js',
  'https://unpkg.com/tonweb@0/dist/tonweb.min.js',
];

let TonWeb = null;
let provider = null;
let walletAddr = null;
let tConnector = null;

const trace = makeTrace('TON');

// Op codes from Tact-generated contract (ton_helper.ts OPC map)
const OPC = {
  SwapMsg: 2234582914,
  AddLiquidityMsg: 3572350760,
  RemoveLiquidityMsg: 1643040578,
  SetFounder: 3837518632,
  SetFounderFund: 3596668760,
  ClaimFounderRoyalty: 1698245120,
  SetPromoter: 1951897786,
  SetPromoterFund: 1354204499,
  ClaimPromoterRoyalty: 3887265514,
};

// ── Dictionary serialization helpers (matches Tact's map<Int, Int> 257-bit) ──
function _padKey(key, length) {
  let s = key.toString(2);
  while (s.length < length) s = '0' + s;
  return s;
}
function _findCommonPrefix(keys) {
  if (keys.length === 0) return '';
  const first = keys[0];
  for (let i = 0; i < first.length; i++) {
    const bit = first[i];
    for (let j = 1; j < keys.length; j++) { if (keys[j][i] !== bit) return first.substring(0, i); }
  }
  return first;
}
function _writeLabel(cell, label, keyLength) {
  if (label.length === 0) { cell.bits.writeBit(0); cell.bits.writeBit(0); return; }
  const shortLen = 1 + label.length + 1 + label.length;
  const lenLen = Math.ceil(Math.log2(keyLength + 1));
  if (shortLen <= 2 + lenLen + label.length) {
    cell.bits.writeBit(0);
    for (let i = 0; i < label.length; i++) cell.bits.writeBit(1);
    cell.bits.writeBit(0);
    if (label.length > 0) cell.bits.writeUint(BigInt('0b' + label), label.length);
  } else {
    cell.bits.writeBit(1); cell.bits.writeBit(0);
    cell.bits.writeUint(label.length, lenLen);
    cell.bits.writeUint(BigInt('0b' + label), label.length);
  }
}
function _buildEdgeCell(entries, keyLength) {
  const cell = new TonWeb.boc.Cell();
  const keys = entries.map(e => e.key);
  const common = _findCommonPrefix(keys);
  const remainingKeyBits = keyLength - common.length;
  _writeLabel(cell, common, keyLength);
  if (remainingKeyBits === 0) {
    cell.bits.writeInt(BigInt(entries[0].value), 257);
    return cell;
  }
  const leftEntries = []; const rightEntries = [];
  for (const e of entries) {
    const rem = e.key.substring(common.length);
    if (rem[0] === '0') leftEntries.push({ key: rem.substring(1), value: e.value });
    else rightEntries.push({ key: rem.substring(1), value: e.value });
  }
  cell.refs.push(_buildEdgeCell(leftEntries, remainingKeyBits - 1));
  cell.refs.push(_buildEdgeCell(rightEntries, remainingKeyBits - 1));
  return cell;
}
function _makeInt257Dict(entries) {
  // entries: { key: number|bigint, value: number|bigint }
  const keys = Object.keys(entries);
  if (keys.length === 0) { const c = new TonWeb.boc.Cell(); c.bits.writeBit(0); return c; }
  const c = new TonWeb.boc.Cell();
  c.bits.writeBit(1);
  c.refs.push(_buildEdgeCell(keys.map(k => ({ key: _padKey(BigInt(k), 257), value: BigInt(entries[k]) })), 257));
  return c;
}
// ── End dict helpers ──

function addrRaw(addr) {
  return addr ? new TonWeb.utils.Address(addr).toString(true) : addr;
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'TON',
  logo: 'img/logos/ton.svg',
  defaultRpc: TON_NETWORKS.testnet.rpc,
  defaultFactory: null,
  network: 'testnet',
  chainId: null,
  explorer: TON_NETWORKS.testnet.explorer,
  configs: TON_NETWORKS,

  setNetwork(network) {
    const cfg = TON_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(TON_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.explorer = cfg.explorer;
    this.network = network;
    if (TonWeb) provider = new TonWeb.HttpProvider(cfg.rpc, { apiKey: cfg.apiKey });
    console.log(`%c[TON] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
    console.log(`  RPC: ${cfg.rpc}`);
    console.log(`  Explorer: ${cfg.explorer}`);
  },

  async loadSDK() {
    if (TonWeb) return true;
    for (const url of TON_CDNS) {
      try {
        await this.loadScript(url);
        if (typeof window.TonWeb !== 'undefined') {
          TonWeb = window.TonWeb;
          const cfg = TON_NETWORKS[this.network || 'testnet'];
          provider = new TonWeb.HttpProvider(cfg.rpc, { apiKey: cfg.apiKey });
          return true;
        }
      } catch {}
    }
    return false;
  },

  async connectWallet() {
    try {
      if (typeof window.ton !== 'undefined' && window.ton.isTonkeeper) {
        const res = await window.ton.connect(2);
        walletAddr = res.address;
        return { account: walletAddr, provider: window.ton, networkName: this.network };
      }
    } catch {}
    throw new Error('TON wallet not detected. Install Tonkeeper or another TON Connect wallet.');
  },

  async _run(poolAddr, method, stack) {
    const a = addrRaw(poolAddr);
    const r = await provider.call2(a, method, stack || []);
    return r;
  },

  _parseCell(val) {
    if (val instanceof TonWeb.boc.Cell) return val;
    if (typeof val === 'number' || typeof val === 'bigint') return val;
    try { return new TonWeb.utils.BN(val); } catch { return val; }
  },

  async _readBalances(poolAddr) {
    const [balData, tokData] = await Promise.all([
      this._run(poolAddr, 'getBalances'),
      this._run(poolAddr, 'getTokens'),
    ]);
    const balMap = balData && typeof balData === 'object' ? balData : {};
    const tokMap = tokData && typeof tokData === 'object' ? tokData : {};
    const keys = Object.keys(tokMap).map(Number).filter(k => !isNaN(k)).sort();
    const tokens = keys.map(k => String(tokMap[k]));
    const amounts = keys.map(k => BigInt(balMap[k] || 0));
    return { tokens, amounts };
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      return await this._readBalances(poolAddr);
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const r = await this._run(poolAddr, 'getStatus');
      return {
        supply: BigInt(r?.supply ?? 0),
        atrSpreadTarget: BigInt(r?.atrSpreadTarget ?? 0),
        emaSpreadTarget: BigInt(r?.emaSpreadTarget ?? 0),
        atrPeriod: BigInt(r?.atrPeriod ?? 0),
        emaPeriod: BigInt(r?.emaPeriod ?? 0),
        atrSpread: BigInt(r?.atrSpread ?? 0),
        spreadAdditive: BigInt(r?.spreadAdditive ?? 0),
        txs: BigInt(r?.transactions ?? 0),
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

  async consult(poolAddr, secondsAgo) {
    return trace(`consult(${secondsAgo}s)`)(async () => {
      const r = await this._run(poolAddr, 'consult', [[secondsAgo]]);
      return BigInt(Array.isArray(r) ? r[0] || 0 : r || 0);
    });
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const r = await this._run(poolAddr, 'getTvwapState');
      const m = r && typeof r === 'object' ? r : {};
      return {
        tvwap15m: BigInt(m[0] ?? 0),
        accW15m: BigInt(m[1] ?? 0),
        windowStart15m: Number(m[2] ?? 0),
        tvwap1hr: BigInt(m[3] ?? 0),
        accW1hr: BigInt(m[4] ?? 0),
        windowStart1hr: Number(m[5] ?? 0),
        tvwap24hr: BigInt(m[6] ?? 0),
        accW24hr: BigInt(m[7] ?? 0),
        windowStart24hr: Number(m[8] ?? 0),
        lastTimestamp: Number(m[9] ?? 0),
        currentK: BigInt(m[10] ?? 0),
      };
    });
  },

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const r = await this._run(poolAddr, 'getSupply');
    return BigInt(Array.isArray(r) ? r[0] || 0 : r || 0);
  },

  async getKonstant(poolAddr) {
    const r = await this._run(poolAddr, 'consult', [[0]]);
    return BigInt(Array.isArray(r) ? r[0] || 0 : r || 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const [cfg, bals, tokenData, genesisData] = await Promise.all([
        this._run(poolAddr, 'getPoolConfig'),
        this._run(poolAddr, 'getBalances'),
        this._run(poolAddr, 'getTokens'),
        this._run(poolAddr, 'getGenesis'),
      ]);
      const o = cfg && typeof cfg === 'object' ? cfg : {};
      const balMap = bals && typeof bals === 'object' ? bals : {};
      const tokMap = tokenData && typeof tokenData === 'object' ? tokenData : {};
      const genMap = genesisData && typeof genesisData === 'object' ? genesisData : {};
      const keys = Object.keys(tokMap).map(Number).filter(k => !isNaN(k)).sort();
      const assets = keys.map(k => String(tokMap[k]));
      const balances = keys.map(k => BigInt(balMap[k] || 0));
      const genesis = keys.map(k => BigInt(genMap[k] || 0));
      const factors = Number(o.factors ?? o[5] ?? keys.length);
      const wgtData = await this._run(poolAddr, 'getWeights').catch(() => ({}));
      const wgtMap = wgtData && typeof wgtData === 'object' ? wgtData : {};
      const weights = keys.map(k => BigInt(wgtMap[k] || 0));
      return {
        tokens: assets,
        balances,
        genesis,
        factors,
        scale: BigInt(o.scale ?? o[4] ?? 0),
        atr_spread_target: BigInt(o.atrSpreadTarget ?? o.target ?? o[1] ?? ATR_SPREAD_TARGET),
        ema_spread_target: BigInt(o.emaSpreadTarget ?? o[2] ?? EMA_SPREAD_TARGET),
        atr_period: BigInt(o.atrPeriod ?? o[6] ?? ATR_PERIOD),
        ema_period: BigInt(o.emaPeriod ?? o[7] ?? EMA_PERIOD),
        atr_spread: BigInt(o.atrSpread ?? o[8] ?? 0),
        spread_additive: BigInt(o.spreadAdditive ?? o[9] ?? 0),
        spread_multiplier: BigInt(o.spreadMultiplier ?? o[3] ?? 10000),
        supply: BigInt(o.supply ?? o[0] ?? 0),
        weights,
      };
    });
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      // Resolve token addresses to indices
      const tokMap = await this._run(poolAddr, 'getTokens');
      const a2i = {};
      for (const k of Object.keys(tokMap)) a2i[tokMap[k]] = Number(k);
      const tin = {}; const tout = {}; const minOut = {};
      for (let i = 0; i < order.tokensIn.length; i++) { const idx = a2i[order.tokensIn[i]]; if (idx !== undefined) tin[idx] = BigInt(order.amountsIn[i]); }
      for (let i = 0; i < order.tokensOut.length; i++) { const idx = a2i[order.tokensOut[i]]; if (idx !== undefined) tout[idx] = BigInt(order.amountsOut[i]); }
      if (order.minAmountsOut) {
        for (let i = 0; i < order.tokensOut.length; i++) { const idx = a2i[order.tokensOut[i]]; if (idx !== undefined && order.minAmountsOut[i] !== undefined) minOut[idx] = BigInt(order.minAmountsOut[i]); }
      }
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.SwapMsg, 32);
      const td = _makeInt257Dict(tin);
      body.bits.writeBit(td.bits.at(0) ? 1 : 0);
      if (td.bits.at(0)) body.refs.push(td.refs[0]);
      const tod = _makeInt257Dict(tout);
      body.bits.writeBit(tod.bits.at(0) ? 1 : 0);
      if (tod.bits.at(0)) body.refs.push(tod.refs[0]);
      body.bits.writeInt(BigInt(order.sharesIn || 0), 257);
      body.bits.writeInt(BigInt(order.minSharesOut || 0), 257);
      const mod = _makeInt257Dict(minOut);
      body.bits.writeBit(mod.bits.at(0) ? 1 : 0);
      if (mod.bits.at(0)) body.refs.push(mod.refs[0]);
      body.bits.writeInt(BigInt(deadlineTs), 257);
      return await this._send(poolAddr, TonWeb.utils.toNano('0.1'), body);
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const tokMap = await this._run(poolAddr, 'getTokens');
      const a2i = {};
      for (const k of Object.keys(tokMap)) a2i[tokMap[k]] = Number(k);
      const amts = {};
      for (let i = 0; i < tokens.length; i++) { const idx = a2i[tokens[i]]; if (idx !== undefined) amts[idx] = BigInt(amounts[i]); }
      const wts = {};
      if (weights && weights.length > 0) {
        for (let i = 0; i < weights.length; i++) { const idx = a2i[tokens[i]]; if (idx !== undefined) wts[idx] = BigInt(weights[i]); }
      }
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.AddLiquidityMsg, 32);
      body.bits.writeBit(1); body.refs.push(_buildEdgeCell(Object.keys(amts).map(k => ({ key: _padKey(BigInt(k), 257), value: BigInt(amts[k]) })), 257));
      body.bits.writeInt(BigInt(minShares), 257);
      const wd = _makeInt257Dict(wts);
      body.bits.writeBit(wd.bits.at(0) ? 1 : 0);
      if (wd.bits.at(0)) body.refs.push(wd.refs[0]);
      body.bits.writeInt(BigInt(atrSpreadTarget || 0), 257);
      body.bits.writeInt(BigInt(emaSpreadTarget || 0), 257);
      const refBody = new TonWeb.boc.Cell();
      refBody.bits.writeInt(BigInt(atrPeriod || 0), 257);
      refBody.bits.writeInt(BigInt(emaPeriod || 0), 257);
      refBody.bits.writeInt(BigInt(deadlineTs), 257);
      body.refs.push(refBody);
      return await this._send(poolAddr, TonWeb.utils.toNano('0.1'), body);
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const minOut = {};
      for (let i = 0; i < minTokensOut.length; i++) { if (BigInt(minTokensOut[i]) > 0n) minOut[i] = BigInt(minTokensOut[i]); }
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.RemoveLiquidityMsg, 32);
      body.bits.writeInt(BigInt(shares), 257);
      const mod = _makeInt257Dict(minOut);
      body.bits.writeBit(mod.bits.at(0) ? 1 : 0);
      if (mod.bits.at(0)) body.refs.push(mod.refs[0]);
      body.bits.writeInt(BigInt(deadlineTs), 257);
      return await this._send(poolAddr, TonWeb.utils.toNano('0.1'), body);
    });
  },

  async _send(toAddr, amount, body) {
    if (!walletAddr) throw new Error('Wallet not connected');
    const bodyBoc = body.toBoc().toString('base64');
    if (window.ton && typeof window.ton.send === 'function') {
      const result = await window.ton.send('ton_transaction', {
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{ address: toAddr, amount: amount.toString(), payload: bodyBoc }],
      });
      return result?.boc || 'tx:' + toAddr;
    }
    await provider.sendBoc(bodyBoc);
    return 'tx:' + toAddr;
  },

  async getTokenSymbol(tokenAddr) {
    return this.shortenAddress(tokenAddr);
  },

  async getTokenDecimals(tokenAddr) {
    return 9;
  },

  async getTokenBalance(tokenAddr, account) {
    try {
      const r = await this._run(tokenAddr, 'get_wallet_data');
      return BigInt(Array.isArray(r) ? r[0] || 0 : r || 0);
    } catch {
      return 0n;
    }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    try {
      const bal = await this._readBalances(poolAddr);
      const idx = bal.tokens.indexOf(tokenAddr);
      return idx >= 0 ? bal.amounts[idx] : 0n;
    } catch {
      return 0n;
    }
  },

  async approveIfNeeded() { return; },

  async getPoolCount(factoryAddr) {
    try {
      const r = await this._run(factoryAddr, 'totalPools');
      return Number(Array.isArray(r) ? r[0] || 0 : r || 0);
    } catch { return 0; }
  },

  async getPools(factoryAddr) {
    try {
      const count = await this.getPoolCount(factoryAddr);
      const pools = [];
      for (let i = 0; i < count; i++) {
        const r = await this._run(factoryAddr, 'poolAddress', [[i]]);
        const addr = Array.isArray(r) ? r[0] : r;
        if (addr && typeof addr === 'string') pools.push(addr);
      }
      return pools;
    } catch { return []; }
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.SetFounder, 32);
      body.bits.writeAddress(new TonWeb.utils.Address(newFounder));
      return await this._send(poolAddr, TonWeb.utils.toNano('0.05'), body);
    });
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.SetFounderFund, 32);
      body.bits.writeAddress(new TonWeb.utils.Address(fund));
      return await this._send(poolAddr, TonWeb.utils.toNano('0.05'), body);
    });
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const tokMap = await this._run(poolAddr, 'getTokens');
      let tokenIdx = BigInt(token);
      for (const k of Object.keys(tokMap)) { if (tokMap[k] === token) { tokenIdx = BigInt(k); break; } }
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.ClaimFounderRoyalty, 32);
      body.bits.writeInt(tokenIdx, 257);
      return await this._send(poolAddr, TonWeb.utils.toNano('0.05'), body);
    });
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.SetPromoter, 32);
      body.bits.writeAddress(new TonWeb.utils.Address(newPromoter));
      return await this._send(poolAddr, TonWeb.utils.toNano('0.05'), body);
    });
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.SetPromoterFund, 32);
      body.bits.writeAddress(new TonWeb.utils.Address(fund));
      return await this._send(poolAddr, TonWeb.utils.toNano('0.05'), body);
    });
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () => {
      if (!walletAddr) throw new Error('Wallet not connected');
      const tokMap = await this._run(poolAddr, 'getTokens');
      let tokenIdx = BigInt(token);
      for (const k of Object.keys(tokMap)) { if (tokMap[k] === token) { tokenIdx = BigInt(k); break; } }
      const body = new TonWeb.boc.Cell();
      body.bits.writeUint(OPC.ClaimPromoterRoyalty, 32);
      body.bits.writeInt(tokenIdx, 257);
      return await this._send(poolAddr, TonWeb.utils.toNano('0.05'), body);
    });
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const r = await this._run(poolAddr, 'getAdminState');
      const m = Array.isArray(r) ? r : (r && typeof r === 'object' ? r : {});
      return {
        factory: String(m[0] || ''),
        founder: String(m[1] || ''),
        founderFund: String(m[2] || ''),
        promoter: String(m[3] || ''),
        promoterFund: String(m[4] || ''),
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      try {
        const r = await this._run(poolAddr, 'getFounderRoyalties');
        const m = r && typeof r === 'object' ? r : {};
        const keys = Object.keys(m).map(Number).filter(k => !isNaN(k)).sort();
        return { tokens: keys.map(k => String(k)), amounts: keys.map(k => BigInt(m[k] || 0)) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const r = await this._run(poolAddr, 'getPromoterRoyalties');
        const m = r && typeof r === 'object' ? r : {};
        const keys = Object.keys(m).map(Number).filter(k => !isNaN(k)).sort();
        return { tokens: keys.map(k => String(k)), amounts: keys.map(k => BigInt(m[k] || 0)) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const [r, tokMap] = await Promise.all([
        this._run(poolAddr, 'getFounderRoyalties'),
        this._run(poolAddr, 'getTokens'),
      ]);
      let idx = -1;
      for (const k of Object.keys(tokMap)) { if (tokMap[k] === token) { idx = Number(k); break; } }
      if (idx >= 0 && r && typeof r === 'object' && r[String(idx)] !== undefined) return BigInt(r[String(idx)]);
      return 0n;
    } catch { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const [r, tokMap] = await Promise.all([
        this._run(poolAddr, 'getPromoterRoyalties'),
        this._run(poolAddr, 'getTokens'),
      ]);
      let idx = -1;
      for (const k of Object.keys(tokMap)) { if (tokMap[k] === token) { idx = Number(k); break; } }
      if (idx >= 0 && r && typeof r === 'object' && r[String(idx)] !== undefined) return BigInt(r[String(idx)]);
      return 0n;
    } catch { return 0n; }
  },

  isValidAddress(addr) {
    try { new TonWeb.utils.Address(addr); return true; } catch { return false; }
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 12) return addr;
    return addr.slice(0, 6) + '\u2026' + addr.slice(-6);
  },

  async getBlock() {
    const info = await provider.getMasterchainInfo();
    return { currentBlock: Number(info.last.seqno) };
  },

  async getLastTxBlock(poolAddr) {
    // TON doesn't map individual transactions to a specific block seqno
    // through the available API. Return null for em dash until first nonce change.
    return null;
  },

  async getNonce(poolAddr) {
    const r = await this._run(poolAddr, 'getStatus');
    return Number(r?.transactions ?? 0);
  },
});

window.chainAPI_ton = chainAPI;
})();
