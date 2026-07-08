// SPDX-License-Identifier: MIT
(function() {
const CAIRO_NETWORKS = {
  sepolia: {
    rpc: 'https://starknet-sepolia.public.blastapi.io',
    explorer: 'https://sepolia.starkscan.co',
    chainId: 'SN_SEPOLIA',
  },
  mainnet: {
    rpc: 'https://starknet-mainnet.public.blastapi.io',
    explorer: 'https://starkscan.co',
    chainId: 'SN_MAIN',
  },
};

let starknet = null;
let provider = null;
let accountAddr = null;

const trace = makeTrace('Cairo');

function feltToStr(felt) {
  if (!felt || felt === '0' || felt === 0n) return '';
  const hex = BigInt(felt).toString(16);
  if (hex.length % 2) return '';
  let str = '';
  for (let i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return str.replace(/\x00/g, '');
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Cairo',
  logo: 'img/logos/starknet.svg',
  defaultRpc: CAIRO_NETWORKS.sepolia.rpc,
  defaultFactory: null,
  network: 'sepolia',
  chainId: CAIRO_NETWORKS.sepolia.chainId,
  explorer: CAIRO_NETWORKS.sepolia.explorer,
  configs: CAIRO_NETWORKS,

  setNetwork(network) {
    const cfg = CAIRO_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(CAIRO_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.chainId = cfg.chainId;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[Cairo] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() {
    return true;
  },

  async connectWallet() {
    if (typeof window.starknet === 'undefined') throw new Error('Argent X or Braavos not detected');
    starknet = window.starknet;
    await starknet.enable();
    const accounts = starknet.account ? [starknet.account.address] : (starknet.selectedAddress ? [starknet.selectedAddress] : []);
    if (!accounts.length) throw new Error('No accounts found');
    accountAddr = accounts[0];
    provider = starknet.provider || starknet;
    console.log(`%c[Cairo] %cconnectWallet`, 'color:#888', 'color:#3dcf8e', this.shortenAddress(accountAddr));
    return { account: accountAddr, provider: starknet, networkName: this.network };
  },

  async _call(contract, entrypoint, calldata) {
    const url = this.defaultRpc;
    const hash = await this._starknetKeccak(entrypoint);
    const result = await this.rpcCall(url, 'starknet_call', [{
      contract_address: contract,
      entry_point_selector: hash,
      calldata: calldata || [],
    }, 'latest']);
    return result;
  },

  async _starknetKeccak(name) {
    if (!this._keccakPromise) {
      this._keccakPromise = import('https://esm.sh/@noble/hashes@1.3.3/sha3').then(m => m.keccak_256);
    }
    const keccak = await this._keccakPromise;
    const data = new TextEncoder().encode(name);
    const hash = keccak(data);
    let val = 0n;
    for (const b of hash) val = (val << 8n) | BigInt(b);
    val &= (1n << 250n) - 1n;
    return '0x' + val.toString(16).padStart(64, '0');
  },

  async _exec(contract, entrypoint, calldata) {
    if (!starknet) throw new Error('Wallet not connected');
    const tx = await starknet.account.execute({
      contractAddress: contract,
      entrypoint: entrypoint,
      calldata: calldata || [],
    });
    await starknet.provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const r = await this._call(poolAddr, 'get_balances', []);
      const poolConfig = await this.getPoolConfig(poolAddr);
      return {
        tokens: poolConfig.tokens,
        amounts: (r || []).map(BigInt),
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const r = await this._call(poolAddr, 'get_status', []);
      const N = Number(r?.[9] ?? 0);
      return {
        supply: BigInt(r?.[0] ?? 0),
        atrSpreadTarget: BigInt(r?.[1] ?? 0),
        emaSpreadTarget: BigInt(r?.[2] ?? 0),
        atrPeriod: BigInt(r?.[3] ?? 0),
        emaPeriod: BigInt(r?.[4] ?? 0),
        atrSpread: BigInt(r?.[5] ?? 0),
        spreadAdditive: BigInt(r?.[6] ?? 0),
        txs: BigInt(r?.[10 + N] ?? 0),
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
      const r = await this._call(poolAddr, 'get_tvwap_state', []);
      return {
        tvwap15m: BigInt(r?.[0] ?? 0),
        accW15m: BigInt(r?.[1] ?? 0),
        windowStart15m: Number(r?.[2] ?? 0),
        tvwap1hr: BigInt(r?.[3] ?? 0),
        accW1hr: BigInt(r?.[4] ?? 0),
        windowStart1hr: Number(r?.[5] ?? 0),
        tvwap24hr: BigInt(r?.[6] ?? 0),
        accW24hr: BigInt(r?.[7] ?? 0),
        windowStart24hr: Number(r?.[8] ?? 0),
        lastTimestamp: Number(r?.[9] ?? 0),
        supply: BigInt(r?.[10] ?? 0),
        currentK: await this.getKonstant(poolAddr),
      };
    });
  },

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const r = await this._call(poolAddr, 'get_supply', []);
    return BigInt(r ?? 0);
  },

  async consult(poolAddr, secondsAgo) {
    return trace(`consult(${secondsAgo}s)`)(async () => {
      const r = await this._call(poolAddr, 'consult', [BigInt(secondsAgo).toString()]);
      return BigInt(r ?? 0);
    });
  },

  async getKonstant(poolAddr) {
    const r = await this._call(poolAddr, 'consult', [0]);
    return BigInt(r ?? 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const r = await this._call(poolAddr, 'get_pool_config', []);
      const N = Number(r?.[0] ?? 0);
      return {
        tokens: r ? r.slice(1, 1 + N).map(String) : [],
        balances: r ? r.slice(2 + N, 2 + 2 * N).map(BigInt) : [],
        genesis: r ? r.slice(3 + 2 * N, 3 + 3 * N).map(BigInt) : [],
        factors: Number(r?.[3 + 3 * N] ?? 0),
        scale: BigInt(r?.[4 + 3 * N] ?? 0),
        atr_spread_target: BigInt(r?.[5 + 3 * N] ?? ATR_SPREAD_TARGET),
        ema_spread_target: BigInt(r?.[6 + 3 * N] ?? EMA_SPREAD_TARGET),
        atr_period: BigInt(r?.[7 + 3 * N] ?? ATR_PERIOD),
        ema_period: BigInt(r?.[8 + 3 * N] ?? EMA_PERIOD),
        atr_spread: BigInt(r?.[9 + 3 * N] ?? 0),
        spread_multiplier: BigInt(r?.[10 + 3 * N] ?? BASIS),
        spread_additive: BigInt(r?.[11 + 3 * N] ?? 0),
        supply: BigInt(r?.[12 + 3 * N] ?? 0),
        weights: r ? r.slice(14 + 3 * N, 14 + 4 * N).map(BigInt) : [],
      };
    });
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      const calldata = [
        order.tokensIn.length,
        ...order.tokensIn,
        order.amountsIn.length,
        ...order.amountsIn.map(a => a.toString()),
        order.tokensOut.length,
        ...order.tokensOut,
        order.amountsOut.length,
        ...order.amountsOut.map(a => a.toString()),
        order.sharesIn.toString(),
        order.minSharesOut.toString(),
        deadlineTs.toString(),
      ];
      return await this._exec(poolAddr, 'swap', calldata);
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () => {
      const calldata = [
        amounts.length,
        ...amounts.map(a => a.toString()),
        minShares.toString(),
        weights.length,
        ...weights.map(w => w.toString()),
        (atrSpreadTarget || 0).toString(),
        (emaSpreadTarget || 0).toString(),
        (atrPeriod || 0).toString(),
        (emaPeriod || 0).toString(),
        deadlineTs.toString(),
      ];
      return await this._exec(poolAddr, 'add_liquidity', calldata);
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      const calldata = [shares.toString(), minTokensOut.length, ...minTokensOut.map(a => a.toString()), deadlineTs.toString()];
      return await this._exec(poolAddr, 'remove_liquidity', calldata);
    });
  },

  async getTokenSymbol(tokenAddr) {
    try {
      const r = await this._call(tokenAddr, 'symbol', []);
      const str = Array.isArray(r) ? r.map(feltToStr).join('') : feltToStr(r);
      return str || this.shortenAddress(tokenAddr);
    } catch {
      return this.shortenAddress(tokenAddr);
    }
  },

  async getTokenDecimals(tokenAddr) {
    try {
      const r = await this._call(tokenAddr, 'decimals', []);
      return Number(r ?? 18);
    } catch { return 18; }
  },

  async getTokenBalance(tokenAddr, account) {
    try {
      const r = await this._call(tokenAddr, 'balanceOf', [account]);
      return BigInt(r ?? 0);
    } catch { return 0n; }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    try {
      const r = await this._call(tokenAddr, 'balanceOf', [poolAddr]);
      return BigInt(r ?? 0);
    } catch { return 0n; }
  },

  async approveIfNeeded() { return; },

  async getPoolCount(factoryAddr) {
    try {
      const r = await this._call(factoryAddr, 'get_pool_count', []);
      return Number(r ?? 0);
    } catch { return 0; }
  },

  async getPools(factoryAddr) {
    try {
      const r = await this._call(factoryAddr, 'get_pools', []);
      return Array.isArray(r) ? r.slice(1).map(String) : [];
    } catch { return []; }
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
    return trace('claimFounderRoyalty')(async () =>
      this._exec(poolAddr, 'claim_founder_royalty', [token])
    );
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
    return trace('claimPromoterRoyalty')(async () =>
      this._exec(poolAddr, 'claim_promoter_royalty', [token])
    );
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const r = await this._call(poolAddr, 'get_admin_state', []);
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
        const config = await this.getPoolConfig(poolAddr);
        const tokens = config.tokens;
        const amounts = [];
        for (const t of tokens) {
          const r = await this._call(poolAddr, 'get_founder_royalties', [t]);
          amounts.push(BigInt(r ?? 0));
        }
        return { tokens, amounts };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const config = await this.getPoolConfig(poolAddr);
        const tokens = config.tokens;
        const amounts = [];
        for (const t of tokens) {
          const r = await this._call(poolAddr, 'get_promoter_royalties', [t]);
          amounts.push(BigInt(r ?? 0));
        }
        return { tokens, amounts };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const r = await this._call(poolAddr, 'get_founder_royalties', [token]);
      return BigInt(r ?? 0);
    } catch { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const r = await this._call(poolAddr, 'get_promoter_royalties', [token]);
      return BigInt(r ?? 0);
    } catch { return 0n; }
  },

  isValidAddress(addr) {
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{64}$/.test(addr);
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 16) return addr;
    return addr.slice(0, 8) + '\u2026' + addr.slice(-6);
  },

  async getBlock() {
    const num = await this.rpcCall(this.defaultRpc, 'starknet_blockNumber', []);
    return { currentBlock: Number(num) };
  },

  async getLastTxBlock(poolAddr) {
    const result = await this.rpcCall(this.defaultRpc, 'starknet_getEvents', [{
      address: poolAddr,
      from_block: { block_number: 0 },
      to_block: 'latest',
      chunk_size: 1,
    }]);
    if (result.events && result.events.length > 0) return result.events[0].block_number;
    return null;
  },

  async getNonce(poolAddr) {
    const r = await this._call(poolAddr, 'get_status', []);
    const N = Number(r?.[9] ?? 0);
    return Number(r?.[10 + N] ?? 0);
  },
});

window.chainAPI_cairo = chainAPI;
})();
