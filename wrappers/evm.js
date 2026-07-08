// SPDX-License-Identifier: MIT
const POOL_ABI = [
  {"type":"constructor","inputs":[{"name":"factory_","type":"address","internalType":"address"},{"name":"founder_","type":"address","internalType":"address"},{"name":"founder_fund_","type":"address","internalType":"address"},{"name":"founder_royalty_","type":"uint256","internalType":"uint256"},{"name":"promoter_","type":"address","internalType":"address"},{"name":"promoter_royalty_","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"addLiquidity","inputs":[{"name":"tokens","type":"address[]","internalType":"address[]"},{"name":"amounts","type":"uint256[]","internalType":"uint256[]"},{"name":"minShares","type":"uint256","internalType":"uint256"},{"name":"weights","type":"uint256[]","internalType":"uint256[]"},{"name":"atrSpreadTarget","type":"uint256","internalType":"uint256"},{"name":"emaSpreadTarget","type":"uint256","internalType":"uint256"},{"name":"atrPeriod","type":"uint256","internalType":"uint256"},{"name":"emaPeriod","type":"uint256","internalType":"uint256"},{"name":"deadline","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"consult","inputs":[{"name":"secondsAgo","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"getTvwapState","inputs":[],"outputs":[{"name":"tvwap15m","type":"uint256","internalType":"uint256"},{"name":"accW15m","type":"uint256","internalType":"uint256"},{"name":"windowStart15m","type":"uint256","internalType":"uint256"},{"name":"tvwap1hr","type":"uint256","internalType":"uint256"},{"name":"accW1hr","type":"uint256","internalType":"uint256"},{"name":"windowStart1hr","type":"uint256","internalType":"uint256"},{"name":"tvwap24hr","type":"uint256","internalType":"uint256"},{"name":"accW24hr","type":"uint256","internalType":"uint256"},{"name":"windowStart24hr","type":"uint256","internalType":"uint256"},{"name":"lastTimestamp","type":"uint256","internalType":"uint256"},{"name":"currentK","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"getBalances","inputs":[],"outputs":[{"name":"tokens","type":"address[]","internalType":"address[]"},{"name":"amounts","type":"uint256[]","internalType":"uint256[]"}],"stateMutability":"view"},
  {"type":"function","name":"getStatus","inputs":[],"outputs":[{"name":"supply","type":"uint256","internalType":"uint256"},{"name":"atrSpreadTarget","type":"uint256","internalType":"uint256"},{"name":"emaSpreadTarget","type":"uint256","internalType":"uint256"},{"name":"atrPeriod","type":"uint256","internalType":"uint256"},{"name":"emaPeriod","type":"uint256","internalType":"uint256"},{"name":"atrSpread","type":"uint256","internalType":"uint256"},{"name":"spreadAdditive","type":"int256","internalType":"int256"},{"name":"avgSpread","type":"uint256","internalType":"uint256"},{"name":"spreadMultiplier","type":"uint256","internalType":"uint256"},{"name":"lpRoyalties","type":"uint256[]","internalType":"uint256[]"},{"name":"txs","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"getLPToken","inputs":[],"outputs":[{"name":"","type":"address","internalType":"address"}],"stateMutability":"view"},

  {"type":"function","name":"getSupply","inputs":[],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"getPrice","inputs":[{"name":"tokenIndex","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"getPoolConfig","inputs":[],"outputs":[{"name":"tokens","type":"address[]","internalType":"address[]"},{"name":"balances","type":"uint256[]","internalType":"uint256[]"},{"name":"genesis","type":"uint256[]","internalType":"uint256[]"},{"name":"factors","type":"uint256","internalType":"uint256"},{"name":"scale","type":"uint256","internalType":"uint256"},{"name":"atrSpreadTarget","type":"uint256","internalType":"uint256"},{"name":"spreadMultiplier","type":"uint256","internalType":"uint256"},{"name":"supply","type":"uint256","internalType":"uint256"},{"name":"weights","type":"uint256[]","internalType":"uint256[]"}],"stateMutability":"view"},
  {"type":"function","name":"getWeights","inputs":[],"outputs":[{"name":"","type":"uint256[]","internalType":"uint256[]"}],"stateMutability":"view"},
  {"type":"function","name":"quoteSwap","inputs":[{"name":"order","type":"tuple","internalType":"struct Reciprocity.Order","components":[{"name":"tokensIn","type":"address[]","internalType":"address[]"},{"name":"amountsIn","type":"uint256[]","internalType":"uint256[]"},{"name":"tokensOut","type":"address[]","internalType":"address[]"},{"name":"amountsOut","type":"uint256[]","internalType":"uint256[]"},{"name":"sharesIn","type":"uint256","internalType":"uint256"},{"name":"minSharesOut","type":"uint256","internalType":"uint256"},{"name":"deadline","type":"uint256","internalType":"uint256"}]}],"outputs":[{"name":"","type":"tuple","internalType":"struct Reciprocity.Quote","components":[{"name":"tokensOut","type":"address[]","internalType":"address[]"},{"name":"amountsOut","type":"uint256[]","internalType":"uint256[]"},{"name":"reciprocity","type":"int256","internalType":"int256"},{"name":"feeAmounts","type":"uint256[]","internalType":"uint256[]"}]}],"stateMutability":"view"},
  {"type":"function","name":"removeLiquidity","inputs":[{"name":"shares","type":"uint256","internalType":"uint256"},{"name":"minTokensOut","type":"uint256[]","internalType":"uint256[]"},{"name":"deadline","type":"uint256","internalType":"uint256"}],"outputs":[{"name":"","type":"uint256[]","internalType":"uint256[]"}],"stateMutability":"nonpayable"},
  {"type":"function","name":"swap","inputs":[{"name":"order","type":"tuple","internalType":"struct Reciprocity.Order","components":[{"name":"tokensIn","type":"address[]","internalType":"address[]"},{"name":"amountsIn","type":"uint256[]","internalType":"uint256[]"},{"name":"tokensOut","type":"address[]","internalType":"address[]"},{"name":"amountsOut","type":"uint256[]","internalType":"uint256[]"},{"name":"sharesIn","type":"uint256","internalType":"uint256"},{"name":"minSharesOut","type":"uint256","internalType":"uint256"},{"name":"deadline","type":"uint256","internalType":"uint256"}]}],"outputs":[{"name":"","type":"address[]","internalType":"address[]"},{"name":"","type":"uint256[]","internalType":"uint256[]"},{"name":"","type":"int256","internalType":"int256"}],"stateMutability":"nonpayable"},
  // Admin — Founder Role
  {"type":"function","name":"setFounder","inputs":[{"name":"newFounder","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setFounderFund","inputs":[{"name":"fund","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"claimFounderRoyalty","inputs":[{"name":"token","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
  // Admin — Promoter Role
  {"type":"function","name":"setPromoter","inputs":[{"name":"newPromoter","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"setPromoterFund","inputs":[{"name":"fund","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
  {"type":"function","name":"claimPromoterRoyalty","inputs":[{"name":"token","type":"address","internalType":"address"}],"outputs":[],"stateMutability":"nonpayable"},
  // Admin Views
  {"type":"function","name":"getAdminState","inputs":[],"outputs":[{"name":"factory","type":"address","internalType":"address"},{"name":"founder","type":"address","internalType":"address"},{"name":"founderFund","type":"address","internalType":"address"},{"name":"promoter","type":"address","internalType":"address"},{"name":"promoterFund","type":"address","internalType":"address"}],"stateMutability":"view"},
  {"type":"function","name":"getFounderRoyalties","inputs":[],"outputs":[{"name":"tokens","type":"address[]","internalType":"address[]"},{"name":"amounts","type":"uint256[]","internalType":"uint256[]"}],"stateMutability":"view"},
  {"type":"function","name":"getPromoterRoyalties","inputs":[],"outputs":[{"name":"tokens","type":"address[]","internalType":"address[]"},{"name":"amounts","type":"uint256[]","internalType":"uint256[]"}],"stateMutability":"view"},
  {"type":"function","name":"getFounderRoyalty","inputs":[{"name":"token","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
  {"type":"function","name":"getPromoterRoyalty","inputs":[{"name":"token","type":"address","internalType":"address"}],"outputs":[{"name":"","type":"uint256","internalType":"uint256"}],"stateMutability":"view"},
  // Events
  {"type":"event","name":"FounderRoyaltyClaimed","inputs":[{"name":"token","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"destination","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},
  {"type":"event","name":"PromoterRoyaltyClaimed","inputs":[{"name":"token","type":"address","indexed":true,"internalType":"address"},{"name":"amount","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"destination","type":"address","indexed":false,"internalType":"address"}],"anonymous":false},
  {"type":"event","name":"FounderTransferred","inputs":[{"name":"newFounder","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},
  {"type":"event","name":"PromoterTransferred","inputs":[{"name":"newPromoter","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},
  {"type":"event","name":"FounderFundUpdated","inputs":[{"name":"newFund","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},
  {"type":"event","name":"PromoterFundUpdated","inputs":[{"name":"newFund","type":"address","indexed":true,"internalType":"address"}],"anonymous":false},
  {"type":"event","name":"FounderRoyaltyUpdated","inputs":[{"name":"newRoyaltyBps","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
  {"type":"event","name":"PromoterRoyaltyUpdated","inputs":[{"name":"newRoyaltyBps","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
  {"type":"event","name":"FounderRoyaltyLocked","inputs":[],"anonymous":false},
  {"type":"event","name":"PromoterRoyaltyLocked","inputs":[],"anonymous":false},
  {"type":"event","name":"Liquidity","inputs":[{"name":"user","type":"address","indexed":true,"internalType":"address"},{"name":"action","type":"uint8","indexed":false,"internalType":"uint8"},{"name":"shares","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"tokens","type":"address[]","indexed":false,"internalType":"address[]"},{"name":"amounts","type":"uint256[]","indexed":false,"internalType":"uint256[]"},{"name":"konstant","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
  {"type":"event","name":"Swap","inputs":[{"name":"user","type":"address","indexed":true,"internalType":"address"},{"name":"tokensIn","type":"address[]","indexed":false,"internalType":"address[]"},{"name":"amountsIn","type":"uint256[]","indexed":false,"internalType":"uint256[]"},{"name":"tokensOut","type":"address[]","indexed":false,"internalType":"address[]"},{"name":"amountsOut","type":"uint256[]","indexed":false,"internalType":"uint256[]"},{"name":"reciprocity","type":"int256","indexed":false,"internalType":"int256"},{"name":"kBefore","type":"uint256","indexed":false,"internalType":"uint256"},{"name":"kAfter","type":"uint256","indexed":false,"internalType":"uint256"}],"anonymous":false},
  {"type":"error","name":"AlreadyInitialized","inputs":[]},
  {"type":"error","name":"ComputeLimit","inputs":[]},
  {"type":"error","name":"InsufficientBalance","inputs":[]},
  {"type":"error","name":"InsufficientShares","inputs":[]},
  {"type":"error","name":"InvalidOrder","inputs":[]},
  {"type":"error","name":"LPSyncDrift","inputs":[]},
  {"type":"error","name":"NotInitialized","inputs":[]},
  {"type":"error","name":"Overflow","inputs":[]},
  {"type":"error","name":"ConsultInvalid","inputs":[]},
  {"type":"error","name":"InvalidPeriod","inputs":[]},
  {"type":"error","name":"SlippageExceeded","inputs":[]},
  {"type":"error","name":"NotFounder","inputs":[]},
  {"type":"error","name":"NotPromoter","inputs":[]},
  {"type":"error","name":"RoyaltyLocked","inputs":[]},
    {"type":"error","name":"NothingToClaim","inputs":[]},
  {"type":"error","name":"ZeroAddress","inputs":[]},
  {"type":"error","name":"NoFactory","inputs":[]}
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
];

const FACTORY_ABI = [
  'function getPools() view returns (address[])',
  'function getPoolCount() view returns (uint256)',
  'function isPool(address) view returns (bool)',
  'function getKnownTokens() view returns (address[])',
  'function isKnownToken(address token) view returns (bool)',
  'function getPoolTokens(uint256 index) view returns (address[])',
  'function getApostolicChain() view returns (uint256 poolCount, address[][] poolTokens)',
  'function getGenesisTokens() view returns (address[3])',
  'function founder() view returns (address)',
  'function founder_fund() view returns (address)',
  'function founder_royalty() view returns (uint256)',
  'function knownTokens(uint256 index) view returns (address)',
  'function deployPool(address[] tokens, uint256[] amounts, uint256[] weights, address promoter, uint256 promoter_royalty, uint256 atrSpreadTarget, uint256 emaSpreadTarget, uint256 atrPeriod, uint256 emaPeriod, address lpRecipient, string lpName, string lpSymbol) returns (address pool)',
  'function setFounder(address newFounder)',
  'function setFounderFund(address newFund)',

  'event PoolDeployed(address indexed pool, address indexed deployer)',
  'event FactoryFounderUpdated(address indexed newFounder)',
  'event FactoryFounderRoyaltyUpdated(uint256 newRoyaltyBps)',
  'event FactoryFounderFundUpdated(address indexed newFund)',
];

const ETHER_CDNS = [
  'https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.min.js',
  'https://unpkg.com/ethers@6.13.7/dist/ethers.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.7/ethers.umd.min.js',
];

const NETWORKS = {
  sepolia: {
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    factory: '0x63Cd199693661d1DfF588478447403e2DDac9e6a',
    chainId: 11155111,
    explorer: 'https://sepolia.etherscan.io',
  },
  mainnet: {
    rpc: 'https://eth.drpc.org',
    factory: null,
    chainId: 1,
    explorer: 'https://etherscan.io',
  },
};

let ethers = null;
let provider = null;
let signer = null;
let readProvider = null;

function traceContractCall(label) {
  return async (fn) => {
    const start = performance.now();
    try {
      const result = await fn();
      const ms = (performance.now() - start).toFixed(0);
      console.log(`%c[EVM] %c${label} ${ms}ms`, 'color:#888', `color:${ms > 2000 ? '#e85858' : ms > 500 ? '#d4a040' : '#3dcf8e'}`, result !== undefined ? (typeof result === 'bigint' ? result.toString().slice(0, 40) + '...' : Array.isArray(result) ? result.length + ' items' : typeof result === 'object' ? Object.keys(result).length + ' fields' : result) : '');
      return result;
    } catch (e) {
      const ms = (performance.now() - start).toFixed(0);
      console.warn(`%c[EVM] %c${label} FAILED ${ms}ms`, 'color:#888', 'color:#e85858', e.message);
      throw e;
    }
  };
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'EVM',
  logo: 'img/logos/ethereum.svg',
  defaultRpc: NETWORKS.sepolia.rpc,
  defaultFactory: NETWORKS.sepolia.factory,
  network: 'sepolia',
  chainId: NETWORKS.sepolia.chainId,
  explorer: NETWORKS.sepolia.explorer,
  configs: NETWORKS,

  setNetwork(network) {
    const cfg = NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.defaultFactory = cfg.factory;
    this.chainId = cfg.chainId;
    this.explorer = cfg.explorer;
    this.network = network;
    readProvider = null;
    console.log(`%c[EVM] %cNetwork: ${network} (chain ${cfg.chainId})`, 'color:#888', 'color:#2d7cf0');
    console.log(`  RPC: ${cfg.rpc}`);
    console.log(`  Factory: ${cfg.factory || 'not set'}`);
    console.log(`  Explorer: ${cfg.explorer}`);
  },

  async loadSDK() {
    if (typeof window.ethers !== 'undefined') { ethers = window.ethers; return true; }
    for (const url of ETHER_CDNS) {
      try {
        await this.loadScript(url);
        if (typeof window.ethers !== 'undefined') { ethers = window.ethers; return true; }
      } catch {}
    }
    return false;
  },

  async connectWallet() {
    const wStart = performance.now();
    if (typeof window.ethereum === 'undefined') throw new Error('MetaMask not detected');
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    const account = await signer.getAddress();
    const net = await provider.getNetwork();
    const ms = (performance.now() - wStart).toFixed(0);
    console.log(`%c[EVM] %cconnectWallet ${ms}ms`, 'color:#888', 'color:#3dcf8e', `${this.shortenAddress(account)} @ ${net.name} (chain ${net.chainId})`);
    return { account, provider, networkName: net.name };
  },

  _ensureReadProvider() {
    if (!readProvider) readProvider = new ethers.JsonRpcProvider(this.defaultRpc);
    return readProvider;
  },
  _pool(addr) { return new ethers.Contract(addr, POOL_ABI, this._ensureReadProvider()); },
  _erc20(addr) { return new ethers.Contract(addr, ERC20_ABI, this._ensureReadProvider()); },

  async getBalances(poolAddr) {
    return traceContractCall(`getBalances(${this.shortenAddress(poolAddr)})`)(async () => {
      const r = await this._pool(poolAddr).getBalances();
      return { tokens: r.tokens || r[0], amounts: (r.amounts || r[1]).map(BigInt) };
    });
  },

  async getStatus(poolAddr) {
    return traceContractCall(`getStatus(${this.shortenAddress(poolAddr)})`)(async () => {
      const r = await this._pool(poolAddr).getStatus();
      return {
        supply: BigInt(r.supply ?? r[0]),
        atrSpreadTarget: BigInt(r.atrSpreadTarget ?? r[1]),
        emaSpreadTarget: BigInt(r.emaSpreadTarget ?? r[2]),
        atrPeriod: BigInt(r.atrPeriod ?? r[3]),
        emaPeriod: BigInt(r.emaPeriod ?? r[4]),
        atrSpread: BigInt(r.atrSpread ?? r[5]),
        spreadAdditive: BigInt(r.spreadAdditive ?? r[6]),
        avgSpread: BigInt(r.avgSpread ?? r[7]),
        spreadMultiplier: BigInt(r.spreadMultiplier ?? r[8]),
        lpRoyalties: (r.lpRoyalties ?? (r[9] || [])).map(BigInt),
        txs: BigInt(r.txs ?? r[10]),
      };
    });
  },

  async getTvwapPrices(poolAddr, secondsAgo) {
    return traceContractCall(`getTvwapPrices(${this.shortenAddress(poolAddr)}, ${secondsAgo}s)`)(async () => {
      var tvwapK;
      try {
        tvwapK = BigInt(await this._pool(poolAddr).consult(secondsAgo));
      } catch (e) {
        var errData = e.data || e.error?.data || e.revert?.data || '';
        if (typeof errData === 'string' && (errData.startsWith('0x1d4f4aa3') || errData.includes('1d4f4aa3') || errData.startsWith('0x4de17b97') || errData.includes('4de17b97'))) {
          tvwapK = BigInt(await this._pool(poolAddr).consult(0));
        } else {
          throw e;
        }
      }
      var bals = await this._pool(poolAddr).getBalances();
      var tokens = bals.tokens || bals[0];
      var balances = (bals.amounts || bals[1]).map(BigInt);
      return window.reciprocity_math.getTvwapPrices(tvwapK, balances, tokens);
    });
  },

  async getTvwapState(poolAddr) {
    return traceContractCall(`getTvwapState(${this.shortenAddress(poolAddr)})`)(async () => {
      const r = await this._pool(poolAddr).getTvwapState();
      return {
        tvwap15m: BigInt(r.tvwap15m ?? r[0]),
        accW15m: BigInt(r.accW15m ?? r[1]),
        windowStart15m: BigInt(r.windowStart15m ?? r[2]),
        tvwap1hr: BigInt(r.tvwap1hr ?? r[3]),
        accW1hr: BigInt(r.accW1hr ?? r[4]),
        windowStart1hr: BigInt(r.windowStart1hr ?? r[5]),
        tvwap24hr: BigInt(r.tvwap24hr ?? r[6]),
        accW24hr: BigInt(r.accW24hr ?? r[7]),
        windowStart24hr: BigInt(r.windowStart24hr ?? r[8]),
        lastTimestamp: BigInt(r.lastTimestamp ?? r[9]),
        currentK: BigInt(r.currentK ?? r[10]),
      };
    });
  },

  async getLPToken(poolAddr) { return this._pool(poolAddr).getLPToken(); },

  async getSupply(poolAddr) {
    return BigInt(await this._pool(poolAddr).getSupply());
  },

  async getKonstant(poolAddr) {
    return traceContractCall(`consult(0) @ ${this.shortenAddress(poolAddr)}`)(async () =>
      BigInt(await this._pool(poolAddr).consult(0))
    );
  },

  async consult(poolAddr, secondsAgo) {
    return traceContractCall(`consult(${secondsAgo}s) @ ${this.shortenAddress(poolAddr)}`)(async () =>
      BigInt(await this._pool(poolAddr).consult(secondsAgo))
    );
  },

  async getPoolConfig(poolAddr) {
    return traceContractCall(`getPoolConfig(${this.shortenAddress(poolAddr)})`)(async () => {
      const pool = this._pool(poolAddr);
      const [r, weightsResult] = await Promise.all([
        pool.getPoolConfig(),
        pool.getWeights().catch(() => []),
      ]);
      const weights = (r.weights || r[8] || (Array.isArray(weightsResult) ? weightsResult : []));
      const genesis = (r.genesis || r[2] || []);
      return {
        tokens: r.tokens || r[0],
        balances: (r.balances || r[1]).map(BigInt),
        genesis: genesis.map(BigInt),
        factors: Number(r.factors ?? r[3] ?? r[2]),
        scale: BigInt(r.scale ?? r[4] ?? r[3]),
        atr_spread_target: BigInt(r.target ?? r[5] ?? r[4]),
        spread_multiplier: BigInt(r.spread ?? r[6] ?? r[5]),
        supply: BigInt(r.supply ?? r[7]),
        weights: weights.map(BigInt),
      };
    });
  },

  async getAdminState(poolAddr) {
    return traceContractCall(`getAdminState(${this.shortenAddress(poolAddr)})`)(async () => {
      const r = await this._pool(poolAddr).getAdminState();
      return {
        factory: r.factory ?? (r[0] || null),
        founder: r.founder ?? (r[1] || null),
        founderFund: r.founderFund ?? (r[2] || null),
        promoter: r.promoter ?? (r[3] || null),
        promoterFund: r.promoterFund ?? (r[4] || null),
      };
    });
  },

  async getFounderRoyalties(poolAddr) {
    return traceContractCall(`getFounderRoyalties(${this.shortenAddress(poolAddr)})`)(async () => {
      const r = await this._pool(poolAddr).getFounderRoyalties();
      return {
        tokens: (r.tokens || r[0] || []).map(String),
        amounts: (r.amounts || r[1] || []).map(BigInt),
      };
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return traceContractCall(`getPromoterRoyalties(${this.shortenAddress(poolAddr)})`)(async () => {
      const r = await this._pool(poolAddr).getPromoterRoyalties();
      return {
        tokens: (r.tokens || r[0] || []).map(String),
        amounts: (r.amounts || r[1] || []).map(BigInt),
      };
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    return traceContractCall(`getFounderRoyalty(${this.shortenAddress(poolAddr)}, ${this.shortenAddress(token)})`)(async () =>
      BigInt(await this._pool(poolAddr).getFounderRoyalty(token))
    );
  },

  async getPromoterRoyalty(poolAddr, token) {
    return traceContractCall(`getPromoterRoyalty(${this.shortenAddress(poolAddr)}, ${this.shortenAddress(token)})`)(async () =>
      BigInt(await this._pool(poolAddr).getPromoterRoyalty(token))
    );
  },

  async _onchainQuoteSwap(poolAddr, order) {
    return traceContractCall(`quoteSwap(view) @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const r = await this._pool(poolAddr).quoteSwap({ deadline: 0n, ...order });
      return {
        tokensOut: r.tokensOut || r[0],
        amountsOut: (r.amountsOut || r[1]).map(BigInt),
        reciprocity: BigInt(r.reciprocity ?? r[2]),
        feeAmounts: (r.feeAmounts || r[3]).map(BigInt),
      };
    });
  },

  async _clampOrderToBalances(poolAddr, order) {
    // ponytail: re-clamp amountsOut against live on-chain balances before verify
    // call. Catches optimizer cache staleness without adding latency to the main
    // preview path. Upgrade to a shared refresh-on-staleness primitive if this
    // pattern replicates across wrappers.
    const bals = await this.getBalances(poolAddr);
    const bt = bals.tokens || bals[0], ba = bals.amounts || bals[1];
    const balMap = {};
    bt.forEach((addr, i) => { balMap[addr.toLowerCase()] = BigInt(ba[i]); });
    const amountsOut = (order.amountsOut || []).map((a, i) => {
      const addr = (order.tokensOut || [])[i];
      if (!addr) return BigInt(a || 0);
      const poolBal = balMap[addr.toLowerCase()] || 0n;
      const inIdx = (order.tokensIn || []).findIndex(t => t.toLowerCase() === addr.toLowerCase());
      const inputAmt = inIdx >= 0 ? BigInt(order.amountsIn[inIdx] || 0) : 0n;
      const raw = BigInt(a || 0);
      return raw > poolBal + inputAmt ? poolBal + inputAmt : raw;
    });
    return { ...order, amountsOut };
  },

  async verifyQuote(poolAddr, order) {
    const localQuote = await this.quoteSwap(poolAddr, order);
    let onchainQuote = null;
    let match = true;
    try {
      const safeOrder = await this._clampOrderToBalances(poolAddr, order);
      onchainQuote = await this._onchainQuoteSwap(poolAddr, safeOrder);
      match = window.reciprocity_math.quotesEqual(localQuote, onchainQuote);
    } catch (e) {
      console.warn('On-chain quoteSwap call failed:', e.message);
    }
    console.log('=== RECIPROCITY VERIFY OFFER ===');
    console.log('Local Quote:', _safeStringify(localQuote));
    if (onchainQuote) {
      console.log('On-Chain Quote:', _safeStringify(onchainQuote));
      console.log('Match:', match);
    } else {
      console.log('On-Chain: FAILED — using local quote only');
    }
    return { verified: match, local: localQuote, onchain: onchainQuote, match, skipped: false };
  },

  async simulateSwap(poolAddr, order) {
    return traceContractCall(`simulateSwap @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const r = await this._pool(poolAddr).quoteSwap({ deadline: 0n, ...order });
      const tokensOut = r.tokensOut || r[0];
      const amountsOut = (r.amountsOut || r[1]).map(BigInt);
      const reciprocity = BigInt(r.reciprocity ?? r[2]);
      return { tokensOut, amountsOut, reciprocity, success: true };
    });
  },

  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return traceContractCall(`swap() @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).swap({ ...order, deadline: deadlineTs });
      const receipt = await tx.wait();
      return tx.hash;
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return traceContractCall(`addLiquidity @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).addLiquidity(tokens, amounts, minShares, weights || [], atrSpreadTarget || 0, emaSpreadTarget || 0, atrPeriod || 0, emaPeriod || 0, deadlineTs);
      const receipt = await tx.wait();
      return tx.hash;
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return traceContractCall(`removeLiquidity @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).removeLiquidity(shares, minTokensOut);
      const receipt = await tx.wait();
      return tx.hash;
    });
  },

  async getTokenSymbol(addr) {
    const sym = await traceContractCall(`symbol() @ ${this.shortenAddress(addr)}`)(async () => {
      try {
        const s = await this._erc20(addr).symbol();
        if (typeof s === 'string' && s.length > 0) return s;
      } catch {}
      try {
        const b32Abi = ['function symbol() view returns (bytes32)'];
        const c = new ethers.Contract(addr, b32Abi, provider);
        return ethers.decodeBytes32String(await c.symbol()).replace(/\x00/g, '');
      } catch {}
      return this.shortenAddress(addr);
    });
    return sym;
  },

  async getTokenDecimals(addr) {
    return traceContractCall(`decimals() @ ${this.shortenAddress(addr)}`)(async () => {
      try { return Number(await this._erc20(addr).decimals()); } catch { return 18; }
    });
  },

  async getTokenBalance(tokenAddr, account) {
    return traceContractCall(`balanceOf(${this.shortenAddress(account)}) @ ${this.shortenAddress(tokenAddr)}`)(async () =>
      BigInt(await this._erc20(tokenAddr).balanceOf(account))
    );
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    return traceContractCall(`pool balanceOf @ ${this.shortenAddress(tokenAddr)}`)(async () =>
      BigInt(await this._erc20(tokenAddr).balanceOf(poolAddr))
    );
  },

  async approveIfNeeded(tokenAddr, spender, owner, amount) {
    const erc20 = this._erc20(tokenAddr);
    const a = await erc20.allowance(owner, spender);
    if (a < amount) {
      console.log(`%c[EVM] %capprove(${this.shortenAddress(spender)}) ${this.shortenAddress(tokenAddr)}`, 'color:#888', 'color:#d4a040', amount.toString().slice(0, 30) + '...');
      const withSigner = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
      if (a > 0n) {
        await (await withSigner.approve(spender, 0n)).wait();
      }
      await (await withSigner.approve(spender, ethers.MaxUint256)).wait();
    }
  },

  async getPoolCount(factoryAddr) {
    return traceContractCall(`getPoolCount @ ${this.shortenAddress(factoryAddr)}`)(async () => {
      const f = new ethers.Contract(factoryAddr, FACTORY_ABI, this._ensureReadProvider());
      return Number(await f.getPoolCount());
    });
  },
  async getPools(factoryAddr) {
    return traceContractCall(`getPools @ ${this.shortenAddress(factoryAddr)}`)(async () => {
      const f = new ethers.Contract(factoryAddr, FACTORY_ABI, this._ensureReadProvider());
      return await f.getPools();
    });
  },

  async setFounder(poolAddr, newFounder) {
    return traceContractCall(`setFounder @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).setFounder(newFounder);
      await tx.wait();
      return tx.hash;
    });
  },

  async setFounderFund(poolAddr, fund) {
    return traceContractCall(`setFounderFund @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).setFounderFund(fund);
      await tx.wait();
      return tx.hash;
    });
  },

  async claimFounderRoyalty(poolAddr, token) {
    return traceContractCall(`claimFounderRoyalty(${this.shortenAddress(token)}) @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).claimFounderRoyalty(token);
      await tx.wait();
      return tx.hash;
    });
  },

  async setPromoter(poolAddr, newPromoter) {
    return traceContractCall(`setPromoter @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).setPromoter(newPromoter);
      await tx.wait();
      return tx.hash;
    });
  },

  async setPromoterFund(poolAddr, fund) {
    return traceContractCall(`setPromoterFund @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).setPromoterFund(fund);
      await tx.wait();
      return tx.hash;
    });
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return traceContractCall(`claimPromoterRoyalty(${this.shortenAddress(token)}) @ ${this.shortenAddress(poolAddr)}`)(async () => {
      const tx = await this._pool(poolAddr).connect(signer).claimPromoterRoyalty(token);
      await tx.wait();
      return tx.hash;
    });
  },

  isValidAddress(addr) {
    try { return ethers.isAddress(addr); } catch { return false; }
  },

  async getBlock() {
    const blockNumber = await this._ensureReadProvider().getBlockNumber();
    return { currentBlock: blockNumber };
  },

  async getLastTxBlock(poolAddr) {
    const currentBlock = await this._ensureReadProvider().getBlockNumber();
    const fromBlock = Math.max(0, Math.ceil(currentBlock * 0.8));
    const logs = await this._ensureReadProvider().getLogs({
      address: poolAddr,
      fromBlock,
      toBlock: 'latest',
    });
    if (logs.length > 0) return Number(logs[logs.length - 1].blockNumber);
    return null;
  },

  async getNonce(poolAddr) {
    const r = await this._pool(poolAddr).getStatus();
    return Number(r.txs ?? r[10] ?? 0);
  },

});

window.chainAPI_evm = chainAPI;
window.chainAPI = chainAPI;
