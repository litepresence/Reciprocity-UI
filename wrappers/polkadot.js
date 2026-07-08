// SPDX-License-Identifier: MIT
(function() {
const POLKADOT_NETWORKS = {
  testnet: {
    rpc: 'https://rococo-rpc.polkadot.io',
    explorer: 'https://rococo.subscan.io',
  },
  mainnet: {
    rpc: 'https://rpc.polkadot.io',
    explorer: 'https://polkadot.subscan.io',
  },
};

let api = null;
let injector = null;
let accounts = [];

const trace = makeTrace('Polkadot');

const SELECTORS = {
  getBalances: [0x7d, 0xaa, 0xc8, 0x08],
  getStatus: [0x07, 0xe3, 0xb8, 0xdf],
  getTvwapState: [0x4f, 0x78, 0xc0, 0x65],
  getSupply: [0x75, 0x5e, 0x20, 0x27],
  getPoolConfig: [0xcc, 0xfb, 0x3d, 0x4b],
  consult: [0x2c, 0x3f, 0x1c, 0x48],
  quoteSwap: [0xb5, 0xf1, 0x70, 0xd6],
  swap: [0x11, 0x00, 0x4f, 0xa6],
  addLiquidity: [0x26, 0x4c, 0xd0, 0x4b],
  removeLiquidity: [0xbd, 0xd1, 0x6b, 0xfa],
  balance_of: [0xd0, 0x5b, 0xc8, 0x39],
  getPoolCount: [0xcf, 0xf5, 0xbc, 0x37],
  getPools: [0x3b, 0xcb, 0xb4, 0xaf],
  setFounder: [0x7d, 0x0f, 0x8a, 0x60],
  setFounderFund: [0x24, 0x28, 0xdb, 0xc7],
  claimFounderRoyalty: [0x57, 0xde, 0x37, 0xd3],
  setPromoter: [0x60, 0x6c, 0xb2, 0xe4],
  setPromoterFund: [0xee, 0xfb, 0xae, 0xcc],
  claimPromoterRoyalty: [0x66, 0xe5, 0x53, 0xa1],
  getAdminState: [0xf2, 0x71, 0x8f, 0xa4],
  getFounderRoyalties: [0x9f, 0xa2, 0xf7, 0xac],
  getPromoterRoyalties: [0xed, 0x52, 0x8f, 0xeb],
  getFounderRoyalty: [0xd8, 0x61, 0xb1, 0x33],
  getPromoterRoyalty: [0x15, 0xa5, 0x03, 0x5d],
};

const ARG_SCHEMAS = {
  getBalances: [],
  getStatus: [],
  getTvwapState: [],
  getSupply: [],
  getPoolConfig: [],
  consult: ['u64'],
  quoteSwap: ['vec_address', 'vec_u128', 'vec_address', 'vec_u128', 'u128', 'u128', 'u64'],
  balance_of: ['address'],
  swap: ['vec_address', 'vec_u128', 'vec_address', 'vec_u128', 'u128', 'u128', 'u64'],
  addLiquidity: ['vec_address', 'vec_u128', 'u128', 'vec_u128', 'u128', 'u128', 'u128', 'u128', 'u64'],
  removeLiquidity: ['u128', 'vec_u128', 'u64'],
  getPoolCount: [],
  getPools: [],
  setFounder: ['address'],
  setFounderFund: ['address'],
  claimFounderRoyalty: ['address'],
  setPromoter: ['address'],
  setPromoterFund: ['address'],
  claimPromoterRoyalty: ['address'],
  getAdminState: [],
  getFounderRoyalties: [],
  getPromoterRoyalties: [],
  getFounderRoyalty: ['address'],
  getPromoterRoyalty: ['address'],
};

const RETURN_SCHEMAS = {
  getBalances: ['vec_address', 'vec_u128'],
  getStatus: ['u128', 'u128', 'u128', 'u128', 'u128', 'u128', 'i128', 'u128', 'u128', 'vec_u128', 'u64', 'i128', 'i128', 'u128', 'u64'],
  getTvwapState: ['u128', 'u128', 'u64', 'u128', 'u128', 'u64', 'u128', 'u128', 'u64', 'u64', 'u128'],
  getSupply: ['u128'],
  getPoolConfig: ['vec_address', 'vec_u128', 'vec_u128', 'u8', 'u128', 'u128', 'u128', 'u128', 'u128', 'u128', 'u128', 'u64', 'vec_u128'],
  consult: ['u128'],
  quoteSwap: ['vec_address', 'vec_u128', 'u128', 'vec_u128'],
  balance_of: ['u128'],
  getPoolCount: ['u32'],
  getPools: ['vec_address'],
  getAdminState: ['address', 'address', 'address', 'address', 'address'],
  getFounderRoyalties: ['vec_address', 'vec_u128'],
  getPromoterRoyalties: ['vec_address', 'vec_u128'],
  getFounderRoyalty: ['u128'],
  getPromoterRoyalty: ['u128'],
};

function scaleCompact(n) {
  const v = BigInt(n);
  if (v < 1n << 6n) return new Uint8Array([Number(v << 2n)]);
  if (v < 1n << 14n) { const val = Number(v << 2n) | 0b01; return new Uint8Array([val & 0xff, (val >> 8) & 0xff]); }
  if (v < 1n << 30n) { const val = Number(v << 2n) | 0b10; return new Uint8Array([val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >> 24) & 0xff]); }
  const valueBytes = [];
  let t = v; while (t > 0n) { valueBytes.push(Number(t & 0xFFn)); t >>= 8n; }
  const pl = (valueBytes.length << 2) | 0b11;
  const p = new Uint8Array([pl & 0xff, (pl >> 8) & 0xff, (pl >> 16) & 0xff, (pl >> 24) & 0xff, ...valueBytes]);
  return p;
}

function scaleU128(n) {
  const v = BigInt(n); const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) { b[i] = Number((v >> BigInt(i * 8)) & 0xFFn); }
  return b;
}

