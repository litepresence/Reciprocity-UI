// SPDX-License-Identifier: MIT
(function() {
const COSMOS_NETWORKS = {
  osmo_test_5: {
    chainId: 'osmo-test-5',
    rpc: 'https://rpc.testnet.osmosis.zone',
    rest: 'https://lcd.testnet.osmosis.zone',
    explorer: 'https://testnet.mintscan.io/osmosis',
    gasPrice: '0.025uosmo',
    prefix: 'osmo',
  },
  juno_test: {
    chainId: 'uni-6',
    rpc: 'https://rpc.uni.junonetwork.io',
    rest: 'https://api.uni.junonetwork.io',
    explorer: 'https://testnet.mintscan.io/juno',
    gasPrice: '0.025ujunox',
    prefix: 'juno',
  },
};

let chainId = null;
let restUrl = null;
let rpcUrl = null;
let gasPrice = null;
let prefix = null;
let walletAddr = null;

const trace = makeTrace('Cosmos');

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Cosmos',
  logo: 'img/logos/cosmos.svg',
  defaultRpc: COSMOS_NETWORKS.osmo_test_5.rest,
  defaultFactory: null,
  network: 'osmo_test_5',
  chainId: COSMOS_NETWORKS.osmo_test_5.chainId,
  explorer: COSMOS_NETWORKS.osmo_test_5.explorer,
  configs: COSMOS_NETWORKS,

  setNetwork(network) {
    const cfg = COSMOS_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(COSMOS_NETWORKS).join(', ')}`);
    chainId = cfg.chainId;
    restUrl = cfg.rest;
    rpcUrl = cfg.rpc;
    gasPrice = cfg.gasPrice;
    prefix = cfg.prefix;
    this.defaultRpc = cfg.rest;
    this.chainId = cfg.chainId;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[Cosmos] %cNetwork: ${network} (chain ${cfg.chainId})`, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() {
    return typeof window.keplr !== 'undefined';
  },

  async connectWallet() {
    const keplr = window.keplr;
    if (!keplr) throw new Error('Keplr wallet not detected');
    await keplr.enable(chainId);
    const key = await keplr.getKey(chainId);
    walletAddr = key.bech32Address;
    console.log(`%c[Cosmos] %cconnectWallet`, 'color:#888', 'color:#3dcf8e', walletAddr);
    return { account: walletAddr, provider: keplr, networkName: this.network };
  },

  async _query(contract, msg) {
    const encoded = btoa(JSON.stringify(msg));
    const url = `${restUrl}/cosmwasm/wasm/v1/contract/${contract}/smart/${encoded}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.data;
  },

  async _execute(contract, msg, funds) {
    const keplr = window.keplr;
    const key = await keplr.getKey(chainId);
    const account = key.bech32Address;

    const accountRes = await fetch(`${restUrl}/cosmos/auth/v1/accounts/${account}`);
    const accountData = await accountRes.json();
    const sequence = accountData.account.base_account.sequence;
    const accountNumber = accountData.account.base_account.account_number;

    const fee = { amount: [{ denom: gasPrice.replace(/[0-9.]/g, ''), amount: String(Math.floor(Number(gasPrice.match(/[\d.]+/)[0]) * 300000)) }], gas: '300000' };
    const msgs = [{
      type: 'wasm/MsgExecuteContract',
      value: { sender: account, contract, msg: btoa(JSON.stringify(msg)), funds: funds || [] },
    }];

    const signDoc = {
      chain_id: chainId,
      account_number: accountNumber,
      sequence: sequence,
      fee: fee,
      msgs: msgs,
      memo: '',
    };

      const signed = await keplr.signAmino(chainId, account, signDoc);
    const txBytes = signed.signed.tx_bytes ? 
      (typeof atob !== 'undefined' ? Uint8Array.from(atob(signed.signed.tx_bytes), c => c.charCodeAt(0)) : null) : null;
    const result = await keplr.sendTx(chainId, txBytes || signed.signed, 'sync');

    const txHash = result?.txhash || result?.transactionHash || '';
    return txHash;
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const r = await this._query(poolAddr, 'balances');
      return {
        tokens: (r.tokens || r[0] || []).map(String),
        amounts: (r.balances || r[1] || []).map(BigInt),
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const r = await this._query(poolAddr, 'status');
      return {
        supply: BigInt(r.supply ?? r[0] ?? 0),
        atrSpreadTarget: BigInt(r.atr_spread_target ?? r[3] ?? 0),
        emaSpreadTarget: BigInt(r.ema_spread_target ?? r[4] ?? 0),
        atrPeriod: BigInt(r.atr_period ?? r[5] ?? 0),
        emaPeriod: BigInt(r.ema_period ?? r[6] ?? 0),
        atrSpread: BigInt(r.atr_spread ?? r[7] ?? 0),
        spreadAdditive: BigInt(r.spread_additive ?? r[8] ?? 0),
        txs: BigInt(r.transactions ?? r[10] ?? 0),
      };
    });
  },

  async consult(poolAddr, secondsAgo) {
    return BigInt(await this._query(poolAddr, { consult: { seconds_ago: secondsAgo } }) || 0);
  },

  async getTvwapState(poolAddr) {
    return trace('getTvwapState')(async () => {
      const r = await this._query(poolAddr, { tvwap_state: {} });
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

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const r = await this._query(poolAddr, 'supply');
    return BigInt(r.supply ?? 0);
  },

  async getKonstant(poolAddr) {
    const r = await this._query(poolAddr, { consult: { seconds_ago: 0 } });
    return BigInt(r ?? 0);
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const r = await this._query(poolAddr, 'pool_config');
      return {
        tokens: (r.tokens || r[0] || []).map(String),
        balances: (r.balances || r[1] || []).map(BigInt),
        genesis: (r.genesis || r[2] || []).map(BigInt),
        factors: Number(r.factors ?? r[3] ?? 0),
        scale: BigInt(r.scale ?? r[4] ?? 0),
        atr_spread_target: BigInt(r.atr_spread_target ?? r[5] ?? ATR_SPREAD_TARGET),
        ema_spread_target: BigInt(r.ema_spread_target ?? r[6] ?? EMA_SPREAD_TARGET),
        atr_period: BigInt(r.atr_period ?? r[7] ?? ATR_PERIOD),
        ema_period: BigInt(r.ema_period ?? r[8] ?? EMA_PERIOD),
        spread_multiplier: BigInt(r.spread_multiplier ?? r[9] ?? BASIS),
        supply: BigInt(r.supply ?? r[10] ?? 0),
        weights: (r.weights || r[11] || []).map(BigInt),
      };
    });
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      return await this._execute(poolAddr, {
        swap: {
          tokens_in: order.tokensIn,
          amounts_in: order.amountsIn.map(a => a.toString()),
          tokens_out: order.tokensOut,
          amounts_out: order.amountsOut.map(a => a.toString()),
          shares_in: order.sharesIn.toString(),
          min_shares_out: order.minSharesOut.toString(),
          deadline: String(deadlineTs),
        },
      });
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () => {
      return await this._execute(poolAddr, {
        add_liquidity: {
          tokens: tokens,
          amounts: amounts.map(a => a.toString()),
          min_shares: minShares.toString(),
          weights: weights && weights.length > 0 ? weights.map(w => w.toString()) : null,
          atr_spread_target: atrSpreadTarget && BigInt(atrSpreadTarget) > 0n ? atrSpreadTarget.toString() : null,
          ema_spread_target: emaSpreadTarget && BigInt(emaSpreadTarget) > 0n ? emaSpreadTarget.toString() : null,
          atr_period: atrPeriod && BigInt(atrPeriod) > 0n ? atrPeriod.toString() : null,
          ema_period: emaPeriod && BigInt(emaPeriod) > 0n ? emaPeriod.toString() : null,
          deadline: String(deadlineTs),
        },
      });
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      return await this._execute(poolAddr, {
        remove_liquidity: {
          shares: shares.toString(),
          min_tokens_out: minTokensOut.map(a => a.toString()),
          deadline: String(deadlineTs),
        },
      });
    });
  },

  async getTokenSymbol(tokenAddr) {
    try {
      const denom = tokenAddr.startsWith('ibc/') ? tokenAddr : tokenAddr;
      const res = await fetch(`${restUrl}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`);
      const data = await res.json();
      return data.metadata?.symbol || data.metadata?.display || this.shortenAddress(tokenAddr);
    } catch {
      return this.shortenAddress(tokenAddr);
    }
  },

  async getTokenDecimals(tokenAddr) {
    try {
      const denom = tokenAddr.startsWith('ibc/') ? tokenAddr : tokenAddr;
      const res = await fetch(`${restUrl}/cosmos/bank/v1beta1/denoms_metadata/${encodeURIComponent(denom)}`);
      const data = await res.json();
      const unit = data.metadata?.denom_units?.find(u => u.denom === data.metadata?.display);
      return unit?.exponent || 6;
    } catch {
      return 6;
    }
  },

  async getTokenBalance(tokenAddr, account) {
    try {
      const res = await fetch(`${restUrl}/cosmos/bank/v1beta1/balances/${account}/by_denom?denom=${encodeURIComponent(tokenAddr)}`);
      const data = await res.json();
      return BigInt(data.balance?.amount || 0);
    } catch {
      return 0n;
    }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    return await this.getTokenBalance(tokenAddr, poolAddr);
  },

  async approveIfNeeded() { return; },

  async getPoolCount(factoryAddr) {
    const r = await this._query(factoryAddr, { factory_pools: {} });
    return Array.isArray(r) ? r.length : 0;
  },

  async getPools(factoryAddr) {
    const r = await this._query(factoryAddr, { factory_pools: {} });
    return (r || []).map(String);
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () =>
      this._execute(poolAddr, { set_founder: { founder: newFounder } })
    );
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () =>
      this._execute(poolAddr, { set_founder_fund: { fund: fund } })
    );
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () =>
      this._execute(poolAddr, { claim_founder_royalty: { token: token } })
    );
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () =>
      this._execute(poolAddr, { set_promoter: { promoter: newPromoter } })
    );
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () =>
      this._execute(poolAddr, { set_promoter_fund: { fund: fund } })
    );
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () =>
      this._execute(poolAddr, { claim_promoter_royalty: { token: token } })
    );
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const r = await this._query(poolAddr, { get_admin_state: {} });
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
        const r = await this._query(poolAddr, { get_founder_royalties: {} });
        return { tokens: (r?.tokens || r?.[0] || []).map(String), amounts: (r?.amounts || r?.[1] || []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const r = await this._query(poolAddr, { get_promoter_royalties: {} });
        return { tokens: (r?.tokens || r?.[0] || []).map(String), amounts: (r?.amounts || r?.[1] || []).map(BigInt) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const r = await this._query(poolAddr, { get_founder_royalties: {} });
      const map = r && typeof r === 'object' ? r : {};
      return BigInt(map[token] ?? 0);
    } catch { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const r = await this._query(poolAddr, { get_promoter_royalties: {} });
      const map = r && typeof r === 'object' ? r : {};
      return BigInt(map[token] ?? 0);
    } catch { return 0n; }
  },

  isValidAddress(addr) {
    if (!addr || !prefix) return false;
    return addr.startsWith(prefix + '1') && addr.length >= 40;
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 16) return addr;
    return addr.slice(0, 8) + '\u2026' + addr.slice(-6);
  },

  async getBlock() {
    const res = await (await fetch(restUrl + '/cosmos/base/tendermint/v1beta1/blocks/latest')).json();
    return { currentBlock: Number(res.block.header.height) };
  },

  async getLastTxBlock(poolAddr) {
    const url = restUrl + '/cosmos/tx/v1beta1/txs?events=wasm._contract_address%3D' + poolAddr + '&pagination.limit=1&order_by=ORDER_BY_DESC';
    const res = await fetch(url);
    const data = await res.json();
    if (data.tx_responses && data.tx_responses.length > 0) return Number(data.tx_responses[0].height);
    return null;
  },

  async getNonce(poolAddr) {
    const r = await this._query(poolAddr, 'status');
    return Number(r.transactions ?? r[10] ?? 0);
  },
});

window.chainAPI_cosmos = chainAPI;
})();
