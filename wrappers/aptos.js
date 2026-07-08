// SPDX-License-Identifier: MIT
(function() {
const APTOS_NETWORKS = {
  testnet: {
    rpc: 'https://fullnode.testnet.aptoslabs.com',
    explorer: 'https://explorer.aptoslabs.com/?network=testnet',
  },
  mainnet: {
    rpc: 'https://fullnode.mainnet.aptoslabs.com',
    explorer: 'https://explorer.aptoslabs.com/?network=mainnet',
  },
};

let walletAddr = null;
let walletProvider = null;

const trace = makeTrace('Aptos');

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Aptos',
  logo: 'img/logos/aptos.svg',
  defaultRpc: APTOS_NETWORKS.testnet.rpc,
  defaultFactory: null,
  moduleAddress: null,
  network: 'testnet',
  chainId: null,
  explorer: APTOS_NETWORKS.testnet.explorer,
  configs: APTOS_NETWORKS,

  setNetwork(network) {
    const cfg = APTOS_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(APTOS_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[Aptos] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() { return true; },

  async connectWallet() {
    const wallet = window.aptos || window.martian;
    if (!wallet) throw new Error('Petra or Martian wallet not detected');
    walletProvider = wallet;
    const res = await wallet.connect();
    const addr = res?.address || (typeof res === 'string' ? res : null);
    if (!addr) throw new Error('No account returned');
    walletAddr = addr;
    return { account: addr, provider: wallet, networkName: this.network };
  },

  async _view(fnName, typeArgs, args) {
    const payload = {
      function: fnName,
      type_arguments: typeArgs || [],
      arguments: args || [],
    };
    const res = await fetch(`${this.defaultRpc}/v1/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  },

  async _exec(fnName, typeArgs, args) {
    if (!walletProvider) throw new Error('Wallet not connected');
    const txn = await walletProvider.signAndSubmitTransaction({
      function: fnName,
      type_arguments: typeArgs || [],
      arguments: args || [],
    });
    return txn?.hash || '';
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_balances`, [], [poolAddr]);
      const wgtData = await this._view(`${this.moduleAddress}::pool::get_weights`, [], [poolAddr]).catch(() => []);
      return {
        tokens: (data?.[0] || []).map(String),
        amounts: (data?.[1] || []).map(BigInt),
        weights: (wgtData || []).map(BigInt),
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_status`, [], [poolAddr]);
      return {
        supply: BigInt(data?.[0] || 0),
        atrSpreadTarget: BigInt(data?.[1] || 0),
        emaSpreadTarget: BigInt(data?.[2] || 0),
        atrPeriod: BigInt(data?.[3] || 0),
        emaPeriod: BigInt(data?.[4] || 0),
        atrSpread: BigInt(data?.[5] || 0),
        spreadAdditive: BigInt(data?.[6] || 0),
        avgSpread: BigInt(data?.[7] || 0),
        spreadMultiplier: BigInt(data?.[8] || 0),
        lpRoyalties: data?.[9] ?? [],
        txs: BigInt(data?.[10] || 0),
      };
    });
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_tvwap_state`, [], [poolAddr]);
      return {
        tvwap15m: BigInt(data?.[0] || 0),
        accW15m: BigInt(data?.[1] || 0),
        windowStart15m: BigInt(data?.[2] || 0),
        tvwap1hr: BigInt(data?.[3] || 0),
        accW1hr: BigInt(data?.[4] || 0),
        windowStart1hr: BigInt(data?.[5] || 0),
        tvwap24hr: BigInt(data?.[6] || 0),
        accW24hr: BigInt(data?.[7] || 0),
        windowStart24hr: BigInt(data?.[8] || 0),
        lastTimestamp: BigInt(data?.[9] || 0),
        currentK: BigInt(data?.[10] || 0),
      };
    });
  },

  async consult(poolAddr, window) {
    return trace(`consult(${window})`)(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::consult`, [], [poolAddr, window]);
      return BigInt(data?.[0] ?? 0);
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
    const data = await this._view(`${this.moduleAddress}::pool::get_lp_token`, [], [poolAddr]);
    return data?.[0] || poolAddr;
  },

  async getSupply(poolAddr) {
    const data = await this._view(`${this.moduleAddress}::pool::get_supply`, [], [poolAddr]);
    return BigInt(data?.[0] || 0);
  },

  async getKonstant(poolAddr) {
    return await this.consult(poolAddr, 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_pool_config`, [], [poolAddr]);
      const wgtData = await this._view(`${this.moduleAddress}::pool::get_weights`, [], [poolAddr]).catch(() => []);
      return {
        tokens: (data?.[0] || []).map(String),
        balances: (data?.[1] || []).map(BigInt),
        genesis: (data?.[2] || []).map(BigInt),
        factors: Number(data?.[3] ?? 0),
        scale: BigInt(data?.[4] ?? 0),
        atr_spread_target: BigInt(data?.[5] ?? ATR_SPREAD_TARGET),
        ema_spread_target: BigInt(data?.[6] ?? EMA_SPREAD_TARGET),
        atr_period: BigInt(data?.[7] ?? ATR_PERIOD),
        ema_period: BigInt(data?.[8] ?? EMA_PERIOD),
        atr_spread: BigInt(data?.[9] ?? 0),
        spread_multiplier: BigInt(data?.[10] ?? BASIS),
        avg_spread: BigInt(data?.[11] ?? 0),
        supply: BigInt(data?.[12] ?? 0),
        spread_additive: BigInt(data?.[13] ?? 0),
        weights: (wgtData || []).map(BigInt),
      };
    });
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS, coinInType, coinOutType) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () =>
      this._exec(`${this.moduleAddress}::pool::swap_entry`, [coinInType, coinOutType], [
        poolAddr,
        order.tokensIn || [],
        order.amountsIn.map(BigInt).map(String),
        order.tokensOut || [],
        (order.amountsOut || []).map(BigInt).map(String),
        String(order.sharesIn || 0n),
        String(order.minSharesOut || 0n),
        String(deadlineTs),
      ])
    );
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS, coinType) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () =>
      this._exec(`${this.moduleAddress}::pool::add_liquidity_entry`, [coinType], [
        poolAddr,
        amounts.map(BigInt).map(String),
        String(minShares),
        (weights || []).map(String),
        String(atrSpreadTarget || 0),
        String(emaSpreadTarget || 0),
        String(atrPeriod || 0),
        String(emaPeriod || 0),
        String(deadlineTs),
      ])
    );
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS, coinType) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () =>
      this._exec(`${this.moduleAddress}::pool::remove_liquidity`, [coinType], [
        poolAddr,
        String(shares),
        minTokensOut.map(BigInt).map(String),
        String(deadlineTs),
      ])
    );
  },

  async getTokenSymbol(tokenAddr) { return this.shortenAddress(tokenAddr); },
  async getTokenDecimals(tokenAddr) { return 8; },

  async getTokenBalance(tokenAddr, account, coinType) {
    try {
      const res = await fetch(`${this.defaultRpc}/v1/account/${account}/resource/0x1::coin::CoinStore<${coinType || tokenAddr}>`);
      const data = await res.json();
      return BigInt(data?.data?.coin?.value || 0);
    } catch { return 0n; }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    return this.getTokenBalance(tokenAddr, poolAddr);
  },

  async approveIfNeeded() { return; },
  async getPoolCount(factoryAddr) {
    try {
      const data = await this._view(`${this.moduleAddress}::factory::get_pool_count`, [], [factoryAddr]);
      return Number(data?.[0] ?? 0);
    } catch { return 0; }
  },
  async getPools(factoryAddr) {
    try {
      const data = await this._view(`${this.moduleAddress}::factory::get_pools`, [], [factoryAddr]);
      return (data?.[0] || []).map(String);
    } catch { return []; }
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () =>
      this._exec(`${this.moduleAddress}::pool::set_founder`, [], [poolAddr, newFounder])
    );
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () =>
      this._exec(`${this.moduleAddress}::pool::set_founder_fund`, [], [poolAddr, fund])
    );
  },

  async claimFounderRoyalty(poolAddr, token, coinType) {
    return trace('claimFounderRoyalty')(async () =>
      this._exec(`${this.moduleAddress}::pool::claim_founder_royalty`, [coinType], [poolAddr, token])
    );
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () =>
      this._exec(`${this.moduleAddress}::pool::set_promoter`, [], [poolAddr, newPromoter])
    );
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () =>
      this._exec(`${this.moduleAddress}::pool::set_promoter_fund`, [], [poolAddr, fund])
    );
  },

  async claimPromoterRoyalty(poolAddr, token, coinType) {
    return trace('claimPromoterRoyalty')(async () =>
      this._exec(`${this.moduleAddress}::pool::claim_promoter_royalty`, [coinType], [poolAddr, token])
    );
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_admin_state`, [], [poolAddr]);
      return {
        factory: data?.[0] || null,
        founder: data?.[1] || null,
        founderFund: data?.[2] || null,
        promoter: data?.[3] || null,
        promoterFund: data?.[4] || null,
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_founder_royalties`, [], [poolAddr]);
      return { tokens: (data?.[0] || []).map(String), amounts: (data?.[1] || []).map(BigInt) };
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_promoter_royalties`, [], [poolAddr]);
      return { tokens: (data?.[0] || []).map(String), amounts: (data?.[1] || []).map(BigInt) };
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    return trace('getFounderRoyalty')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_founder_royalty`, [], [poolAddr, token]);
      return BigInt(data?.[0] || 0);
    });
  },

  async getPromoterRoyalty(poolAddr, token) {
    return trace('getPromoterRoyalty')(async () => {
      const data = await this._view(`${this.moduleAddress}::pool::get_promoter_royalty`, [], [poolAddr, token]);
      return BigInt(data?.[0] || 0);
    });
  },

  isValidAddress(addr) {
    return typeof addr === 'string' && addr.startsWith('0x') && addr.length >= 66;
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 16) return addr;
    return addr.slice(0, 8) + '\u2026' + addr.slice(-6);
  },

  async getBlock() {
    const info = await (await fetch(this.defaultRpc + '/v1')).json();
    return { currentBlock: Number(info.block_height) };
  },

  async getLastTxBlock(poolAddr) {
    const res = await fetch(this.defaultRpc + '/v1/transactions?account=' + poolAddr + '&limit=1');
    const txs = await res.json();
    if (!Array.isArray(txs) || txs.length === 0) return null;
    const version = txs[0].version;
    const txRes = await fetch(this.defaultRpc + '/v1/transactions/by_version/' + version);
    const txData = await txRes.json();
    return txData.block_height ? Number(txData.block_height) : null;
  },

  async getNonce(poolAddr) {
    const data = await this._view(`${this.moduleAddress}::pool::get_status`, [], [poolAddr]);
    return Number(data?.[10] ?? 0);
  },
});

window.chainAPI_aptos = chainAPI;
})();