function scaleU64(n) {
  const v = BigInt(n); const b = new Uint8Array(8);
  for (let i = 0; i < 8; i++) { b[i] = Number((v >> BigInt(i * 8)) & 0xFFn); }
  return b;
}

function scaleAddress(addr) {
  const h = (addr.startsWith('0x') ? addr.slice(2) : addr).padStart(64, '0');
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return b;
}

function scaleVec(encFn) { return (items) => { const el = items.map(encFn); const l = scaleCompact(items.length); const r = new Uint8Array(l.length + el.reduce((s, e) => s + e.length, 0)); r.set(l); let o = l.length; for (const e of el) { r.set(e, o); o += e.length; } return r; }; }

function scaleString(s) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(s);
  const l = scaleCompact(bytes.length);
  const r = new Uint8Array(l.length + bytes.length);
  r.set(l); r.set(bytes, l.length);
  return r;
}

function scaleEncodeArgs(method, args) {
  const sel = SELECTORS[method];
  if (!sel) throw new Error('Unknown method: ' + method);
  const schema = ARG_SCHEMAS[method] || [];
  const parts = [new Uint8Array(sel)];
  for (let i = 0; i < schema.length; i++) {
    const t = schema[i];
    const v = args && typeof args === 'object' && !Array.isArray(args) ? Object.values(args)[i] ?? args[i] : (args ? (Array.isArray(args) ? args[i] : args) : 0);
    if (t === 'u64') parts.push(scaleU64(v));
    else if (t === 'u128') parts.push(scaleU128(v));
    else if (t === 'address') parts.push(scaleAddress(v));
    else if (t === 'string') parts.push(scaleString(v));
    else if (t === 'vec_u128') parts.push(scaleVec(scaleU128)(v));
    else if (t === 'vec_address') parts.push(scaleVec(scaleAddress)(v));
    else if (t === 'option_vec_u128') parts.push(v && v.length ? new Uint8Array([0x01, ...scaleVec(scaleU128)(v)]) : new Uint8Array([0x00]));
    else if (t === 'option_u128') parts.push(v != null ? new Uint8Array([0x01, ...scaleU128(v)]) : new Uint8Array([0x00]));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const r = new Uint8Array(total); let o = 0;
  for (const p of parts) { r.set(p, o); o += p.length; }
  return r;
}

function scaleDecodeCompact(data, offset) {
  const m = data[offset] & 0x03;
  if (m === 0) return [data[offset] >> 2, offset + 1];
  if (m === 1) return [((data[offset + 1] << 8) | data[offset]) >> 2, offset + 2];
  if (m === 2) return [((data[offset + 3] << 24) | (data[offset + 2] << 16) | (data[offset + 1] << 8) | data[offset]) >> 2, offset + 4];
  const len = ((data[offset + 3] << 24) | (data[offset + 2] << 16) | (data[offset + 1] << 8) | data[offset]) >> 2;
  let v = 0n;
  for (let i = offset + 4 + len - 1; i >= offset + 4; i--) v = (v << 8n) | BigInt(data[i]);
  return [v, offset + 4 + len];
}

function scaleDecodeU128(data, offset) {
  let v = 0n;
  for (let i = offset + 15; i >= offset; i--) v = (v << 8n) | BigInt(data[i]);
  return v;
}

function scaleDecodeI128(data, offset) {
  let v = 0n;
  for (let i = offset + 15; i >= offset; i--) v = (v << 8n) | BigInt(data[i]);
  if (v >= 1n << 127n) v = v - (1n << 128n);
  return v;
}

function scaleDecodeU64(data, offset) {
  let v = 0n;
  for (let i = offset + 7; i >= offset; i--) v = (v << 8n) | BigInt(data[i]);
  return v;
}

function scaleDecodeAddress(data, offset) {
  return '0x' + Array.from(data.slice(offset, offset + 32)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function scaleDecodeVec(data, offset, decFn, elemSize) {
  const [len, no] = scaleDecodeCompact(data, offset);
  const items = [];
  let o = no;
  for (let i = 0; i < len; i++) {
    if (elemSize > 0) { items.push(decFn(data, o)); o += elemSize; }
    else { const [v, no2] = decFn(data, o); items.push(v); o = no2; }
  }
  return [items, o];
}

function decodeScaleResult(hex, schema) {
  if (!hex || hex === '0x' || hex === '0x00') return null;
  const data = hexToBytes(hex);
  let offset = 0;
  const obj = {}; const arr = [];
  for (let i = 0; i < schema.length; i++) {
    const t = schema[i]; let v;
    if (t === 'u128') { v = scaleDecodeU128(data, offset); offset += 16; }
    else if (t === 'i128') { v = scaleDecodeI128(data, offset); offset += 16; }
    else if (t === 'u64') { v = scaleDecodeU64(data, offset); offset += 8; }
    else if (t === 'u32') { v = data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24); offset += 4; }
    else if (t === 'u8') { v = data[offset]; offset += 1; }
    else if (t === 'address') { v = scaleDecodeAddress(data, offset); offset += 32; }
    else if (t === 'vec_u128') { const [items, no] = scaleDecodeVec(data, offset, scaleDecodeU128, 16); v = items; offset = no; }
    else if (t === 'vec_address') { const [items, no] = scaleDecodeVec(data, offset, scaleDecodeAddress, 32); v = items; offset = no; }
    obj[i] = v; arr.push(v);
  }
  return { ...obj, _arr: arr };
}

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function ss58ToHex(ss58) {
  const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let val = 0n;
  for (const ch of ss58) { const i = BASE58.indexOf(ch); if (i === -1) return null; val = val * 58n + BigInt(i); }
  const bytes = [];
  while (val > 0n) { bytes.unshift(Number(val & 0xFFn)); val >>= 8n; }
  if (bytes.length === 35) return '0x' + bytes.slice(1, 33).map(b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.length === 36) return '0x' + bytes.slice(2, 34).map(b => b.toString(16).padStart(2, '0')).join('');
  return null;
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Polkadot',
  logo: 'img/logos/polkadot.svg',
  defaultRpc: POLKADOT_NETWORKS.testnet.rpc,
  defaultFactory: null,
  network: 'testnet',
  chainId: null,
  explorer: POLKADOT_NETWORKS.testnet.explorer,
  configs: POLKADOT_NETWORKS,

  setNetwork(network) {
    const cfg = POLKADOT_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(POLKADOT_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[Polkadot] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
    console.log(`  RPC: ${cfg.rpc}`);
    console.log(`  Explorer: ${cfg.explorer}`);
  },

  async loadSDK() {
    if (typeof window.injectedWeb3 !== 'undefined') return true;
    return false;
  },

  async connectWallet() {
    if (typeof window.injectedWeb3 === 'undefined') throw new Error('polkadot.js extension not detected');
    const ext = window.injectedWeb3['polkadot-js'];
    if (!ext) throw new Error('polkadot.js extension not found. Install from https://polkadot.js.org/extension/');
    injector = await ext.enable('reciprocity-ui');
    accounts = await injector.accounts.get();
    if (!accounts.length) throw new Error('No accounts found in polkadot.js extension');
    const acc = accounts[0].address;
    console.log(`%c[Polkadot] %cconnectWallet`, 'color:#888', 'color:#3dcf8e', this.shortenAddress(acc));
    return { account: acc, provider: injector, networkName: this.network };
  },

  async _call(contract, method, args) {
    const url = this.defaultRpc;
    const encoded = scaleEncodeArgs(method, args);
    const result = await this.rpcCall(url, 'contracts_call', [{
      dest: contract,
      input_data: bytesToHex(encoded),
      gas_limit: 5000000000,
      storage_deposit_limit: null,
    }]);
    const schema = RETURN_SCHEMAS[method];
    if (schema && result) return decodeScaleResult(result, schema);
    return result;
  },

  async _exec(contract, method, args) {
    const acc = accounts[0];
    if (!injector) throw new Error('Wallet not connected');

    const url = this.defaultRpc;
    const nonce = await this.rpcCall(url, 'system_accountNextIndex', [acc.address]);
    const metadata = await this.rpcCall(url, 'state_getMetadata', []);
    const specVersion = metadata ? parseInt(metadata.slice(2, 10), 16) : 100;

    const encoded = scaleEncodeArgs(method, args);
    const palletIndex = 4;
    const callIndex = 0;

    const destPrefix = new Uint8Array([0x00]);
    const destAddr = scaleAddress(contract);
    const value = new Uint8Array([0x00]);
    const gasLimit = scaleCompact(5000000000);
    const storageDepositLimit = new Uint8Array([0x00]);
    const dataLen = scaleCompact(encoded.length);
    const data = new Uint8Array(dataLen.length + encoded.length);
    data.set(dataLen);
    data.set(encoded, dataLen.length);

    const callParts = [
      new Uint8Array([palletIndex, callIndex]),
      destPrefix,
      destAddr,
      value,
      gasLimit,
      storageDepositLimit,
      data,
    ];
    const totalLen = callParts.reduce((s, p) => s + p.length, 0);
    const callBuf = new Uint8Array(totalLen);
    let off = 0;
    for (const p of callParts) { callBuf.set(p, off); off += p.length; }
    const callData = '0x' + Array.from(callBuf).map(b => b.toString(16).padStart(2, '0')).join('');

    const era = '00';
    const blockHash = await this.rpcCall(url, 'chain_getBlockHash', []);
    const genesisHash = await this.rpcCall(url, 'chain_getBlockHash', [0]);

    const payload = {
      specVersion: specVersion,
      txVersion: 1,
      genesisHash: genesisHash,
      blockHash: blockHash,
      method: 'Contracts.call',
      version: 4,
      nonce: nonce,
      tip: 0,
      era: era,
      call: callData,
    };

    const signed = await injector.signer.signPayload(acc.address, payload);
    const ext = bytesToHex(signed.signature) + callData;
    const txHash = await this.rpcCall(url, 'author_submitExtrinsic', [ext]);
    return txHash;
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const r = await this._call(poolAddr, 'getBalances', {});
      return {
        tokens: (r?.tokens || r?.[0] || []).map(String),
        amounts: (r?.amounts || r?.[1] || []).map(BigInt),
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const r = await this._call(poolAddr, 'getStatus', {});
      return {
        supply: BigInt(r?.[0] ?? 0),
        atrSpreadTarget: BigInt(r?.[1] ?? 0),
        emaSpreadTarget: BigInt(r?.[2] ?? 0),
        atrPeriod: BigInt(r?.[3] ?? 0),
        emaPeriod: BigInt(r?.[4] ?? 0),
        atrSpread: BigInt(r?.[5] ?? 0),
        spreadAdditive: BigInt(r?.[6] ?? 0),
        txs: BigInt(r?.[10] ?? 0),
      };
    });
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const r = await this._call(poolAddr, 'getTvwapState', {});
      return {
        tvwap15m: BigInt(r?.[0] ?? 0),
        accW15m: BigInt(r?.[1] ?? 0),
        windowStart15m: BigInt(r?.[2] ?? 0),
        tvwap1hr: BigInt(r?.[3] ?? 0),
        accW1hr: BigInt(r?.[4] ?? 0),
        windowStart1hr: BigInt(r?.[5] ?? 0),
        tvwap24hr: BigInt(r?.[6] ?? 0),
        accW24hr: BigInt(r?.[7] ?? 0),
        windowStart24hr: BigInt(r?.[8] ?? 0),
        lastTimestamp: BigInt(r?.[9] ?? 0),
        currentK: BigInt(r?.[10] ?? 0),
      };
    });
  },

  async consult(poolAddr, secondsAgo) {
    const r = await this._call(poolAddr, 'consult', [secondsAgo]);
    return BigInt(r?.[0] ?? 0);
  },

  async getTvwapPrices(poolAddr, secondsAgo) {
    return trace(`getTvwapPrices(${secondsAgo}s)`)(async () => {
      const tvwapK = await this.consult(poolAddr, secondsAgo);
      const bals = await this.getBalances(poolAddr);
      return window.reciprocity_math.getTvwapPrices(tvwapK, bals.amounts, bals.tokens);
    });
  },

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const r = await this._call(poolAddr, 'getSupply', {});
    return BigInt(r?.[0] ?? 0);
  },

  async getKonstant(poolAddr) {
    const r = await this._call(poolAddr, 'consult', [0]);
    return BigInt(r?.[0] ?? 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const [r, status] = await Promise.all([
        this._call(poolAddr, 'getPoolConfig', {}),
        this._call(poolAddr, 'getStatus', {}),
      ]);
      return {
        tokens: (r?.[0] || []).map(String),
        balances: (r?.[1] || []).map(BigInt),
        genesis: (r?.[2] || []).map(BigInt),
        factors: Number(r?.[3] ?? 0),
        scale: BigInt(r?.[4] ?? 0),
        atr_spread_target: BigInt(r?.[5] ?? ATR_SPREAD_TARGET),
        ema_spread_target: BigInt(r?.[6] ?? EMA_SPREAD_TARGET),
        atr_period: BigInt(r?.[7] ?? ATR_PERIOD),
        ema_period: BigInt(r?.[8] ?? EMA_PERIOD),
        spread_multiplier: BigInt(r?.[9] ?? BASIS),
        supply: BigInt(r?.[10] ?? 0),
        spread_count: Number(r?.[11] ?? 0),
        weights: (r?.[12] || []).map(BigInt),
        atr_spread: BigInt(status?.[5] ?? 0),
        spread_additive: BigInt(status?.[6] ?? 0),
      };
    });
  },

  async quoteSwap(poolAddr, order) {
    return trace('quoteSwap')(async () => {
      const [pd, status] = await Promise.all([
        this.getPoolConfig(poolAddr),
        this.getStatus(poolAddr),
      ]);
      pd.spread_additive = status.spreadAdditive;
      return window.reciprocity_math.quoteSwap(pd, order);
    });
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      return await this._exec(poolAddr, 'swap', [
        order.tokensIn,
        order.amountsIn.map(a => a.toString()),
        order.tokensOut,
        order.amountsOut.map(a => a.toString()),
        order.sharesIn.toString(),
        order.minSharesOut.toString(),
        deadlineTs.toString(),
      ]);
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () => {
      return await this._exec(poolAddr, 'addLiquidity', [
        tokens,
        amounts.map(a => a.toString()),
        minShares.toString(),
        weights || [],
        (atrSpreadTarget || 0).toString(),
        (emaSpreadTarget || 0).toString(),
        (atrPeriod || 0).toString(),
        (emaPeriod || 0).toString(),
        deadlineTs.toString(),
      ]);
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      return await this._exec(poolAddr, 'removeLiquidity', [
        shares.toString(),
        minTokensOut.map(a => a.toString()),
        deadlineTs.toString(),
      ]);
    });
  },

  async getTokenSymbol(tokenAddr) {
    return this.shortenAddress(tokenAddr);
  },

  async getTokenDecimals(tokenAddr) { return 12; },

  async getTokenBalance(tokenAddr, account) {
    try {
      const addr = !account.startsWith('0x') && ss58ToHex(account) || account;
      const r = await this._call(tokenAddr, 'balance_of', [addr]);
      return BigInt(r?.[0] ?? 0);
    } catch {
      try {
        const res = await this.rpcCall(this.defaultRpc, 'system_account', [account]);
        return BigInt(res?.data?.free || res?.free || 0);
      } catch { return 0n; }
    }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    try {
      const addr = !poolAddr.startsWith('0x') && ss58ToHex(poolAddr) || poolAddr;
      const r = await this._call(tokenAddr, 'balance_of', [addr]);
      return BigInt(r?.[0] ?? 0);
    } catch {
      try {
        const res = await this.rpcCall(this.defaultRpc, 'system_account', [poolAddr]);
        return BigInt(res?.data?.free || res?.free || 0);
      } catch { return 0n; }
    }
  },

  async approveIfNeeded() { return; },

  async getPoolCount(factoryAddr) {
    return trace('getPoolCount')(async () => {
      const r = await this._call(factoryAddr, 'getPoolCount', {});
      return Number(r?.[0] ?? 0);
    });
  },

  async getPools(factoryAddr) {
    return trace('getPools')(async () => {
      const r = await this._call(factoryAddr, 'getPools', {});
      return (r?.[0] || []).map(String);
    });
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () =>
      this._exec(poolAddr, 'setFounder', [newFounder])
    );
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () =>
      this._exec(poolAddr, 'setFounderFund', [fund])
    );
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () =>
      this._exec(poolAddr, 'claimFounderRoyalty', [token])
    );
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () =>
      this._exec(poolAddr, 'setPromoter', [newPromoter])
    );
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () =>
      this._exec(poolAddr, 'setPromoterFund', [fund])
    );
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () =>
      this._exec(poolAddr, 'claimPromoterRoyalty', [token])
    );
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const r = await this._call(poolAddr, 'getAdminState', {});
      return {
        factory: r?.[0] || null,
        founder: r?.[1] || null,
        founderFund: r?.[2] || null,
        promoter: r?.[3] || null,
        promoterFund: r?.[4] || null,
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      try {
        const r = await this._call(poolAddr, 'getFounderRoyalties', {});
        return { tokens: (r?.[0] || []).map(String), amounts: (r?.[1] || []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const r = await this._call(poolAddr, 'getPromoterRoyalties', {});
        return { tokens: (r?.[0] || []).map(String), amounts: (r?.[1] || []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const r = await this._call(poolAddr, 'getFounderRoyalty', [token]);
      return BigInt(r?.[0] ?? 0);
    } catch { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const r = await this._call(poolAddr, 'getPromoterRoyalty', [token]);
      return BigInt(r?.[0] ?? 0);
    } catch { return 0n; }
  },

  isValidAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    if (/^0x[0-9a-fA-F]{64}$/.test(addr)) return true;
    if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr) && addr.length >= 3 && addr.length <= 54) return true;
    return false;
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 16) return addr;
    if (addr.startsWith('0x')) return addr.slice(0, 8) + '\u2026' + addr.slice(-6);
    return addr.slice(0, 6) + '\u2026' + addr.slice(-4);
  },

  async getBlock() {
    const header = await this.rpcCall(this.defaultRpc, 'chain_getHeader', []);
    return { currentBlock: Number(header.number) };
  },

  async getNonce(poolAddr) {
    const r = await this._call(poolAddr, 'getStatus', {});
    return Number(r?.[10] ?? 0);
  },
});

window.chainAPI_polkadot = chainAPI;
})();
