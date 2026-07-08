// SPDX-License-Identifier: MIT
(function() {
const NETWORKS = {
  testnet: {
    rpc: 'https://testnet.bitshares.eu/api',
    ws: 'wss://testnet.bitshares.eu/ws',
    chainId: '39f5e2ede1f8bc1a3a54a2c3b0b6b0b6b0b6b0b6b0b6b0b6b0b6b0b6b0b6b',
    explorer: 'https://testnet.bitshares.eu',
    coreAsset: 'TEST',
  },
  mainnet: {
    rpc: 'https://api.bitshares.org/api',
    ws: 'wss://api.bitshares.org/ws',
    chainId: '4018d7844c78f6a6c41c6a552b89802280fc5c1e7f0d7c1e7f0d7c1e7f0d7c',
    explorer: 'https://blocksights.info',
    coreAsset: 'BTS',
  },
};

let walletExt = null;
let currentAccount = null;
let currentNetwork = 'testnet';

async function rpcCall(method, params) {
  const url = NETWORKS[currentNetwork].rpc;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: ['database_api', method, params] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function signAndBroadcast(op) {
  if (!walletExt) throw new Error('Wallet extension not connected');
  const signed = await walletExt.signTransaction({
    operations: [[op.type_id, op]],
    extensions: [],
  });
  const tx = signed.signed || signed;
  const url = NETWORKS[currentNetwork].rpc;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'call', params: ['network_broadcast_api', 'broadcast_transaction', [tx]] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function uint64(v) { return typeof v === 'bigint' ? v : BigInt(v); }

function trace(label) {
  return async (fn) => fn();
}

var chainAPI = {
  name: 'BitShares',
  logo: 'img/logos/bitshares.svg',
  defaultRpc: NETWORKS.testnet.rpc,
  defaultFactory: null,
  network: 'testnet',
  chainId: NETWORKS.testnet.chainId,
  explorer: NETWORKS.testnet.explorer,
  configs: NETWORKS,

  setNetwork(network) {
    const cfg = NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.chainId = cfg.chainId;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[BTS] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
    console.log(`  RPC: ${cfg.rpc}`);
    console.log(`  WS: ${cfg.ws}`);
    console.log(`  Explorer: ${cfg.explorer}`);
  },

  async loadSDK() {
    if (typeof window.bitsharesWallet !== 'undefined') {
      walletExt = window.bitsharesWallet;
      return true;
    }
    return false;
  },

  async connectWallet() {
    if (!walletExt) throw new Error('BitShares wallet extension not detected');
    const account = await walletExt.getAccount();
    currentAccount = account;
    console.log(`%c[BTS] %cconnectWallet`, 'color:#888', 'color:#3dcf8e', account.name || account.id);
    return { account: account.id, provider: walletExt, networkName: currentNetwork };
  },

  async _getPoolObj(poolAddr) {
    const objs = await rpcCall('get_objects', [[poolAddr]]);
    return objs[0];
  },

  async getBalances(poolAddr) {
    return trace(`getBalances(${this.shortenAddress(poolAddr)})`)(async () => {
      const pool = await this._getPoolObj(poolAddr);
      return { tokens: pool.tokens, amounts: pool.balances.map(uint64) };
    });
  },

  async getStatus(poolAddr) {
    return trace(`getStatus(${this.shortenAddress(poolAddr)})`)(async () => {
      const pool = await this._getPoolObj(poolAddr);
      return {
        supply: uint64(pool.supply),
        atrSpreadTarget: uint64(pool.atr_spread_target || 10),
        emaSpreadTarget: uint64(pool.ema_spread_target || 50),
        atrPeriod: uint64(pool.atr_period || 100),
        emaPeriod: uint64(pool.ema_period || 100),
        atrSpread: uint64(pool.atr_spread || 0),
        spreadAdditive: uint64(pool.spread_additive || 0),
        txs: uint64(pool.transactions || 0),
      };
    });
  },

  async getTvwapPrices(poolAddr, secondsAgo) {
    return trace(`getTvwapPrices(${this.shortenAddress(poolAddr)}, ${secondsAgo}s)`)(async () => {
      const pool = await this._getPoolObj(poolAddr);
      const tvwapK = uint64(await rpcCall('get_reciprocity_pool_tvwap', [poolAddr, secondsAgo]));
      const prices = pool.balances.map(b => {
        const bal = uint64(b);
        return bal > 0n ? tvwapK * BASIS / bal : 0n;
      });
      return { tokens: pool.tokens, prices };
    });
  },

  async getTvwapState(poolAddr) {
    return trace(`getTvwapState(${this.shortenAddress(poolAddr)})`)(async () => {
      try {
        return await rpcCall('get_reciprocity_pool_tvwap_state', [poolAddr]);
      } catch {
        const pool = await this._getPoolObj(poolAddr);
        return {
          tvwap15m: uint64(pool.tvwap_15m || 0),
          accW15m: uint64(pool.acc_w_15m || 0),
          windowStart15m: uint64(pool.window_start_15m || 0),
          tvwap1hr: uint64(pool.tvwap_1hr || 0),
          accW1hr: uint64(pool.acc_w_1hr || 0),
          windowStart1hr: uint64(pool.window_start_1hr || 0),
          tvwap24hr: uint64(pool.tvwap_24hr || 0),
          accW24hr: uint64(pool.acc_w_24hr || 0),
          windowStart24hr: uint64(pool.window_start_24hr || 0),
          lastTimestamp: uint64(pool.last_timestamp || 0),
          currentK: uint64(await rpcCall('get_reciprocity_pool_tvwap', [poolAddr, 0])),
        };
      }
    });
  },

  async consult(poolAddr, secondsAgo) {
    return trace(`consult(${secondsAgo}s)`)(async () => {
      return uint64(await rpcCall('get_reciprocity_pool_tvwap', [poolAddr, secondsAgo]));
    });
  },

  async getLPToken(poolAddr) {
    const pool = await this._getPoolObj(poolAddr);
      return pool.lp_token;
  },

  async getSupply(poolAddr) {
    const pool = await this._getPoolObj(poolAddr);
    return uint64(pool.supply || 0);
  },

  async getKonstant(poolAddr) {
    return trace(`getKonstant(${this.shortenAddress(poolAddr)})`)(async () => {
      const r = await rpcCall('get_reciprocity_pool_tvwap', [poolAddr, 0]);
      return uint64(r || 0);
    });
  },

  async getPoolConfig(poolAddr) {
    return trace(`getPoolConfig(${this.shortenAddress(poolAddr)})`)(async () => {
      const pool = await this._getPoolObj(poolAddr);
      return {
        tokens: pool.tokens,
        balances: pool.balances.map(v => BigInt(v)),
        genesis: pool.genesis.map(v => BigInt(v)),
        factors: pool.factors,
        scale: BigInt(pool.scale || 0),
        atr_spread_target: BigInt(pool.atr_spread_target ?? 10),
        ema_spread_target: BigInt(pool.ema_spread_target ?? 50),
        atr_period: BigInt(pool.atr_period ?? 100),
        ema_period: BigInt(pool.ema_period ?? 100),
        atr_spread: BigInt(pool.atr_spread ?? 0),
        spread_additive: BigInt(pool.spread_additive ?? 0),
        spread_multiplier: BigInt(pool.spread_multiplier || 10000),
        supply: BigInt(pool.supply || 0),
        weights: (pool.weights || []).map(w => BigInt(w)),
      };
    });
  },

  async quoteSwap(poolAddr, order) {
    const [pd, status] = await Promise.all([
      this.getPoolConfig(poolAddr),
      this.getStatus(poolAddr),
    ]);
    pd.spread_additive = status.spreadAdditive;
    return window.reciprocity_math.quoteSwap(pd, order);
  },

  async simulateSwap(poolAddr, order) { return this.quoteSwap(poolAddr, order); },

  async verifyQuote(poolAddr, order) {
    const localQuote = await this.quoteSwap(poolAddr, order);
    console.log('=== RECIPROCITY VERIFY OFFER ===');
    console.log('Local Quote:', _safeStringify(localQuote));
    console.log('On-Chain: SKIPPED — BitShares has no on-chain view function architecture');
    return { verified: true, local: localQuote, onchain: null, match: true, skipped: true };
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace(`executeSwap(${this.shortenAddress(poolAddr)})`)(async () => {
      const op = {
        type_id: 87,
        fee: { amount: 0, asset_id: '1.3.0' },
        account: currentAccount,
        pool: poolAddr,
        amounts_to_sell: order.tokensIn.map((t, i) => ({
          amount: String(order.amountsIn[i]),
          asset_id: t,
        })),
        min_to_receive: order.tokensOut.map((t, i) => ({
          amount: String(order.amountsOut[i]),
          asset_id: t,
        })),
        shares_in: String(order.sharesIn || 0),
        min_shares_out: String(order.minSharesOut || 0),
        deadline: String(deadlineTs),
        extensions: [],
      };
      const result = await signAndBroadcast(op);
      return result;
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    // weights and INTEGER2 params are accepted for API consistency; BitShares contract
    // handles these through its own initialization parameters
    return trace(`addLiquidity(${this.shortenAddress(poolAddr)})`)(async () => {
      const op = {
        type_id: 85,
        fee: { amount: 0, asset_id: '1.3.0' },
        account: currentAccount,
        pool: poolAddr,
        amounts: tokens.map((t, i) => ({
          amount: String(amounts[i]),
          asset_id: t,
        })),
        deadline: String(deadlineTs),
        extensions: [],
      };
      const result = await signAndBroadcast(op);
      return result;
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace(`removeLiquidity(${this.shortenAddress(poolAddr)})`)(async () => {
      const lpTokenId = await this.getLPToken(poolAddr);
      const op = {
        type_id: 86,
        fee: { amount: 0, asset_id: '1.3.0' },
        account: currentAccount,
        pool: poolAddr,
        share_amount: {amount: parseInt(shares), asset_id: lpTokenId},
        deadline: String(deadlineTs),
        extensions: [],
      };
      const result = await signAndBroadcast(op);
      return result;
    });
  },

  // ══════════════════════════════════════════════════════════
  //  TOKEN OPERATIONS
  // ══════════════════════════════════════════════════════════

  async getTokenSymbol(tokenAddr) {
    return trace(`symbol(${this.shortenAddress(tokenAddr)})`)(async () => {
      const objs = await rpcCall('get_assets', [[tokenAddr]]);
      if (objs && objs[0]) return objs[0].symbol;
      return this.shortenAddress(tokenAddr);
    });
  },

  async getTokenDecimals(tokenAddr) {
    return trace(`decimals(${this.shortenAddress(tokenAddr)})`)(async () => {
      const objs = await rpcCall('get_assets', [[tokenAddr]]);
      if (objs && objs[0]) return objs[0].precision;
      return 5;
    });
  },

  async getTokenBalance(tokenAddr, account) {
    return trace(`balanceOf(${this.shortenAddress(account)}) @ ${this.shortenAddress(tokenAddr)}`)(async () => {
      const objs = await rpcCall('get_account_balances', [account, [tokenAddr]]);
      return objs && objs[0] ? uint64(objs[0].amount) : 0n;
    });
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    return trace(`pool balance @ ${this.shortenAddress(tokenAddr)}`)(async () => {
      const pool = await this._getPoolObj(poolAddr);
      const assets = pool.tokens;
      const idx = assets.indexOf(tokenAddr);
      if (idx === -1) return 0n;
      return uint64(pool.balances[idx]);
    });
  },

  async approveIfNeeded(tokenAddr, spender, owner, amount) {
    return;
  },

  async getPoolCount(factoryAddr) {
    // BitShares has no factory-scoped pool registry.
    // list_liquidity_pools returns all pools globally (paginated, max 1000).
    // factoryAddr is logged but ignored — BitShares Reciprocity pools are
    // identified by 1.19.x object IDs, not factory-deployed.
    return trace(`getPoolCount`)(async () => {
      const pools = await rpcCall('list_reciprocity_pools', [100, '1.19.0']);
      return pools ? pools.length : 0;
    });
  },

  async getPools(factoryAddr) {
    // NOTE: factoryAddr is ignored — BitShares has no factory contracts.
    // All Reciprocity pools are returned via list_liquidity_pools (global namespace, max 1000).
    return trace(`getPools`)(async () => {
      const pools = await rpcCall('list_reciprocity_pools', [1000, '1.19.0']);
      return pools ? pools.map(p => p.id) : [];
    });
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    console.warn('[BTS] setFounder: BitShares has no on-chain operation to change founder authority after pool creation');
    return null;
  },

  async setFounderFund(poolAddr, fund) {
    console.warn('[BTS] setFounderFund: BitShares has no on-chain operation to change founder fund after pool creation');
    return null;
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace(`claimFounderRoyalty(${this.shortenAddress(poolAddr)}, ${this.shortenAddress(token)})`)(async () => {
      const pool = await this._getPoolObj(poolAddr);
      const idx = pool.tokens.indexOf(token);
      if (idx === -1) throw new Error('Token not found in pool');
      const op = {
        type_id: 88,
        fee: { amount: 0, asset_id: '1.3.0' },
        account: currentAccount,
        token: tokenAddr,
        extensions: [],
      };
      return await signAndBroadcast(op);
    });
  },

  async setPromoter(poolAddr, newPromoter) {
    console.warn('[BTS] setPromoter: BitShares has no on-chain operation to change promoter authority after pool creation');
    return null;
  },

  async setPromoterFund(poolAddr, fund) {
    console.warn('[BTS] setPromoterFund: BitShares has no on-chain operation to change promoter fund after pool creation');
    return null;
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace(`claimPromoterRoyalty(${this.shortenAddress(poolAddr)}, ${this.shortenAddress(token)})`)(async () => {
      const pool = await this._getPoolObj(poolAddr);
      const idx = pool.tokens.indexOf(token);
      if (idx === -1) throw new Error('Token not found in pool');
      const op = {
        type_id: 89,
        fee: { amount: 0, asset_id: '1.3.0' },
        account: currentAccount,
        token: tokenAddr,
        extensions: [],
      };
      return await signAndBroadcast(op);
    });
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const pool = await this._getPoolObj(poolAddr);
      return {
        factory: null,
        founder: pool.founder || null,
        founderFund: pool.founder_fund || null,
        promoter: pool.promoter || null,
        promoterFund: pool.promoter_fund || null,
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return trace('getFounderRoyalties')(async () => {
      const pool = await this._getPoolObj(poolAddr);
      return { tokens: (pool.tokens || []).map(String), amounts: (pool.founder_fees || []).map(v => BigInt(v)) };
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      const pool = await this._getPoolObj(poolAddr);
      return { tokens: (pool.tokens || []).map(String), amounts: (pool.promoter_fees || []).map(v => BigInt(v)) };
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    const pool = await this._getPoolObj(poolAddr);
    const idx = pool.tokens.indexOf(token);
    if (idx === -1) return 0n;
    return BigInt((pool.founder_fees || [])[idx] || 0);
  },

  async getPromoterRoyalty(poolAddr, token) {
    const pool = await this._getPoolObj(poolAddr);
    const idx = pool.tokens.indexOf(token);
    if (idx === -1) return 0n;
    return BigInt((pool.promoter_fees || [])[idx] || 0);
  },

  isValidAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    return /^1\.(2|3|19|23|24)\.\d+$/.test(addr);
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    const s = String(addr);
    return s.startsWith('1.2.') ? s : s.slice(0, 6) + '\u2026' + s.slice(-4);
  },

  async getBlock() {
    const props = await rpcCall('get_dynamic_global_properties', []);
    return { currentBlock: Number(props.head_block_number) };
  },

  async getLastTxBlock(poolAddr) {
    const result = await rpcCall('get_relative_account_history', [poolAddr, 0, 1, 1]);
    if (result && result.length > 0) return Number(result[0].block_num);
    return null;
  },

  async getNonce(poolAddr) {
    const pool = await this._getPoolObj(poolAddr);
    return Number(pool.transactions || 0);
  },
};

window.chainAPI_bitshares = chainAPI;
})();
