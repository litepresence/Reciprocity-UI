// SPDX-License-Identifier: MIT
(function() {
const NEAR_NETWORKS = {
  testnet: {
    networkId: 'testnet',
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    explorer: 'https://testnet.nearblocks.io',
    helperUrl: 'https://helper.testnet.near.org',
  },
  mainnet: {
    networkId: 'mainnet',
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://wallet.near.org',
    explorer: 'https://nearblocks.io',
    helperUrl: 'https://helper.mainnet.near.org',
  },
};

const NEAR_CDNS = [
  'https://cdn.jsdelivr.net/npm/near-api-js@5/dist/near-api-js.min.js',
  'https://unpkg.com/near-api-js@5/dist/near-api-js.min.js',
];

let near = null;
let wallet = null;
let nearApi = null;

const trace = makeTrace('NEAR');

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'NEAR',
  logo: 'img/logos/near.svg',
  defaultRpc: NEAR_NETWORKS.testnet.nodeUrl,
  defaultFactory: null,
  network: 'testnet',
  chainId: null,
  explorer: NEAR_NETWORKS.testnet.explorer,
  configs: NEAR_NETWORKS,

  setNetwork(network) {
    const cfg = NEAR_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(NEAR_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.nodeUrl;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[NEAR] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() {
    if (nearApi) return true;
    for (const url of NEAR_CDNS) {
      try {
        await this.loadScript(url);
        if (typeof window.nearApi !== 'undefined') {
          nearApi = window.nearApi;
          const cfg = NEAR_NETWORKS[this.network || 'testnet'];
          near = await nearApi.connect({
            networkId: cfg.networkId,
            nodeUrl: cfg.nodeUrl,
            walletUrl: cfg.walletUrl,
            helperUrl: cfg.helperUrl,
          });
          wallet = new nearApi.WalletConnection(near, 'reciprocity-ui');
          return true;
        }
      } catch {}
    }
    return false;
  },

  async connectWallet() {
    if (!wallet.isSignedIn()) {
      wallet.requestSignIn();
      throw new Error('Redirecting to NEAR Wallet...');
    }
    const account = wallet.getAccountId();
    console.log(`%c[NEAR] %cconnectWallet`, 'color:#888', 'color:#3dcf8e', account);
    return { account, provider: wallet, networkName: this.network };
  },

  _account() {
    return wallet.account();
  },

  async _view(poolAddr, method, args) {
    return await this._account().viewFunction(poolAddr, method, args || {});
  },

  async _call(poolAddr, method, args, deposit) {
    const result = await this._account().functionCall({
      contractId: poolAddr,
      methodName: method,
      args: args || {},
      gas: '30000000000000',
      attachedDeposit: deposit || '0',
    });
    return result.transaction_outcome?.id || result.transaction?.hash || '';
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const r = await this._view(poolAddr, 'get_balances');
      return {
        tokens: (r.tokens || r[0] || []).map(t => typeof t === 'object' && t.Account ? String(t.Account) : String(t)),
        amounts: (r.amounts || r[1] || []).map(BigInt),
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const r = await this._view(poolAddr, 'get_status');
      return {
        supply: BigInt(r[0] ?? 0),
        atrSpreadTarget: BigInt(r[1] ?? 0),
        emaSpreadTarget: BigInt(r[2] ?? 0),
        atrPeriod: BigInt(r[3] ?? 0),
        emaPeriod: BigInt(r[4] ?? 0),
        atrSpread: BigInt(r[5] ?? 0),
        spreadAdditive: BigInt(r[6] ?? 0),
        txs: BigInt(r[10] ?? 0),
      };
    });
  },

  async consult(poolAddr, secondsAgo) {
    return BigInt(await this._view(poolAddr, 'consult', { seconds_ago: secondsAgo }) || 0);
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const r = await this._view(poolAddr, 'get_tvwap_state');
      return {
        tvwap15m: BigInt(r.tvwap_15m ?? r[0] ?? 0),
        accW15m: BigInt(r.acc_w_15m ?? r[1] ?? 0),
        windowStart15m: Number(r.window_start_15m ?? r[2] ?? 0),
        tvwap1hr: BigInt(r.tvwap_1hr ?? r[3] ?? 0),
        accW1hr: BigInt(r.acc_w_1hr ?? r[4] ?? 0),
        windowStart1hr: Number(r.window_start_1hr ?? r[5] ?? 0),
        tvwap24hr: BigInt(r.tvwap_24hr ?? r[6] ?? 0),
        accW24hr: BigInt(r.acc_w_24hr ?? r[7] ?? 0),
        windowStart24hr: Number(r.window_start_24hr ?? r[8] ?? 0),
        lastTimestamp: Number(r.last_timestamp ?? r[9] ?? 0),
        currentK: BigInt(r.current_k ?? r[10] ?? 0),
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

  async getLPToken(poolAddr) {
    return await this._view(poolAddr, 'get_lp_token');
  },

  async getSupply(poolAddr) {
    return BigInt(await this._view(poolAddr, 'get_supply') || 0);
  },

  async getKonstant(poolAddr) {
    const r = await this._view(poolAddr, 'consult', { seconds_ago: 0 });
    return BigInt(r || 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const [r, status] = await Promise.all([
        this._view(poolAddr, 'get_pool_config'),
        this._view(poolAddr, 'get_status'),
      ]);
      return {
        tokens: (r.tokens || r[0] || []).map(String),
        balances: (r.balances || r[1] || []).map(BigInt),
        genesis: (r.genesis || r[2] || []).map(BigInt),
        factors: Number(r.factors ?? r[3] ?? 0),
        scale: BigInt(r.scale ?? r[4] ?? 0),
        atr_spread_target: BigInt(r.atr_spread_target ?? r[5] ?? ATR_SPREAD_TARGET),
        spread_multiplier: BigInt(r.spread_multiplier ?? r[6] ?? BASIS),
        supply: BigInt(r.supply ?? r[7] ?? 0),
        ema_spread_target: BigInt(status.ema_spread_target ?? status[2] ?? EMA_SPREAD_TARGET),
        atr_period: BigInt(status.atr_period ?? status[3] ?? ATR_PERIOD),
        ema_period: BigInt(status.ema_period ?? status[4] ?? EMA_PERIOD),
        atr_spread: BigInt(status.atr_spread ?? status[5] ?? 0),
        spread_additive: BigInt(status.spread_additive ?? status[6] ?? 0),
        weights: (r.weights || r[8] || []).map(w => BigInt(w)),
      };
    });
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      return await this._call(poolAddr, 'swap', {
        tokens_in: order.tokensIn,
        amounts_in: order.amountsIn.map(a => a.toString()),
        tokens_out: order.tokensOut,
        amounts_out: order.amountsOut.map(a => a.toString()),
        shares_in: order.sharesIn.toString(),
        min_amounts_out: order.minSharesOut.toString(),
        deadline: String(deadlineTs),
      });
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () => {
      return await this._call(poolAddr, 'add_liquidity', {
        tokens: tokens,
        amounts: amounts.map(a => a.toString()),
        min_shares: minShares.toString(),
        weights: weights && weights.length > 0 ? weights.map(w => w.toString()) : null,
        atr_spread_target: atrSpreadTarget && BigInt(atrSpreadTarget) > 0n ? atrSpreadTarget.toString() : null,
        ema_spread_target: emaSpreadTarget && BigInt(emaSpreadTarget) > 0n ? emaSpreadTarget.toString() : null,
        atr_period: atrPeriod && BigInt(atrPeriod) > 0n ? atrPeriod.toString() : null,
        ema_period: emaPeriod && BigInt(emaPeriod) > 0n ? emaPeriod.toString() : null,
        deadline: String(deadlineTs),
      }, '1');
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      return await this._call(poolAddr, 'remove_liquidity', {
        shares: shares.toString(),
        min_tokens_out: minTokensOut.map(a => a.toString()),
        deadline: String(deadlineTs),
      });
    });
  },

  async getTokenSymbol(tokenAddr) {
    try {
      const meta = await this._view(tokenAddr, 'ft_metadata');
      return meta.symbol || meta.name || this.shortenAddress(tokenAddr);
    } catch {
      return this.shortenAddress(tokenAddr);
    }
  },

  async getTokenDecimals(tokenAddr) {
    try {
      const meta = await this._view(tokenAddr, 'ft_metadata');
      return meta.decimals || 18;
    } catch {
      return 18;
    }
  },

  async getTokenBalance(tokenAddr, account) {
    try {
      const r = await this._view(tokenAddr, 'ft_balance_of', { account_id: account });
      return BigInt(r || 0);
    } catch {
      return 0n;
    }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    try {
      const r = await this._view(tokenAddr, 'ft_balance_of', { account_id: poolAddr });
      return BigInt(r || 0);
    } catch {
      return 0n;
    }
  },

  async approveIfNeeded() {
    return;
  },

  async getPoolCount(factoryAddr) {
    return Number(await this._view(factoryAddr, 'get_pool_count') || 0);
  },

  async getPools(factoryAddr) {
    return await this._view(factoryAddr, 'get_pools') || [];
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () =>
      this._call(poolAddr, 'set_founder', { new_founder: newFounder })
    );
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () =>
      this._call(poolAddr, 'set_founder_fund', { fund: fund })
    );
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () =>
      this._call(poolAddr, 'claim_founder_royalty', { token: token })
    );
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () =>
      this._call(poolAddr, 'set_promoter', { new_promoter: newPromoter })
    );
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () =>
      this._call(poolAddr, 'set_promoter_fund', { fund: fund })
    );
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () =>
      this._call(poolAddr, 'claim_promoter_royalty', { token: token })
    );
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const r = await this._view(poolAddr, 'get_admin_state');
      return {
        factory: r?.factory || null,
        founder: r?.founder || null,
        founderFund: r?.founder_fund || null,
        promoter: r?.promoter || null,
        promoterFund: r?.promoter_fund || null,
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      try {
        const [config, r] = await Promise.all([
          this._view(poolAddr, 'get_pool_config'),
          this._view(poolAddr, 'get_founder_royalties'),
        ]);
        const tokens = (config.tokens || config[0] || []).map(String);
        return { tokens, amounts: (r || []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const [config, r] = await Promise.all([
          this._view(poolAddr, 'get_pool_config'),
          this._view(poolAddr, 'get_promoter_royalties'),
        ]);
        const tokens = (config.tokens || config[0] || []).map(String);
        return { tokens, amounts: (r || []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const r = await this._view(poolAddr, 'get_founder_royalty', { token: token });
      return BigInt(r ?? 0);
    } catch { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const r = await this._view(poolAddr, 'get_promoter_royalty', { token: token });
      return BigInt(r ?? 0);
    } catch { return 0n; }
  },

  isValidAddress(addr) {
    return typeof addr === 'string' && addr.length >= 2 && addr.includes('.');
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 20) return addr;
    return addr.slice(0, 8) + '\u2026' + addr.slice(-8);
  },

  async getBlock() {
    const r = await this.rpcCall(this.defaultRpc, 'block', [{ finality: 'final' }]);
    return { currentBlock: Number(r.header.height) };
  },

  async getNonce(poolAddr) {
    const r = await this._view(poolAddr, 'get_status');
    return Number(r[10] ?? 0);
  },
});

window.chainAPI_near = chainAPI;
})();
