// SPDX-License-Identifier: MIT
(function() {
const ALEO_NETWORKS = {
  testnet: {
    rpc: 'https://api.explorer.aleo.org/v1/testnet',
    explorer: 'https://explorer.aleo.org/testnet',
    programId: null,
  },
  mainnet: {
    rpc: 'https://api.explorer.aleo.org/v1/mainnet',
    explorer: 'https://explorer.aleo.org',
    programId: null,
  },
};

const ZERO_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000000';

let walletAddr = null;
let walletProvider = null;

const trace = makeTrace('Aleo');

async function rpcGet(url, endpoint) {
  const res = await fetch(url + endpoint);
  if (!res.ok) throw new Error(`Aleo HTTP ${res.status}`);
  return res.json();
}

async function rpcPost(url, endpoint, body) {
  const res = await fetch(url + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Aleo HTTP ${res.status}`);
  return res.json();
}

function isZeroAddr(addr) {
  return !addr || addr === ZERO_ADDR || addr === '0x00';
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Aleo',
  logo: 'img/logos/aleo.svg',
  defaultRpc: ALEO_NETWORKS.testnet.rpc,
  defaultFactory: null,
  network: 'testnet',
  chainId: null,
  explorer: ALEO_NETWORKS.testnet.explorer,
  configs: ALEO_NETWORKS,

  setNetwork(network) {
    const cfg = ALEO_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(ALEO_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[Aleo] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() { return true; },

  async connectWallet() {
    const wallet = window.leoWallet || window.puzzleWallet;
    if (!wallet) throw new Error('Leo Wallet or Puzzle Wallet not detected');
    walletProvider = wallet;
    const res = await wallet.connect();
    const addr = res?.address || res?.publicKey || (typeof res === 'string' ? res : null);
    if (!addr) throw new Error('No account returned');
    walletAddr = addr;
    return { account: addr, provider: wallet };
  },

  async _getMapping(programId, mappingName, key) {
    try {
      const data = await rpcGet(this.defaultRpc, `/program/${programId}/mapping/${mappingName}/${encodeURIComponent(key)}`);
      return data;
    } catch { return null; }
  },

  async _exec(programId, fnName, inputs) {
    if (!walletProvider) throw new Error('Wallet not connected');
    const txn = await walletProvider.requestTransaction({
      programId,
      functionName: fnName,
      inputs: inputs || [],
      fee: 0.02,
    });
    return txn?.transactionId || txn?.txid || '';
  },

  // ══════════════════════════════════════════════════════════
  //  VIEW FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const tokens = [];
      for (let i = 0; i < 8; i++) {
        const t = await this._getMapping(poolAddr, 'tokens', String(i));
        if (t && !isZeroAddr(t)) {
          tokens.push(t);
        } else break;
      }
      const amounts = [];
      for (const tok of tokens) {
        const b = await this._getMapping(poolAddr, 'balances', tok);
        amounts.push(BigInt(b || '0'));
      }
      return { tokens, amounts };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
    const [supply, atrSt, emaSt, atrP, emaP, atrS, txs] = await Promise.all([
        this._getMapping(poolAddr, 'lp_supply', '0'),
        this._getMapping(poolAddr, 'm_atr_spread_target', '0'),
        this._getMapping(poolAddr, 'm_ema_spread_target', '0'),
        this._getMapping(poolAddr, 'm_atr_period', '0'),
        this._getMapping(poolAddr, 'm_ema_period', '0'),
        this._getMapping(poolAddr, 'm_atr_spread', '0'),
        this._getMapping(poolAddr, 'm_transactions', '0'),
    ]);
      return {
        supply: BigInt(supply || '0'),
        atrSpreadTarget: BigInt(atrSt || '0'),
        emaSpreadTarget: BigInt(emaSt || '0'),
        atrPeriod: BigInt(atrP || '0'),
        emaPeriod: BigInt(emaP || '0'),
        atrSpread: BigInt(atrS || '0'),
        spreadAdditive: 0n,
        txs: BigInt(txs || '0'),
      };
    });
  },

  async getTvwapPrices(poolAddr, secondsAgo) {
    const tvwapK = await this.consult(poolAddr, secondsAgo);
    const bals = await this.getBalances(poolAddr);
    return window.reciprocity_math.getTvwapPrices(tvwapK, bals.amounts, bals.tokens);
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const fields = [
        'tvwap_15m', 'acc_w_15m', 'window_start_15m',
        'tvwap_1hr', 'acc_w_1hr', 'window_start_1hr',
        'tvwap_24hr', 'acc_w_24hr', 'window_start_24hr',
        'm_last_height'
      ];
      const vals = {};
      for (const f of fields) {
        const v = await this._getMapping(poolAddr, f, '0');
        vals[f] = BigInt(v || '0');
      }
      const currentK = await this.getKonstant(poolAddr);
      return {
        tvwap15m: vals.tvwap_15m,
        accW15m: vals.acc_w_15m,
        windowStart15m: vals.window_start_15m,
        tvwap1hr: vals.tvwap_1hr,
        accW1hr: vals.acc_w_1hr,
        windowStart1hr: vals.window_start_1hr,
        tvwap24hr: vals.tvwap_24hr,
        accW24hr: vals.acc_w_24hr,
        windowStart24hr: vals.window_start_24hr,
        lastTimestamp: vals.m_last_height,
        currentK,
      };
    });
  },

  async consult(poolAddr, secondsAgo) {
    return trace('consult')(async () => {
      if (secondsAgo === 0) {
        const pd = await this.getPoolConfig(poolAddr);
        return window.reciprocity_math.computeKonstant(pd.balances, pd.genesis, pd.factors, pd.scale, pd.weights);
      }
      const tvwap = await this.getTvwapState(poolAddr);
      if (secondsAgo === 900) {
        if (tvwap.accW15m === 0n) throw new Error('ConsultInvalid: no TVWAP data for 15m window');
        return tvwap.tvwap15m;
      }
      if (secondsAgo === 3600) {
        if (tvwap.accW1hr === 0n) throw new Error('ConsultInvalid: no TVWAP data for 1hr window');
        return tvwap.tvwap1hr;
      }
      if (secondsAgo === 86400) {
        if (tvwap.accW24hr === 0n) throw new Error('ConsultInvalid: no TVWAP data for 24hr window');
        return tvwap.tvwap24hr;
      }
      throw new Error(`ConsultInvalid: invalid secondsAgo=${secondsAgo}`);
    });
  },

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const supply = await this._getMapping(poolAddr, 'lp_supply', '0');
    return BigInt(supply || '0');
  },

  async getKonstant(poolAddr) {
    return await this.consult(poolAddr, 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      // Read token addresses from the tokens mapping (position → address)
      const tokenAddrs = [];
      for (let i = 0; i < 8; i++) {
        const t = await this._getMapping(poolAddr, 'tokens', String(i));
        if (t && !isZeroAddr(t)) {
          tokenAddrs.push(t);
        } else break;
      }
      const n = tokenAddrs.length;

      // Read balances and genesis per token in parallel
      const balPromises = tokenAddrs.map(tok => this._getMapping(poolAddr, 'balances', tok));
      const genPromises = tokenAddrs.map(tok => this._getMapping(poolAddr, 'genesis', tok));
      const [balResults, genResults] = await Promise.all([
        Promise.all(balPromises),
        Promise.all(genPromises),
      ]);

      const balances = balResults.map(b => BigInt(b || '0'));
      const genesis = genResults.map(g => BigInt(g || '0'));

      // Read scalar fields from mappings
      const [scaleData, spreadData, tgtData, emaTgtData, atrPerData, emaPerData, atrSprData, supplyData] = await Promise.all([
        this._getMapping(poolAddr, 'm_scale', '0'),
        this._getMapping(poolAddr, 'm_spread_multiplier', '0'),
        this._getMapping(poolAddr, 'm_atr_spread_target', '0'),
        this._getMapping(poolAddr, 'm_ema_spread_target', '0'),
        this._getMapping(poolAddr, 'm_atr_period', '0'),
        this._getMapping(poolAddr, 'm_ema_period', '0'),
        this._getMapping(poolAddr, 'm_atr_spread', '0'),
        this._getMapping(poolAddr, 'lp_supply', '0'),
      ]);

      // Read weights from mappings (position → weight)
      const weights = [];
      for (let i = 0; i < 8; i++) {
        const w = await this._getMapping(poolAddr, 'm_weights', String(i));
        weights.push(w ? BigInt(w) : 1n);
      }

      return {
        tokens: tokenAddrs,
        balances,
        genesis,
        factors: n,
        scale: BigInt(scaleData || '0'),
        atr_spread_target: BigInt(tgtData || String(ATR_SPREAD_TARGET)),
        ema_spread_target: BigInt(emaTgtData || String(EMA_SPREAD_TARGET)),
        atr_period: BigInt(atrPerData || String(ATR_PERIOD)),
        ema_period: BigInt(emaPerData || String(EMA_PERIOD)),
        atr_spread: BigInt(atrSprData || '0'),
        spread_multiplier: BigInt(spreadData || String(BASIS)),
        supply: BigInt(supplyData || '0'),
        spread_additive: 0n,
        weights: weights.slice(0, n),
      };
    });
  },

  async verifyQuote(poolAddr, order) {
    const localQuote = await this.quoteSwap(poolAddr, order);
    console.log('=== RECIPROCITY VERIFY OFFER ===');
    console.log('Local Quote:', _safeStringify(localQuote));
    console.log('On-Chain: SKIPPED — Aleo ZK model has no on-chain view functions');
    return { verified: true, local: localQuote, onchain: null, match: true, skipped: true };
  },

  // ══════════════════════════════════════════════════════════
  //  WRITE FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineBlocks = deadline > 0 ? Math.floor(deadline / 2) : 0;
    return trace('executeSwap')(async () =>
      this._exec(poolAddr, 'swap', [
        `[${order.amountsIn.map(a => `${a}u128`).join(', ')}]`,
        `[${(order.amountsOut || []).map(a => `${a}u128`).join(', ')}]`,
        order.recipient || walletAddr,
        `${deadlineBlocks}u32`,
      ])
    );
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineBlocks = deadline > 0 ? Math.floor(deadline / 2) : 0;
    // weights and INTEGER2 params are accepted for API consistency; Aleo contract
    // handles these through its own initialization parameters
    return trace('addLiquidity')(async () => {
      const genPromises = tokens.map(tok => this._getMapping(poolAddr, 'genesis', tok));
      const genResults = await Promise.all(genPromises);
      const gens = genResults.map(g => BigInt(g || '0'));
      return this._exec(poolAddr, 'add_liquidity', [
        `[${amounts.map(a => `${a}u128`).join(', ')}]`,
        `[${tokens.join(', ')}]`,
        `[${gens.map(g => `${g}u128`).join(', ')}]`,
        `${deadlineBlocks}u32`,
      ]);
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineBlocks = deadline > 0 ? Math.floor(deadline / 2) : 0;
    return trace('removeLiquidity')(async () =>
      this._exec(poolAddr, 'remove_liquidity', [
        `${shares}u128`,
        `[${minTokensOut.map(a => `${a}u128`).join(', ')}]`,
        `${deadlineBlocks}u32`,
      ])
    );
  },

  // ══════════════════════════════════════════════════════════
  //  TOKEN OPERATIONS
  // ══════════════════════════════════════════════════════════

  async getTokenSymbol(tokenAddr) { return this.shortenAddress(tokenAddr); },
  async getTokenDecimals(tokenAddr) { return 6; },

  async getTokenBalance(tokenAddr, account) {
    try {
      const data = await this._getMapping(tokenAddr, 'account', account);
      return BigInt(data?.balance || data || 0);
    } catch { return 0n; }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    return this.getTokenBalance(tokenAddr, poolAddr);
  },

  async approveIfNeeded() { return; },

  // ══════════════════════════════════════════════════════════
  //  FACTORY VIEWS
  // ══════════════════════════════════════════════════════════

  async getPoolCount(factoryAddr) {
    const data = await this._getMapping(factoryAddr, 'pool_count', '0');
    return BigInt(data || '0');
  },

  async getPools(factoryAddr) {
    const count = await this.getPoolCount(factoryAddr);
    const pools = [];
    const n = Math.min(Number(count), 8);
    for (let i = 0; i < n; i++) {
      const addr = await this._getMapping(factoryAddr, 'pool_registry', String(i));
      if (addr && !isZeroAddr(addr)) pools.push(addr);
    }
    return pools;
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () =>
      this._exec(poolAddr, 'set_founder', [newFounder])
    );
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () =>
      this._exec(poolAddr, 'set_founder_fund', [fund])
    );
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () => {
      const tokenAddrs = [];
      const feeAmounts = [];
      for (let i = 0; i < 8; i++) {
        const t = await this._getMapping(poolAddr, 'tokens', String(i));
        if (t && !isZeroAddr(t)) {
          tokenAddrs.push(t);
          const fee = await this._getMapping(poolAddr, 'accumulated_founder_royalties', t);
          feeAmounts.push(BigInt(fee || '0'));
        } else {
          tokenAddrs.push(ZERO_ADDR);
          feeAmounts.push(0n);
        }
      }
      return this._exec(poolAddr, 'claim_founder_royalty', [
        `[${tokenAddrs.join(', ')}]`,
        `[${feeAmounts.map(a => `${a}u128`).join(', ')}]`,
      ]);
    });
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () =>
      this._exec(poolAddr, 'set_promoter', [newPromoter])
    );
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () =>
      this._exec(poolAddr, 'set_promoter_fund', [fund])
    );
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () => {
      const tokenAddrs = [];
      const feeAmounts = [];
      for (let i = 0; i < 8; i++) {
        const t = await this._getMapping(poolAddr, 'tokens', String(i));
        if (t && !isZeroAddr(t)) {
          tokenAddrs.push(t);
          const fee = await this._getMapping(poolAddr, 'accumulated_promoter_royalties', t);
          feeAmounts.push(BigInt(fee || '0'));
        } else {
          tokenAddrs.push(ZERO_ADDR);
          feeAmounts.push(0n);
        }
      }
      return this._exec(poolAddr, 'claim_promoter_royalty', [
        `[${tokenAddrs.join(', ')}]`,
        `[${feeAmounts.map(a => `${a}u128`).join(', ')}]`,
      ]);
    });
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      console.warn('[Aleo] Admin state fields (founder, promoter, royalty, lock) are not available via off-chain ABI reads on Aleo. These fields exist only in the ephemeral PoolState record.');
      return {
        factory: null, founder: null, founderFund: null,
        promoter: null, promoterFund: null,
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      const tokens = [];
      const amounts = [];
      for (let i = 0; i < 8; i++) {
        const t = await this._getMapping(poolAddr, 'tokens', String(i));
        if (t && !isZeroAddr(t)) {
          tokens.push(t);
          const founder = await this._getMapping(poolAddr, 'accumulated_founder_royalties', t);
          amounts.push(founder ? BigInt(founder) : 0n);
        } else break;
      }
      return { tokens, amounts };
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      const tokens = [];
      const amounts = [];
      for (let i = 0; i < 8; i++) {
        const t = await this._getMapping(poolAddr, 'tokens', String(i));
        if (t && !isZeroAddr(t)) {
          tokens.push(t);
          const promoter = await this._getMapping(poolAddr, 'accumulated_promoter_royalties', t);
          amounts.push(promoter ? BigInt(promoter) : 0n);
        } else break;
      }
      return { tokens, amounts };
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    return trace('getFounderRoyalty')(async () => {
      const founder = await this._getMapping(poolAddr, 'accumulated_founder_royalties', token);
      return founder ? BigInt(founder) : 0n;
    });
  },

  async getPromoterRoyalty(poolAddr, token) {
    return trace('getPromoterRoyalty')(async () => {
      const promoter = await this._getMapping(poolAddr, 'accumulated_promoter_royalties', token);
      return promoter ? BigInt(promoter) : 0n;
    });
  },

  // ══════════════════════════════════════════════════════════
  //  ADDRESS UTILITIES
  // ══════════════════════════════════════════════════════════

  isValidAddress(addr) {
    return typeof addr === 'string' && addr.endsWith('.aleo') && addr.length > 10;
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 16) return addr;
    const parts = addr.split('.');
    if (parts.length >= 2 && parts[1] === 'aleo') {
      return parts[0].slice(0, 8) + '\u2026.' + parts[1];
    }
    return addr.slice(0, 8) + '\u2026' + addr.slice(-6);
  },

  async getBlock() {
    const height = await rpcGet(this.defaultRpc, '/latest/height');
    return { currentBlock: Number(height) };
  },

  async getNonce(poolAddr) {
    const txs = await this._getMapping(poolAddr, 'm_transactions', '0');
    return Number(txs || '0');
  },
});

window.chainAPI_aleo = chainAPI;
})();
