// SPDX-License-Identifier: MIT
(function() {
const FLOW_NETWORKS = {
  emulator: {
    rpc: 'http://localhost:8888',
    explorer: 'http://localhost:8888',
    accessNode: 'http://localhost:8888',
    fclNetwork: 'emulator',
    ftAddr: '0xee82856bf20e2aa6',
  },
  testnet: {
    rpc: 'https://rest-testnet.onflow.org',
    explorer: 'https://testnet.flowscan.org',
    accessNode: 'https://rest-testnet.onflow.org',
    fclNetwork: 'testnet',
    ftAddr: '0x9a0766d93b6608b7',
  },
  mainnet: {
    rpc: 'https://rest-mainnet.onflow.org',
    explorer: 'https://flowscan.org',
    accessNode: 'https://rest-mainnet.onflow.org',
    fclNetwork: 'mainnet',
    ftAddr: '0xf233dcee88fe0abe',
  },
};

let walletAddr = null;
let _fcl = null;

const trace = makeTrace('Flow');

function ufix64ToBigInt(v) {
    const parts = v.split('.');
    const integer = parts[0];
    const fraction = (parts[1] || '').padEnd(8, '0').slice(0, 8);
    return BigInt(integer + fraction);
}

async function waitFcl(timeout = 10000) {
  if (_fcl) return _fcl;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (window.fcl && typeof window.fcl.query === 'function') {
      _fcl = window.fcl;
      const cfg = FLOW_NETWORKS[chainAPI.network] || FLOW_NETWORKS.testnet;
      _fcl.config().put('accessNode.api', cfg.accessNode);
      return _fcl;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('FCL (@onflow/fcl) not loaded. Add <script src=...> for @onflow/fcl');
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Flow',
  logo: 'img/logos/flow.svg',
  defaultRpc: FLOW_NETWORKS.testnet.rpc,
  defaultFactory: null,
  network: 'testnet',
  chainId: null,
  explorer: FLOW_NETWORKS.testnet.explorer,
  configs: FLOW_NETWORKS,

  setNetwork(network) {
    const cfg = FLOW_NETWORKS[network];
    if (!cfg) throw new Error(`Unknown network: ${network}. Supported: ${Object.keys(FLOW_NETWORKS).join(', ')}`);
    this.defaultRpc = cfg.rpc;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(`%c[Flow] %cNetwork: ${network}`, 'color:#888', 'color:#2d7cf0');
  },

  async loadSDK() {
    try {
      const fcl = await waitFcl(5000);
      return !!fcl;
    } catch {
      console.warn('%c[Flow] %cFCL not available', 'color:#888', 'color:orange');
      return false;
    }
  },

  async connectWallet() {
    const fcl = await waitFcl();
    try {
      await fcl.unauthenticate();
    } catch {}
    const user = await fcl.logIn();
    if (!user?.addr) throw new Error('FCL login returned no address');
    walletAddr = user.addr;
    return { account: '0x' + user.addr, provider: 'fcl', networkName: this.network };
  },

  _networkCfg() {
    return FLOW_NETWORKS[this.network] || FLOW_NETWORKS.testnet;
  },

  _ftAddr() {
    return this._networkCfg().ftAddr;
  },

  async _query(cadence, args) {
    const fcl = await waitFcl();
    const result = await fcl.query({ cadence, args: () => (args || []).map(a => {
      if (a && typeof a === 'object' && a._fclType) return fcl.arg(a.value, a._fclType);
      if (typeof a === 'number') return fcl.arg(String(a), fcl.t.UInt256);
      if (typeof a === 'bigint') return fcl.arg(a.toString(), fcl.t.UInt256);
      if (typeof a === 'string' && /^0x[0-9a-fA-F]{16}$/.test(a)) return fcl.arg(a, fcl.t.Address);
      return fcl.arg(a, fcl.t.Address);
    }) });
    return result;
  },

  async _mutate(cadence, args) {
    const fcl = await waitFcl();
    const txId = await fcl.mutate({ cadence, args: () => (args || []).map(a => {
      if (a && typeof a === 'object' && a._fclType) return fcl.arg(a.value, a._fclType);
      if (typeof a === 'number') return fcl.arg(String(a), fcl.t.UInt256);
      if (typeof a === 'bigint') return fcl.arg(a.toString(), fcl.t.UInt256);
      return fcl.arg(a, fcl.t.Address);
    }) });
    const tx = await fcl.tx(txId).onceSealed();
    return txId;
  },

  async getBalances(poolAddr) {
    return trace('getBalances')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address): [AnyStruct] {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return [pool.tokens, pool.getBalances()]
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
      ]});
      return {
        tokens: (data?.[0] || []).map(String),
        amounts: (data?.[1] || []).map(v => BigInt(v)),
      };
    });
  },

  async getStatus(poolAddr) {
    return trace('getStatus')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address): AnyStruct {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return pool.getStatus()
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
      ]});
      return {
        supply: BigInt(data?.[0] || '0'),
        atrSpreadTarget: BigInt(data?.[1] || '0'),
        emaSpreadTarget: BigInt(data?.[2] || '0'),
        atrPeriod: BigInt(data?.[3] || 0),
        emaPeriod: BigInt(data?.[4] || 0),
        atrSpread: BigInt(data?.[5] || '0'),
        spreadAdditive: BigInt(data?.[6] || 0),
        avgSpread: BigInt(data?.[7] || '0'),
        spreadMultiplier: BigInt(data?.[8] || '10000'),
        lpRoyalties: (data?.[9] || []).map(v => BigInt(v)),
        txs: BigInt(data?.[10] || 0),
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
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address): [UInt256] {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return pool.getTvwapState()
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
      ]});
      return {
        tvwap15m: BigInt(data?.[0] || '0'),
        accW15m: BigInt(data?.[1] || '0'),
        windowStart15m: BigInt(data?.[2] || '0'),
        tvwap1hr: BigInt(data?.[3] || '0'),
        accW1hr: BigInt(data?.[4] || '0'),
        windowStart1hr: BigInt(data?.[5] || '0'),
        tvwap24hr: BigInt(data?.[6] || '0'),
        accW24hr: BigInt(data?.[7] || '0'),
        windowStart24hr: BigInt(data?.[8] || '0'),
        lastTimestamp: BigInt(data?.[9] || '0'),
        currentK: BigInt(data?.[10] || '0'),
      };
    });
  },

  async consult(poolAddr, secondsAgo) {
    return trace(`consult(${secondsAgo}s)`)(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address, secondsAgo: UInt256): UInt256 {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return pool.consult(secondsAgo)
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address),
        fcl.arg(String(secondsAgo), fcl.t.UInt256)
      ]});
      return BigInt(data || '0');
    });
  },

  async getLPToken(poolAddr) { return poolAddr; },

  async getSupply(poolAddr) {
    const fcl = await waitFcl();
    const cadence = `
      import Reciprocity from ${poolAddr}
      access(all) fun main(poolAddr: Address): UInt256 {
        let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
          ?? panic("Pool not found")
        return pool.getSupply()
      }
    `;
    const data = await fcl.query({ cadence, args: () => [
      fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
    ]});
    return BigInt(data || '0');
  },

  async getKonstant(poolAddr) {
    const fcl = await waitFcl();
    const cadence = `
      import Reciprocity from ${poolAddr}
      access(all) fun main(poolAddr: Address): UInt256 {
        let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
          ?? panic("Pool not found")
        return pool.getKonstant()
      }
    `;
    const data = await fcl.query({ cadence, args: () => [
      fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
    ]});
    return BigInt(data || '0');
  },

  async getPoolConfig(poolAddr) {
    return trace('getPoolConfig')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address): AnyStruct {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return pool.getPoolConfig()
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
      ]});
      return {
        tokens: (data?.[0] || []).map(String),
        balances: (data?.[1] || []).map(v => BigInt(v)),
        genesis: (data?.[2] || []).map(v => BigInt(v)),
        factors: Number(data?.[3] ?? 0),
        scale: BigInt(data?.[4] || '0'),
        atr_spread_target: BigInt(data?.[5] || String(ATR_SPREAD_TARGET)),
        spread_multiplier: BigInt(data?.[6] || '10000'),
        supply: BigInt(data?.[7] || '0'),
        weights: (data?.[8] || []).map(w => BigInt(w)),
        spread_count: Number(data?.[9] ?? 0),
        ema_spread_target: BigInt(data?.[10] || String(EMA_SPREAD_TARGET)),
      };
    });
  },


  async executeSwap(poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('executeSwap')(async () => {
      const fcl = await waitFcl();
      const ftAddr = this._ftAddr();
      const amountsIn = order.amountsIn || [];
      const amountsOut = order.amountsOut || [];
      const tokens = order.tokens || [];
      const n = amountsIn.length;
      const amountsInStr = amountsIn.map(a => String(BigInt(a)));
      const amountsOutStr = amountsOut.map(a => String(BigInt(a)));
      const tokensClean = tokens.map(t => t.replace('0x', ''));
      const receiverPaths = tokens.map(t => ({value: `/public/fr${t.replace('0x', '')}`, _fclType: fcl.t.PublicPath}));
      const cadence = `
        import FungibleToken from ${ftAddr}
        import Reciprocity from ${poolAddr}
        import ReciprocityFactory from ${poolAddr}
        transaction(
          poolIndex: UInt64,
          factoryAddr: Address,
          tokensIn: [Address],
          amountsIn: [UInt256],
          tokensOut: [Address],
          amountsOut: [UInt256],
          minSharesOut: UInt256,
          sharesIn: UInt256,
          outputReceiverPaths: [PublicPath],
          deadline: UInt64
        ) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            var vaults: @[{FungibleToken.Vault}] <- []
            var i: UInt8 = 0
            while i < pool.factors {
              let tokenAddr = pool.tokens[i]
              let vaultPath = StoragePath(identifier: "fv".concat(tokenAddr.toString()))!
              let vault = signer.storage.borrow<auth(FungibleToken.Withdraw) &{FungibleToken.Vault}>(from: vaultPath)
                ?? panic("Vault not found for token ".concat(tokenAddr.toString()))
              if i < UInt8(amountsIn.length) && amountsIn[i] > 0 {
                assert(amountsIn[i] <= 184467440737, message: "ERR:23:amount exceeds UFix64 max")
                let withdrawn <- vault.withdraw(amount: UFix64(amountsIn[i]))
                vaults.append(<-withdrawn)
              } else {
                let emptyVault <- vault.withdraw(amount: UFix64(0))
                vaults.append(<-emptyVault)
              }
              i = i + 1
            }
            pool.swap(amountsIn, amountsOut, sharesIn, minSharesOut, signer.address, <-vaults, outputReceiverPaths, deadline)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: tokensClean, _fclType: fcl.t.Array(fcl.t.Address) },
        { value: amountsInStr, _fclType: fcl.t.Array(fcl.t.UInt256) },
        { value: tokensClean, _fclType: fcl.t.Array(fcl.t.Address) },
        { value: amountsOutStr, _fclType: fcl.t.Array(fcl.t.UInt256) },
        { value: '0', _fclType: fcl.t.UInt256 },
        { value: '0', _fclType: fcl.t.UInt256 },
        ...receiverPaths,
        { value: String(deadlineTs), _fclType: fcl.t.UInt64 },
      ]);
    });
  },

  async addLiquidity(poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('addLiquidity')(async () => {
      const fcl = await waitFcl();
      const ftAddr = this._ftAddr();
      const amountsStr = (amounts || []).map(a => String(BigInt(a)));
      const tokensClean = (tokens || []).map(t => t.replace('0x', ''));
      const receiverPaths = (tokens || []).map(t => ({value: `/public/fr${t.replace('0x', '')}`, _fclType: fcl.t.PublicPath}));
      const cadence = `
        import FungibleToken from ${ftAddr}
        import Reciprocity from ${poolAddr}
        import ReciprocityFactory from ${poolAddr}
        transaction(
          poolIndex: UInt64,
          factoryAddr: Address,
          amounts: [UInt256],
          minShares: UInt256,
          weights: [UInt64],
          atrSpreadTarget: UInt256,
          emaSpreadTarget: UInt256,
          atrPeriod: UInt256,
          emaPeriod: UInt256,
          deadline: UInt64
        ) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            var vaults: @[{FungibleToken.Vault}] <- []
            var i: UInt8 = 0
            while i < pool.factors {
              let tokenAddr = pool.tokens[i]
              let vaultPath = StoragePath(identifier: "fv".concat(tokenAddr.toString()))!
              let vault = signer.storage.borrow<auth(FungibleToken.Withdraw) &{FungibleToken.Vault}>(from: vaultPath)
                ?? panic("Vault not found for token ".concat(tokenAddr.toString()))
              assert(amounts[i] <= 184467440737, message: "ERR:23:amount exceeds UFix64 max")
              let withdrawn <- vault.withdraw(amount: UFix64(amounts[i]))
              vaults.append(<-withdrawn)
              i = i + 1
            }
            pool.addLiquidity(amounts, minShares, <-vaults, signer.address, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: amountsStr, _fclType: fcl.t.Array(fcl.t.UInt256) },
        { value: String(BigInt(minShares)), _fclType: fcl.t.UInt256 },
        { value: (weights || []).map(w => String(w)), _fclType: fcl.t.Array(fcl.t.UInt64) },
        { value: String(BigInt(atrSpreadTarget || 0)), _fclType: fcl.t.UInt256 },
        { value: String(BigInt(emaSpreadTarget || 0)), _fclType: fcl.t.UInt256 },
        { value: String(BigInt(atrPeriod || 0)), _fclType: fcl.t.UInt256 },
        { value: String(BigInt(emaPeriod || 0)), _fclType: fcl.t.UInt256 },
        { value: String(deadlineTs), _fclType: fcl.t.UInt64 },
      ]);
    });
  },

  async removeLiquidity(poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return trace('removeLiquidity')(async () => {
      const fcl = await waitFcl();
      const ftAddr = this._ftAddr();
      const minOutStr = (minTokensOut || []).map(a => String(BigInt(a)));
      const cadence = `
        import FungibleToken from ${ftAddr}
        import Reciprocity from ${poolAddr}
        import ReciprocityFactory from ${poolAddr}
        transaction(
          poolIndex: UInt64,
          factoryAddr: Address,
          shares: UInt256,
          minTokensOut: [UInt256],
          outputReceiverPaths: [PublicPath],
          deadline: UInt64
        ) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            pool.removeLiquidity(shares, minTokensOut, signer.address, outputReceiverPaths, deadline)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: String(BigInt(shares)), _fclType: fcl.t.UInt256 },
        { value: minOutStr, _fclType: fcl.t.Array(fcl.t.UInt256) },
        { value: [], _fclType: fcl.t.Array(fcl.t.PublicPath) },
        { value: String(deadlineTs), _fclType: fcl.t.UInt64 },
      ]);
    });
  },

  async getTokenSymbol(tokenAddr) { return this.shortenAddress(tokenAddr); },
  async getTokenDecimals(tokenAddr) { return 8; },

  async getTokenBalance(tokenAddr, account) {
    try {
      const fcl = await waitFcl();
      const ftAddr = this._ftAddr();
      const cadence = `
        import FungibleToken from ${ftAddr}
        access(all) fun main(wallet: Address, token: Address): UInt256 {
          let acct = getAuthAccount<auth(Storage) &Account>(wallet)
          let path = StoragePath(identifier: "fv".concat(token.toString()))!
          let vault = acct.storage.borrow<&{FungibleToken.Vault}>(from: path)
            ?? panic("Vault not found for token ".concat(token.toString()))
          return UInt256(vault.balance)
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(account.replace('0x', ''), fcl.t.Address),
        fcl.arg(tokenAddr.replace('0x', ''), fcl.t.Address)
      ]});
      return BigInt(data || '0');
    } catch { return 0n; }
  },

  async getPoolTokenBalance(tokenAddr, poolAddr) {
    return this.getTokenBalance(tokenAddr, poolAddr);
  },

  async approveIfNeeded() { return; },
  async getPoolCount(factoryAddr) {
    try {
      const fcl = await waitFcl();
      const cadence = `
        import ReciprocityFactory from ${factoryAddr}
        access(all) fun main(): UInt64 {
          return ReciprocityFactory.getPoolCount()
        }
      `;
      const data = await fcl.query({ cadence });
      return Number(data ?? 0);
    } catch { return 0; }
  },
  async getPools(factoryAddr) {
    try {
      const fcl = await waitFcl();
      const cadence = `
        import ReciprocityFactory from ${factoryAddr}
        access(all) fun main(): [Address] {
          return ReciprocityFactory.getPools()
        }
      `;
      const data = await fcl.query({ cadence });
      return (data || []).map(a => '0x' + a.replace('0x', ''));
    } catch { return []; }
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  async setFounder(poolAddr, newFounder) {
    return trace('setFounder')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        transaction(poolIndex: UInt64, factoryAddr: Address, newFounder: Address) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            pool.setFounder(signer.address, newFounder)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: newFounder.replace('0x', ''), _fclType: fcl.t.Address },
      ]);
    });
  },

  async setFounderFund(poolAddr, fund) {
    return trace('setFounderFund')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        transaction(poolIndex: UInt64, factoryAddr: Address, fund: Address) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            pool.setFounderFund(signer.address, fund)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: fund.replace('0x', ''), _fclType: fcl.t.Address },
      ]);
    });
  },

  async claimFounderRoyalty(poolAddr, token) {
    return trace('claimFounderRoyalty')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        import FungibleToken from ${this._ftAddr()}
        transaction(poolIndex: UInt64, factoryAddr: Address, token: Address, receiverPath: PublicPath) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            pool.claimFounderRoyalty(signer.address, token, receiverPath)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: token.replace('0x', ''), _fclType: fcl.t.Address },
        { value: `/public/fr${token.replace('0x', '')}`, _fclType: fcl.t.PublicPath },
      ]);
    });
  },

  async setPromoter(poolAddr, newPromoter) {
    return trace('setPromoter')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        transaction(poolIndex: UInt64, factoryAddr: Address, newPromoter: Address) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            pool.setPromoter(signer.address, newPromoter)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: newPromoter.replace('0x', ''), _fclType: fcl.t.Address },
      ]);
    });
  },

  async setPromoterFund(poolAddr, fund) {
    return trace('setPromoterFund')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        transaction(poolIndex: UInt64, factoryAddr: Address, fund: Address) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            pool.setPromoterFund(signer.address, fund)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: fund.replace('0x', ''), _fclType: fcl.t.Address },
      ]);
    });
  },

  async claimPromoterRoyalty(poolAddr, token) {
    return trace('claimPromoterRoyalty')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        import FungibleToken from ${this._ftAddr()}
        transaction(poolIndex: UInt64, factoryAddr: Address, token: Address, receiverPath: PublicPath) {
          prepare(signer: auth(Storage) &Account) {
            let poolPath = StoragePath(identifier: "reciprocityPool".concat(poolIndex.toString()))!
            let pool = signer.storage.borrow<&Reciprocity.Pool>(from: poolPath)
              ?? panic("Pool not found")
            pool.claimPromoterRoyalty(signer.address, token, receiverPath)
          }
        }
      `;
      return this._mutate(cadence, [
        { value: '0', _fclType: fcl.t.UInt64 },
        { value: poolAddr.replace('0x', ''), _fclType: fcl.t.Address },
        { value: token.replace('0x', ''), _fclType: fcl.t.Address },
        { value: `/public/fr${token.replace('0x', '')}`, _fclType: fcl.t.PublicPath },
      ]);
    });
  },

  async getAdminState(poolAddr) {
    return trace('getAdminState')(async () => {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address): AnyStruct {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return pool.getAdminState()
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
      ]});
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
      try {
        const fcl = await waitFcl();
        const cadence = `
          import Reciprocity from ${poolAddr}
          access(all) fun main(poolAddr: Address): {Address: UInt256} {
            let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
              ?? panic("Pool not found")
            return pool.getFounderRoyalties()
          }
        `;
        const data = await fcl.query({ cadence, args: () => [
          fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
        ]});
        const entries = Object.entries(data || {});
        return { tokens: entries.map(e => e[0]), amounts: entries.map(e => BigInt(e[1])) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getPromoterRoyalties(poolAddr) {
    return trace('getPromoterRoyalties')(async () => {
      try {
        const fcl = await waitFcl();
        const cadence = `
          import Reciprocity from ${poolAddr}
          access(all) fun main(poolAddr: Address): {Address: UInt256} {
            let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
              ?? panic("Pool not found")
            return pool.getPromoterRoyalties()
          }
        `;
        const data = await fcl.query({ cadence, args: () => [
          fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)
        ]});
        const entries = Object.entries(data || {});
        return { tokens: entries.map(e => e[0]), amounts: entries.map(e => BigInt(e[1])) };
      } catch { return { tokens: [], amounts: [] }; }
    });
  },

  async getFounderRoyalty(poolAddr, token) {
    try {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address, token: Address): UInt256 {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return pool.getFounderRoyalty(token: token)
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address),
        fcl.arg(token.replace('0x', ''), fcl.t.Address)
      ]});
      return BigInt(data || '0');
    } catch { return 0n; }
  },

  async getPromoterRoyalty(poolAddr, token) {
    try {
      const fcl = await waitFcl();
      const cadence = `
        import Reciprocity from ${poolAddr}
        access(all) fun main(poolAddr: Address, token: Address): UInt256 {
          let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)
            ?? panic("Pool not found")
          return pool.getPromoterRoyalty(token: token)
        }
      `;
      const data = await fcl.query({ cadence, args: () => [
        fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address),
        fcl.arg(token.replace('0x', ''), fcl.t.Address)
      ]});
      return BigInt(data || '0');
    } catch { return 0n; }
  },

  isValidAddress(addr) {
    return typeof addr === 'string' && (addr.startsWith('0x') || /^[A-Fa-f0-9]{16}$/.test(addr));
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    const clean = addr.replace('0x', '');
    if (clean.length <= 12) return '0x' + clean;
    return '0x' + clean.slice(0, 6) + '\u2026' + clean.slice(-4);
  },

  async getBlock() {
    const block = await _fcl.send([_fcl.getBlock(true)]).then(_fcl.decode);
    return { currentBlock: Number(block.height) };
  },

  async getLastTxBlock(poolAddr) {
    // Flow doesn't expose a "most recent tx for contract" query without
    // an external indexer. Return null to show em dash until first nonce change.
    return null;
  },

  async getNonce(poolAddr) {
    // Polling-only path — use same Cadence query but without trace wrapper
    const fcl = await waitFcl();
    const cadence = '\n          import Reciprocity from ' + poolAddr + '\n          access(all) fun main(poolAddr: Address): AnyStruct {\n            let pool = getAuthAccount<auth(Storage) &Account>(poolAddr).storage.borrow<&Reciprocity.Pool>(from: /storage/reciprocityPool0)\n              ?? panic("Pool not found")\n            return pool.getStatus()\n          }\n        ';
    const data = await fcl.query({ cadence, args: () => [fcl.arg(poolAddr.replace('0x', ''), fcl.t.Address)] });
    return Number(data?.[10] || 0);
  },
});

window.chainAPI_flow = chainAPI;
})();
