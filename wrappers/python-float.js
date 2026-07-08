// SPDX-License-Identifier: MIT
var BASE = 'http://localhost:3906/api';

var _poolLoaded = false;
var _account = '0xpython_demo';
var _chainId = 'python-float';
var _instrument = 'pool';

async function _fetch(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}
function _get(path) { return _fetch('GET', path); }
function _post(path, body) { return _fetch('POST', path, body); }

var TOKEN_NAMES = { 'A': 'A', 'B': 'B', 'C': 'C' };

function _tokenName(addr) {
  return TOKEN_NAMES[addr] || addr;
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Python Float Ref',
  logo: 'img/logos/python.svg',
  network: 'python-demo',
  chainId: _chainId,
  defaultRpc: BASE,
  defaultFactory: null,
  explorer: '',
  configs: { 'python-demo': { rpc: BASE, factory: null, explorer: '' } },

  async connectWallet() {
    const h = await _get('/health');
    if (!h.ok) throw new Error('Python server not reachable');
    return { account: _account, provider: null, networkName: 'python-demo' };
  },
  isConnected() { return true; },
  getAccount() { return _account; },
  getChainId() { return _chainId; },
  setNetwork(net) { return; },

  async getBalances(poolAddr) {
    const r = await _get('/pool/balances');
    return { tokens: r.tokens, amounts: r.amounts.map(BigInt) };
  },

  async getStatus(poolAddr) {
    const r = await _get('/pool/status');
    return {
      supply: BigInt(r.supply),
      atrSpreadTarget: BigInt(r.atrSpreadTarget),
      emaSpreadTarget: BigInt(r.emaSpreadTarget),
      atrPeriod: r.atrPeriod,
      emaPeriod: r.emaPeriod,
      atrSpread: BigInt(r.atrSpread),
      spreadAdditive: BigInt(r.spreadAdditive),
      avgSpread: BigInt(r.avgSpread),
      spreadMultiplier: BigInt(r.spreadMultiplier),
      lpRoyalties: (r.lpRoyalties || []).map(BigInt),
      txs: BigInt(r.txs),
    };
  },

  async getTvwapPrices(poolAddr, secondsAgo) {
    const tvwapK = BigInt(await _get('/pool/consult/' + secondsAgo));
    const bals = await this.getBalances(poolAddr);
    return window.reciprocity_math.getTvwapPrices(tvwapK, bals.amounts, bals.tokens);
  },

  async getTvwapState(poolAddr) {
    const r = await _get('/pool/tvwap-state');
    return {
      tvwap15m: BigInt(r.tvwap15m),
      accW15m: BigInt(r.accW15m),
      windowStart15m: BigInt(r.windowStart15m),
      tvwap1hr: BigInt(r.tvwap1hr),
      accW1hr: BigInt(r.accW1hr),
      windowStart1hr: BigInt(r.windowStart1hr),
      tvwap24hr: BigInt(r.tvwap24hr),
      accW24hr: BigInt(r.accW24hr),
      windowStart24hr: BigInt(r.windowStart24hr),
      lastTimestamp: BigInt(r.last_timestamp),
      currentK: BigInt(r.current_k),
    };
  },

  async getLPToken(poolAddr) { return poolAddr + '-lp'; },

  async getSupply(poolAddr) {
    const s = await _get('/pool/status');
    return BigInt(s.supply);
  },

  async getKonstant(poolAddr) {
    return BigInt(await _get('/pool/consult/0'));
  },

  async consult(poolAddr, secondsAgo) {
    return BigInt(await _get('/pool/consult/' + secondsAgo));
  },

  async getPoolConfig(poolAddr) {
    const r = await _get('/pool/config');
    return {
      tokens: r.tokens,
      balances: (r.balances || []).map(BigInt),
      genesis: (r.genesis || []).map(BigInt),
      factors: Number(r.factors || 0),
      scale: BigInt(r.scale || 0),
      atr_spread_target: BigInt(r.atr_spread_target || 0),
      spread_multiplier: BigInt(r.spread_multiplier || 0),
      supply: BigInt(r.supply || 0),
      weights: (r.weights || []).map(BigInt),
    };
  },

  async getTokenSymbol(addr) { return _tokenName(addr); },
  async getTokenDecimals(addr) { return 6; },
  async getTokenBalance(tokenAddr, account) { return 1000000n; },
  async getPoolTokenBalance(tokenAddr, poolAddr) {
    const bals = await this.getBalances(poolAddr);
    const idx = bals.tokens.indexOf(_tokenName(tokenAddr));
    return idx >= 0 ? bals.amounts[idx] : 0n;
  },
  async approveIfNeeded(tokenAddr, spender, owner, amount) {},

  async executeSwap(poolAddr, order, deadline) {
    const r = await _post('/pool/swap', order);
    return JSON.stringify(r);
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights,
                     atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod,
                     deadline) {
    const r = await _post('/pool/add-liquidity', {
      tokens, amounts,
      min_shares: minShares,
      weights: weights || [],
      atr_spread_target: atrSpreadTarget || null,
      ema_spread_target: emaSpreadTarget || null,
      atr_period: atrPeriod || null,
      ema_period: emaPeriod || null,
    });
    return JSON.stringify(r);
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline) {
    const r = await _post('/pool/remove-liquidity', {
      shares: shares.toString(),
      min_tokens_out: (minTokensOut || []).map(String),
    });
    return JSON.stringify(r);
  },

  async simulateSwap(poolAddr, order) {
    const r = await _post('/pool/quote-swap', order);
    return {
      tokensOut: r.tokensOut,
      amountsOut: (r.amountsOut || []).map(BigInt),
      reciprocity: BigInt(r.reciprocity || 0),
      success: true,
    };
  },

  async getNonce(poolAddr) {
    const r = await _get('/pool/version');
    return r.nonce;
  },

  async getBlock(poolAddr) {
    const r = await _get('/pool/block');
    return { currentBlock: r.current_block, lastTxBlock: r.last_tx_block };
  },

  async getAdminState(poolAddr) {
    return _get('/pool/admin');
  },

  async getFounderRoyalties(poolAddr) {
    return _get('/pool/founder-royalties');
  },

  async getPromoterRoyalties(poolAddr) {
    return _get('/pool/promoter-royalties');
  },

  async setFounder(poolAddr, newFounder) {
    return JSON.stringify(await _post('/pool/set-founder', { founder: newFounder }));
  },

  async setFounderFund(poolAddr, fund) {
    return JSON.stringify(await _post('/pool/set-founder-fund', { fund }));
  },

  async claimFounderRoyalty(poolAddr, token) {
    return JSON.stringify(await _post('/pool/claim-founder', { token }));
  },

  async setPromoter(poolAddr, newPromoter) {
    return JSON.stringify(await _post('/pool/set-promoter', { promoter: newPromoter }));
  },

  async setPromoterFund(poolAddr, fund) {
    return JSON.stringify(await _post('/pool/set-promoter-fund', { fund }));
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return JSON.stringify(await _post('/pool/claim-promoter', { token }));
  },

  async getPoolCount(factoryAddr) { return 1n; },
  async getPools(factoryAddr) {
    const h = await _get('/health');
    return h.pool_loaded ? [_instrument] : [];
  },

  async isValidAddress(addr) {
    return typeof addr === 'string' && addr.length > 0;
  },

  async loadSDK() { return true; },
  getBalance() { return 0n; },
  switchChain() {},
  parseError(e) { return e.error || e.message || 'Python adapter error'; },
  isSupportedChain(id) { return id === _chainId; },
  getProvider() { return null; },
  getSigner() { return null; },

  async loadPool(instrument, tokens, amounts, weights) {
    const r = await _post('/pool/load', { instrument, tokens, amounts, weights });
    _poolLoaded = true;
    _instrument = instrument;
    return r;
  },
});

window.chainAPI = chainAPI;
void "window.chainAPI_python-float";
window['chainAPI_python-float'] = chainAPI;
