// SPDX-License-Identifier: MIT
(function () {
const IDL = {
  version: "0.29.0",
  name: "reciprocity",
  instructions: [
    {
      name: "createPool",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "factory", isMut: true, isSigner: false },
        { name: "pool", isMut: true, isSigner: false },
        { name: "config", isMut: true, isSigner: false },
        { name: "lpMint", isMut: true, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "lpHolder", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
        { name: "rent", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "tokens", type: { array: ["publicKey", 13] } },
          { name: "amounts", type: { array: ["u128", 13] } },
          { name: "decimals", type: { array: ["u8", 13] } },
          { name: "atrSpreadTarget", type: "u128" },
          { name: "emaSpreadTarget", type: "u128" },
          { name: "atrPeriod", type: "u128" },
          { name: "emaPeriod", type: "u128" },
          { name: "weights", type: { vec: "u64" } },
          { name: "promoter", type: "publicKey" },
      ],
    },
    {
      name: "addLiquidity",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: true, isSigner: false },
        { name: "config", isMut: false, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "lpMint", isMut: true, isSigner: false },
        { name: "lpHolder", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "amounts", type: { vec: "u128" } },
          { name: "minShares", type: "u128" },
          { name: "weights", type: { vec: "u64" } },
          { name: "atrSpreadTarget", type: "u128" },
          { name: "emaSpreadTarget", type: "u128" },
          { name: "atrPeriod", type: "u128" },
          { name: "emaPeriod", type: "u128" },
          { name: "deadline", type: { option: "i64" } },
        ],
    },
    {
      name: "swap",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: true, isSigner: false },
        { name: "config", isMut: false, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "lpMint", isMut: true, isSigner: false },
        { name: "lpHolder", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "tokensIn", type: { vec: "publicKey" } },
        { name: "amountsIn", type: { vec: "u128" } },
          { name: "tokensOut", type: { vec: "publicKey" } },
          { name: "amountsOut", type: { vec: "u128" } },
          { name: "sharesIn", type: "u128" },
          { name: "minSharesOut", type: "u128" },
          { name: "deadline", type: { option: "i64" } },
        ],
    },
    {
      name: "removeLiquidity",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: true, isSigner: false },
        { name: "config", isMut: false, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "lpMint", isMut: true, isSigner: false },
        { name: "lpHolder", isMut: true, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "shares", type: "u128" },
          { name: "minTokensOut", type: { vec: "u128" } },
          { name: "deadline", type: { option: "i64" } },
        ],
    },
    {
      name: "getPrice",
      accounts: [{ name: "pool", isMut: false, isSigner: false }],
      args: [
        { name: "poolId", type: "u64" },
        { name: "tokenIdx", type: "u8" },
      ],
      returns: "u128",
    },
    {
      name: "consult",
      accounts: [{ name: "pool", isMut: false, isSigner: false }],
      args: [
        { name: "poolId", type: "u64" },
        { name: "secondsAgo", type: "u128" },
      ],
      returns: "u128",
    },
    {
      name: "getBalances",
      accounts: [{ name: "pool", isMut: false, isSigner: false }],
      args: [{ name: "poolId", type: "u64" }],
    },
    {
      name: "getStatus",
      accounts: [{ name: "pool", isMut: false, isSigner: false }],
      args: [{ name: "poolId", type: "u64" }],
    },
    {
      name: "getSupply",
      accounts: [{ name: "pool", isMut: false, isSigner: false }],
      args: [{ name: "poolId", type: "u64" }],
    },
    {
      name: "getTvwapState",
      accounts: [{ name: "pool", isMut: false, isSigner: false }],
      args: [{ name: "poolId", type: "u64" }],
    },
    {
      name: "initFactory",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "factory", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: "setFounder",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: false, isSigner: false },
        { name: "config", isMut: true, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "newFounder", type: "publicKey" },
      ],
    },
    {
      name: "setFounderFund",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: false, isSigner: false },
        { name: "config", isMut: true, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "fund", type: "publicKey" },
      ],
    },
    {
      name: "claimFounderRoyalty",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: true, isSigner: false },
        { name: "config", isMut: false, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "tokenIdx", type: "u8" },
      ],
    },
    {
      name: "setPromoter",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: false, isSigner: false },
        { name: "config", isMut: true, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "newPromoter", type: "publicKey" },
      ],
    },
    {
      name: "setPromoterFund",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: false, isSigner: false },
        { name: "config", isMut: true, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "fund", type: "publicKey" },
      ],
    },
    {
      name: "claimPromoterRoyalty",
      accounts: [
        { name: "admin", isMut: true, isSigner: true },
        { name: "pool", isMut: true, isSigner: false },
        { name: "config", isMut: false, isSigner: false },
        { name: "authority", isMut: false, isSigner: false },
        { name: "tokenProgram", isMut: false, isSigner: false },
      ],
      args: [
        { name: "poolId", type: "u64" },
        { name: "tokenIdx", type: "u8" },
      ],
    },
  ],
  accounts: [
    {
      name: "PoolConfig",
      type: {
        kind: "struct",
        fields: [
          { name: "founder", type: "publicKey" },
          { name: "founderFund", type: "publicKey" },
          { name: "promoter", type: "publicKey" },
          { name: "promoterFund", type: "publicKey" },
          { name: "lpMint", type: "publicKey" },
          { name: "stateBump", type: "u8" },
          { name: "authorityBump", type: "u8" },
        ],
      },
    },
    {
      name: "PoolState",
      type: {
        kind: "struct",
        fields: [
          { name: "tokens", type: { array: ["publicKey", 13] } },
          { name: "balances", type: { array: ["u128", 13] } },
          { name: "genesis", type: { array: ["u128", 13] } },
          { name: "decimals", type: { array: ["u8", 13] } },
          { name: "scale", type: "u128" },
          { name: "factors", type: "u8" },
          { name: "weights", type: { array: ["u64", 13] } },
          { name: "supply", type: "u128" },
          { name: "atrSpreadTarget", type: "u128" },
          { name: "emaSpreadTarget", type: "u128" },
          { name: "atrPeriod", type: "u128" },
          { name: "emaPeriod", type: "u128" },
          { name: "atrSpread", type: "u128" },
          { name: "atrSpreadRem", type: "i128" },
          { name: "spreadAdditive", type: "i128" },
          { name: "spreadMultiplier", type: "u128" },
          { name: "lastSpread", type: "u128" },
          { name: "avgSpread", type: "u128" },
          { name: "avgSpreadRem", type: "i128" },
          { name: "spreadCount", type: "u64" },
          { name: "transactions", type: "u64" },
          { name: "initialized", type: "bool" },
          { name: "bump", type: "u8" },
          { name: "founderRoyalties", type: { vec: "u128" } },
          { name: "promoterRoyalties", type: { vec: "u128" } },
          { name: "lpRoyalties", type: { vec: "u128" } },
          { name: "lastTimestamp", type: "i64" },
          { name: "accK15m", type: "u128" },
          { name: "accW15m", type: "u128" },
          { name: "tvwap15m", type: "u128" },
          { name: "windowStart15m", type: "i64" },
          { name: "accK1hr", type: "u128" },
          { name: "accW1hr", type: "u128" },
          { name: "tvwap1hr", type: "u128" },
          { name: "windowStart1hr", type: "i64" },
          { name: "accK24hr", type: "u128" },
          { name: "accW24hr", type: "u128" },
          { name: "tvwap24hr", type: "u128" },
          { name: "windowStart24hr", type: "i64" },
        ],
      },
    },
    {
      name: "FactoryState",
      type: {
        kind: "struct",
        fields: [
          { name: "founder", type: "publicKey" },
          { name: "poolCount", type: "u64" },
          { name: "genesisEnforced", type: "bool" },
          { name: "founderFund", type: "publicKey" },
          { name: "bump", type: "u8" },
          { name: "genesisAsset1", type: "publicKey" },
          { name: "genesisAsset2", type: "publicKey" },
          { name: "genesisAsset3", type: "publicKey" },
        ],
      },
    },
  ],
  events: [
    {
      name: "SwapEvent",
      fields: [
        { name: "user", type: "publicKey", index: false },
        { name: "tokensIn", type: { vec: "publicKey" }, index: false },
        { name: "amountsIn", type: { vec: "u128" }, index: false },
        { name: "tokensOut", type: { vec: "publicKey" }, index: false },
        { name: "amountsOut", type: { vec: "u128" }, index: false },
        { name: "reciprocity", type: "i128", index: false },
        { name: "kBefore", type: "u128", index: false },
        { name: "kAfter", type: "u128", index: false },
        { name: "fees", type: { vec: "u128" }, index: false },
        { name: "timestamp", type: "i64", index: false },
      ],
    },
    {
      name: "Liquidity",
      fields: [
        { name: "user", type: "publicKey", index: false },
        { name: "action", type: "string", index: false },
        { name: "shares", type: "u128", index: false },
        { name: "tokens", type: { vec: "publicKey" }, index: false },
        { name: "amounts", type: { vec: "u128" }, index: false },
        { name: "konstant", type: "u128", index: false },
        { name: "timestamp", type: "i64", index: false },
      ],
    },
    {
      name: "FeeCollected",
      fields: [
        { name: "owner", type: "publicKey", index: false },
        { name: "amounts", type: { vec: "u128" }, index: false },
        { name: "timestamp", type: "i64", index: false },
      ],
    },
    {
      name: "PoolDeployed",
      fields: [
        { name: "poolId", type: "u64", index: false },
        { name: "pool", type: "publicKey", index: false },
        { name: "owner", type: "publicKey", index: false },
        { name: "tokens", type: { vec: "publicKey" }, index: false },
        { name: "timestamp", type: "i64", index: false },
      ],
    },
  ],
  errors: [
    { code: 6000, name: "AlreadyInitialized", msg: "AlreadyInitialized" },
    { code: 6001, name: "NotInitialized", msg: "NotInitialized" },
    { code: 6002, name: "InvalidOrder", msg: "InvalidOrder" },
    { code: 6003, name: "SlippageExceeded", msg: "SlippageExceeded" },
    { code: 6004, name: "InsufficientShares", msg: "InsufficientShares" },
    { code: 6005, name: "InsufficientBalance", msg: "InsufficientBalance" },
    { code: 6006, name: "Overflow", msg: "Overflow" },
    { code: 6007, name: "ComputeLimit", msg: "ComputeLimit" },
    { code: 6008, name: "InvalidToken", msg: "InvalidToken" },
    { code: 6009, name: "DivByZero", msg: "DivByZero" },
    { code: 6010, name: "TokenNotInPool", msg: "TokenNotInPool" },
    { code: 6011, name: "Unauthorized", msg: "Unauthorized" },
    { code: 6012, name: "NotFounder", msg: "not founder" },
    { code: 6013, name: "NotPromoter", msg: "not promoter" },
    { code: 6014, name: "RoyaltyLocked", msg: "royalty locked" },
    { code: 6015, name: "ExceedsMax", msg: "exceeds max" },
    { code: 6016, name: "NothingToClaim", msg: "nothing to claim" },
    { code: 6017, name: "ZeroAddress", msg: "zero address" },
    { code: 6018, name: "NoFactory", msg: "no factory" },
    { code: 6019, name: "GenesisRequired", msg: "GenesisRequired" },
    { code: 6020, name: "NoKnownToken", msg: "NoKnownToken" },
    { code: 6021, name: "LPSyncDrift", msg: "LPSyncDrift" },
    { code: 6022, name: "InvalidPeriod", msg: "InvalidPeriod" },
  ],
};

const SOLANA_NETWORKS = {
  localhost: {
    rpc: 'http://localhost:8899',
    factory: '75PPMcnpZxVVmpNDSUY4VTHErdrPAKLUioVp9bS6PtkE',
    explorer: 'https://explorer.solana.com',
  },
  devnet: {
    rpc: 'https://api.devnet.solana.com',
    factory: null,
    explorer: 'https://explorer.solana.com',
  },
  mainnet: {
    rpc: 'https://api.mainnet-beta.solana.com',
    factory: null,
    explorer: 'https://explorer.solana.com',
  },
};

const MAX_TOKENS = 13;
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

let solWeb3 = null;
let solAnchor = null;
let solConnection = null;
let solProvider = null;
let solProgram = null;
let solWalletKey = null;

function traceCall(label) {
  return async function (fn) {
    var start = performance.now();
    try {
      var result = await fn();
      var ms = (performance.now() - start).toFixed(0);
      console.log(
        '%c[Solana] %c' + label + ' ' + ms + 'ms',
        'color:#888',
        'color:' + (ms > 2000 ? '#e85858' : ms > 500 ? '#d4a040' : '#3dcf8e'),
        result !== undefined
          ? typeof result === 'bigint'
            ? result.toString().slice(0, 40) + '...'
            : Array.isArray(result)
              ? result.length + ' items'
              : typeof result === 'object'
                ? Object.keys(result).length + ' fields'
                : result
          : ''
      );
      return result;
    } catch (e) {
      var ms = (performance.now() - start).toFixed(0);
      console.warn(
        '%c[Solana] %c' + label + ' FAILED ' + ms + 'ms',
        'color:#888',
        'color:#e85858',
        e.message || e
      );
      throw e;
    }
  };
}

function pubkey(addr) {
  return new solWeb3.PublicKey(addr);
}

function bufToStr(b) {
  return solWeb3 ? Array.from(b).map(function(x){return ('0'+x.toString(16)).slice(-2)}).join('') : '';
}

function findPda(seeds, programId) {
  return solWeb3.PublicKey.findProgramAddressSync(
    seeds.map(function (s) {
      return typeof s === 'string' ? new TextEncoder().encode(s) : s;
    }),
    pubkey(programId)
  );
}

function decodePoolState(data) {
  var coder = new solAnchor.BorshCoder(IDL);
  return coder.accounts.decode('PoolState', data);
}

function decodePoolConfig(data) {
  var coder = new solAnchor.BorshCoder(IDL);
  return coder.accounts.decode('PoolConfig', data);
}

function decodeFactoryState(data) {
  var coder = new solAnchor.BorshCoder(IDL);
  return coder.accounts.decode('FactoryState', data);
}

async function fetchPoolState(poolAddr) {
  var info = await solConnection.getAccountInfo(pubkey(poolAddr));
  if (!info) throw new Error('PoolState account not found: ' + poolAddr);
  return decodePoolState(info.data);
}

function getAta(mint, owner) {
  var toSeed = function (pk) { return (pk.toBytes || pk.toBuffer).call(pk); };
  return solWeb3.PublicKey.findProgramAddressSync(
    [toSeed(pubkey(owner)), toSeed(pubkey(TOKEN_PROGRAM_ID)), toSeed(pubkey(mint))],
    pubkey(ASSOCIATED_TOKEN_PROGRAM_ID)
  )[0];
}

function u64ToBytes(val) {
  var buf = new Uint8Array(8);
  var n = BigInt(val);
  for (var i = 0; i < 8; i++) {
    buf[i] = Number((n >> BigInt(i * 8)) & 0xFFn);
  }
  return buf;
}

async function fetchPoolConfig(configAddr) {
  var info = await solConnection.getAccountInfo(pubkey(configAddr));
  if (!info) throw new Error('PoolConfig account not found: ' + configAddr);
  return decodePoolConfig(info.data);
}

var chainAPI = Object.assign(Object.create(window.chainAPI_base), {
  name: 'Solana',
  logo: 'img/logos/solana.svg',
  defaultRpc: SOLANA_NETWORKS.devnet.rpc,
  defaultFactory: '75PPMcnpZxVVmpNDSUY4VTHErdrPAKLUioVp9bS6PtkE',
  network: 'devnet',
  chainId: 0,
  explorer: SOLANA_NETWORKS.devnet.explorer,
  configs: SOLANA_NETWORKS,
  programId: '3mbJ26db3paaWHcjQ2QHSP9aPBG1GZ8V5nY81D17nUAr',

  setNetwork: function (network) {
    var cfg = SOLANA_NETWORKS[network];
    if (!cfg) {
      cfg = SOLANA_NETWORKS['devnet'];
      network = 'devnet';
    }
    this.defaultRpc = cfg.rpc;
    this.defaultFactory = cfg.factory;
    this.chainId = network === 'devnet' ? 0 : 1;
    this.explorer = cfg.explorer;
    this.network = network;
    console.log(
      '%c[Solana] %cNetwork: ' + network,
      'color:#888',
      'color:#2d7cf0'
    );
  },

  loadSDK: async function () {
    if (typeof window.solanaWeb3 !== 'undefined' && typeof window.anchor !== 'undefined') {
      solWeb3 = window.solanaWeb3;
      solAnchor = window.anchor;
      return true;
    }
    var esmUrls = [
      'https://esm.sh/@solana/web3.js@1.95.5',
      'https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95.5/+esm',
    ];
    for (var i = 0; i < esmUrls.length; i++) {
      try {
        var mod = await import(esmUrls[i]);
        if (mod && mod.Connection) {
          solWeb3 = mod;
          window.solanaWeb3 = mod;
          break;
        }
      } catch (_) {}
    }
    if (!solWeb3) {
      try {
        if (typeof solanaWeb3 !== 'undefined') { solWeb3 = solanaWeb3; window.solanaWeb3 = solanaWeb3; }
      } catch (_) {}
    }
    if (!solWeb3) return false;
    var anchorUrls = [
      'https://esm.sh/@coral-xyz/anchor@0.29.0',
      'https://cdn.jsdelivr.net/npm/@coral-xyz/anchor@0.29.0/+esm',
    ];
    for (var j = 0; j < anchorUrls.length; j++) {
      try {
        var ancMod = await import(anchorUrls[j]);
        if (ancMod && ancMod.Program) {
          solAnchor = ancMod;
          window.anchor = ancMod;
          return true;
        }
      } catch (_) {}
    }
    return false;
  },

  connectWallet: async function () {
    if (typeof window.solana === 'undefined' || !window.solana.isPhantom)
      throw new Error('Phantom wallet not detected');

    var resp;
    try {
      resp = await window.solana.connect();
    } catch (e) {
      if (e.code === 4001) throw new Error('Wallet connection rejected');
      throw e;
    }

    solWalletKey = resp.publicKey.toString();
    solConnection = new solWeb3.Connection(
      this.defaultRpc,
      'confirmed'
    );

    var providerObj = {
      publicKey: resp.publicKey,
      connection: solConnection,
      sendAndConfirmTransaction: async function (tx, signers) {
        tx.feePayer = resp.publicKey;
        tx.recentBlockhash = (
          await solConnection.getLatestBlockhash()
        ).blockhash;
        var signed = await window.solana.signTransaction(tx);
        var sig = await solConnection.sendRawTransaction(signed.serialize());
        await solConnection.confirmTransaction(sig, 'confirmed');
        return sig;
      },
    };

    solProvider = new solAnchor.AnchorProvider(
      solConnection,
      {
        publicKey: resp.publicKey,
        signTransaction: function (tx) {
          tx.feePayer = resp.publicKey;
          return window.solana.signTransaction(tx);
        },
        signAllTransactions: function (txs) {
          return window.solana.signAllTransactions(txs);
        },
      },
      {}
    );

    solProgram = new solAnchor.Program(IDL, pubkey(this.programId), solProvider);

    await chainAPI._loadPoolIds();

    console.log(
      '%c[Solana] %cconnectWallet',
      'color:#888',
      'color:#3dcf8e',
      this.shortenAddress(solWalletKey)
    );

    return { account: solWalletKey, provider: 'phantom', networkName: this.network };
  },

  _poolIdCache: {},

  _factoryPda: function () {
    if (!solWeb3 || !this.programId) return null;
    try { return findPda(['factory'], this.programId)[0]; } catch (_) { return null; }
  },

  _poolPda: function (poolId) {
    if (!solWeb3 || !this.programId) return null;
    try { return findPda(['state', u64ToBytes(poolId)], this.programId)[0]; } catch (_) { return null; }
  },

  _configPda: function (poolId) {
    if (!solWeb3 || !this.programId) return null;
    try { return findPda(['config', u64ToBytes(poolId)], this.programId)[0]; } catch (_) { return null; }
  },

  _authorityPda: function (poolId) {
    if (!solWeb3 || !this.programId) return null;
    try { return findPda(['authority', u64ToBytes(poolId)], this.programId)[0]; } catch (_) { return null; }
  },

  _lpMintPda: function (poolId) {
    if (!solWeb3 || !this.programId) return null;
    try { return findPda(['lp_mint', u64ToBytes(poolId)], this.programId)[0]; } catch (_) { return null; }
  },

  _loadPoolIds: async function () {
    if (!solConnection) return;
    var factoryAddr = chainAPI._factoryPda();
    if (!factoryAddr) return;
    try {
      var info = await solConnection.getAccountInfo(factoryAddr);
      if (!info) return;
      var factory = decodeFactoryState(info.data);
      var poolCount = Number(factory.poolCount || 0);
      chainAPI._poolIdCache = {};
      for (var i = 0; i < poolCount; i++) {
        var pda = chainAPI._poolPda(i);
        if (pda) {
          chainAPI._poolIdCache[pda.toString()] = i;
        }
      }
    } catch (_) {}
  },

  _getPoolId: function (poolAddr) {
    var id = chainAPI._poolIdCache[poolAddr];
    return id !== undefined ? id : -1;
  },

  getPdas: function (poolAddr) {
    var poolId = chainAPI._getPoolId(poolAddr);
    if (poolId === -1) {
      return {
        pool: pubkey(poolAddr),
        config: null,
        authority: null,
        lpMint: null,
        lpHolder: null,
        poolBump: 255,
        factory: chainAPI._factoryPda(),
      };
    }
    var lpHolder = null;
    var lpMintAddr = chainAPI._lpMintPda(poolId);
    if (lpMintAddr && solWalletKey) {
      lpHolder = getAta(lpMintAddr.toString(), solWalletKey);
    }
    return {
      pool: pubkey(poolAddr),
      config: chainAPI._configPda(poolId),
      authority: chainAPI._authorityPda(poolId),
      lpMint: lpMintAddr,
      lpHolder: lpHolder,
      poolBump: 255,
      factory: chainAPI._factoryPda(),
    };
  },

  getBalances: async function (poolAddr) {
    return traceCall('getBalances(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var state = await fetchPoolState(poolAddr);
      var f = state.factors;
      var tokens = [];
      var amounts = [];
      for (var i = 0; i < f; i++) {
        tokens.push(state.tokens[i].toString());
        amounts.push(BigInt(state.balances[i].toString()));
      }
      return { tokens: tokens, amounts: amounts };
    });
  },

  getStatus: async function (poolAddr) {
    return traceCall('getStatus(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var state = await fetchPoolState(poolAddr);
      return {
        supply: BigInt(state.supply.toString()),
        atrSpreadTarget: BigInt(state.atrSpreadTarget.toString()),
        emaSpreadTarget: BigInt(state.emaSpreadTarget.toString()),
        atrPeriod: BigInt(state.atrPeriod.toString()),
        emaPeriod: BigInt(state.emaPeriod.toString()),
        atrSpread: BigInt(state.atrSpread.toString()),
        spreadAdditive: BigInt(state.spreadAdditive.toString()),
        txs: BigInt(state.transactions.toString()),
      };
    });
  },

  getTvwapState: async function (poolAddr) {
    return traceCall('getTvwapState(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var result = await solProgram.methods
        .getTvwapState(new solAnchor.BN(poolId))
        .accounts({ pool: pubkey(poolAddr) })
        .view();
      return {
        tvwap15m: BigInt(result.tvwap15m ?? result[0].toString()),
        accW15m: BigInt(result.accW15m ?? result[1].toString()),
        windowStart15m: Number(result.windowStart15m ?? result[2]),
        tvwap1hr: BigInt(result.tvwap1hr ?? result[3].toString()),
        accW1hr: BigInt(result.accW1hr ?? result[4].toString()),
        windowStart1hr: Number(result.windowStart1hr ?? result[5]),
        tvwap24hr: BigInt(result.tvwap24hr ?? result[6].toString()),
        accW24hr: BigInt(result.accW24hr ?? result[7].toString()),
        windowStart24hr: Number(result.windowStart24hr ?? result[8]),
        lastTimestamp: Number(result.lastTimestamp ?? result[9]),
        currentK: BigInt(result.currentK ?? result[10].toString()),
      };
    });
  },

  getTvwapPrices: async function (poolAddr, secondsAgo) {
    return traceCall('getTvwapPrices(' + chainAPI.shortenAddress(poolAddr) + ', ' + secondsAgo + 's)')(async function () {
      var tvwapK = await chainAPI.consult(poolAddr, secondsAgo);
      var bals = await chainAPI.getBalances(poolAddr);
      return window.reciprocity_math.getTvwapPrices(tvwapK, bals.amounts, bals.tokens);
    });
  },

  getLPToken: async function (poolAddr) {
    return traceCall('getLPToken(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var pdas = chainAPI.getPdas(poolAddr);
      var config = await fetchPoolConfig(pdas.config.toString());
      return config.lpMint.toString();
    });
  },

  getSupply: async function (poolAddr) {
    return traceCall('getSupply(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var result = await solProgram.methods
        .getSupply(new solAnchor.BN(poolId))
        .accounts({ pool: pubkey(poolAddr) })
        .view();
      return BigInt(result.toString());
    });
  },

  consult: async function (poolAddr, secondsAgo) {
    return traceCall('consult(' + chainAPI.shortenAddress(poolAddr) + ', ' + secondsAgo + 's)')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var result = await solProgram.methods
        .consult(new solAnchor.BN(poolId), new solAnchor.BN(secondsAgo))
        .accounts({ pool: pubkey(poolAddr) })
        .view();
      return BigInt(result.toString());
    });
  },

  getKonstant: async function (poolAddr) {
    return chainAPI.consult(poolAddr, 0);
  },

  getPoolConfig: async function (poolAddr) {
    return traceCall('getPoolConfig(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var state = await fetchPoolState(poolAddr);
      var f = state.factors;
      return {
        tokens: state.tokens.slice(0, f).map(function (p) { return p.toString(); }),
        balances: state.balances.slice(0, f).map(function (v) { return BigInt(v.toString()); }),
        genesis: state.genesis.slice(0, f).map(function (v) { return BigInt(v.toString()); }),
        factors: f,
        scale: BigInt(state.scale.toString()),
        atr_spread_target: BigInt(state.atrSpreadTarget.toString()),
        ema_spread_target: BigInt(state.emaSpreadTarget.toString()),
        atr_period: BigInt(state.atrPeriod.toString()),
        ema_period: BigInt(state.emaPeriod.toString()),
        atr_spread: BigInt(state.atrSpread.toString()),
        spread_additive: BigInt(state.spreadAdditive.toString()),
        spread_multiplier: BigInt(state.spreadMultiplier.toString()),
        supply: BigInt(state.supply.toString()),
        weights: state.weights.slice(0, f).map(function (v) { return BigInt(v.toString()); }),
      };
    });
  },

  quoteSwap: async function (poolAddr, order) {
    var [pd, status] = await Promise.all([
      chainAPI.getPoolConfig(poolAddr),
      chainAPI.getStatus(poolAddr),
    ]);
    pd.spread_additive = status.spreadAdditive;
    return window.reciprocity_math.quoteSwap(pd, order);
  },

  verifyQuote: async function (poolAddr, order) {
    var localQuote = await chainAPI.quoteSwap(poolAddr, order);
    var onchainQuote = null;
    var match = true;
    var skipped = false;
    try {
      if (typeof chainAPI._onchainQuoteSwap === 'function') {
        onchainQuote = await chainAPI._onchainQuoteSwap(poolAddr, order);
        match = window.reciprocity_math.quotesEqual(localQuote, onchainQuote);
      } else {
        skipped = true;
      }
    } catch (e) {
      console.warn('On-chain quoteSwap call failed:', e.message);
    }
    console.log('=== RECIPROCITY VERIFY OFFER ===');
    console.log('Local Quote:', _safeStringify(localQuote));
    if (onchainQuote) {
      console.log('On-Chain Quote:', _safeStringify(onchainQuote));
      console.log('Match:', match);
    } else if (skipped) {
      console.log('On-Chain: SKIPPED — no on-chain quoteSwap view on this port');
    } else {
      console.log('On-Chain: FAILED — using local quote only');
    }
    return { verified: match, local: localQuote, onchain: onchainQuote, match: match, skipped: skipped };
  },

  executeSwap: async function (poolAddr, order, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return traceCall('swap @ ' + chainAPI.shortenAddress(poolAddr))(async function () {
      var pdas = chainAPI.getPdas(poolAddr);
      var tokensIn = order.tokensIn.map(pubkey);
      var amountsIn = order.amountsIn.map(function (a) {
        return new solAnchor.BN(a.toString());
      });
      var tokensOut = order.tokensOut.map(pubkey);
      var amountsOut = order.amountsOut.map(function (a) {
        return new solAnchor.BN(a.toString());
      });
      var sharesIn = new solAnchor.BN((order.sharesIn || 0).toString());
      var minSharesOut = new solAnchor.BN((order.minSharesOut || 0).toString());

      var wpk = pubkey(solWalletKey);
      var SYSRENT = pubkey('SysvarRent111111111111111111111111111111111');
      var remainingAccounts = [];
      var extraIxs = [];

      for (var i = 0; i < tokensIn.length; i++) {
        var srcAta = await getAta(tokensIn[i], wpk);
        remainingAccounts.push({ pubkey: srcAta, isSigner: false, isWritable: true });
      }
      for (var j = 0; j < tokensIn.length; j++) {
        var vaultAta = await getAta(tokensIn[j], pdas.authority);
        remainingAccounts.push({ pubkey: vaultAta, isSigner: false, isWritable: true });
        try {
          var info = await solConnection.getAccountInfo(vaultAta);
          if (!info) {
            extraIxs.push(new solWeb3.TransactionInstruction({
              programId: pubkey(ASSOCIATED_TOKEN_PROGRAM_ID),
              keys: [
                { pubkey: wpk, isSigner: true, isWritable: true },
                { pubkey: vaultAta, isSigner: false, isWritable: true },
                { pubkey: pdas.authority, isSigner: false, isWritable: false },
                { pubkey: pubkey(tokensIn[j]), isSigner: false, isWritable: false },
                { pubkey: solWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: pubkey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
                { pubkey: SYSRENT, isSigner: false, isWritable: false },
              ],
              data: new Uint8Array([0]),
            }));
          }
        } catch (_) {}
      }
      for (var k = 0; k < tokensOut.length; k++) {
        var outVaultAta = await getAta(tokensOut[k], pdas.authority);
        remainingAccounts.push({ pubkey: outVaultAta, isSigner: false, isWritable: true });
        try {
          var info = await solConnection.getAccountInfo(outVaultAta);
          if (!info) {
            extraIxs.push(new solWeb3.TransactionInstruction({
              programId: pubkey(ASSOCIATED_TOKEN_PROGRAM_ID),
              keys: [
                { pubkey: wpk, isSigner: true, isWritable: true },
                { pubkey: outVaultAta, isSigner: false, isWritable: true },
                { pubkey: pdas.authority, isSigner: false, isWritable: false },
                { pubkey: pubkey(tokensOut[k]), isSigner: false, isWritable: false },
                { pubkey: solWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: pubkey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
                { pubkey: SYSRENT, isSigner: false, isWritable: false },
              ],
              data: new Uint8Array([0]),
            }));
          }
        } catch (_) {}
      }
      for (var l = 0; l < tokensOut.length; l++) {
        var dstAta = await getAta(tokensOut[l], wpk);
        remainingAccounts.push({ pubkey: dstAta, isSigner: false, isWritable: true });
      }

      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var txData = await solProgram.methods
        .swap(new solAnchor.BN(poolId), tokensIn, amountsIn, tokensOut, amountsOut, sharesIn, minSharesOut)
        .accounts({
          admin: wpk,
          pool: pubkey(poolAddr),
          config: pdas.config,
          authority: pdas.authority,
          lpMint: pdas.lpMint,
          lpHolder: pdas.lpHolder,
          tokenProgram: pubkey(TOKEN_PROGRAM_ID),
        })
        .remainingAccounts(remainingAccounts)
        .transaction();

      var bh = await solConnection.getLatestBlockhash();
      txData.recentBlockhash = bh.blockhash;
      txData.feePayer = wpk;
      for (var m = 0; m < extraIxs.length; m++) txData.instructions.unshift(extraIxs[m]);
      var signed = await solProvider.wallet.signTransaction(txData);
      var sig = await solConnection.sendRawTransaction(signed.serialize());
      var result = await solConnection.confirmTransaction(sig, 'confirmed');
      if (result.value.err) throw new Error('TX failed: ' + JSON.stringify(result.value.err));

      return sig;
    });
  },

  addLiquidity: async function (poolAddr, tokens, amounts, minShares, weights, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return traceCall('addLiquidity @ ' + chainAPI.shortenAddress(poolAddr))(async function () {
      var pdas = chainAPI.getPdas(poolAddr);
      var bnAmounts = amounts.map(function (a) {
        return new solAnchor.BN(a.toString());
      });
      var bnMinShares = new solAnchor.BN((minShares || 0).toString());
      var bnWeights = (weights || []).map(function (w) { return new solAnchor.BN(w.toString()); });
      var bnAtrSpreadTarget = new solAnchor.BN((atrSpreadTarget || 0).toString());
      var bnEmaSpreadTarget = new solAnchor.BN((emaSpreadTarget || 0).toString());
      var bnAtrPeriod = new solAnchor.BN((atrPeriod || 0).toString());
      var bnEmaPeriod = new solAnchor.BN((emaPeriod || 0).toString());

      var wpk = pubkey(solWalletKey);
      var SYSRENT = pubkey('SysvarRent111111111111111111111111111111111');
      var remainingAccounts = [];
      var extraIxs = [];
      for (var i = 0; i < tokens.length; i++) {
        var srcAta = await getAta(tokens[i], wpk);
        remainingAccounts.push({ pubkey: srcAta, isSigner: false, isWritable: true });
      }
      for (var j = 0; j < tokens.length; j++) {
        var vaultAta = await getAta(tokens[j], pdas.authority);
        remainingAccounts.push({ pubkey: vaultAta, isSigner: false, isWritable: true });
        try {
          var info = await solConnection.getAccountInfo(vaultAta);
          if (!info) {
            extraIxs.push(new solWeb3.TransactionInstruction({
              programId: pubkey(ASSOCIATED_TOKEN_PROGRAM_ID),
              keys: [
                { pubkey: wpk, isSigner: true, isWritable: true },
                { pubkey: vaultAta, isSigner: false, isWritable: true },
                { pubkey: pdas.authority, isSigner: false, isWritable: false },
                { pubkey: pubkey(tokens[j]), isSigner: false, isWritable: false },
                { pubkey: solWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: pubkey(TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
                { pubkey: SYSRENT, isSigner: false, isWritable: false },
              ],
              data: new Uint8Array([0]),
            }));
          }
        } catch (_) {}
      }

      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var txData = await solProgram.methods
        .addLiquidity(new solAnchor.BN(poolId), bnAmounts, bnMinShares, bnWeights, bnAtrSpreadTarget, bnEmaSpreadTarget, bnAtrPeriod, bnEmaPeriod)
        .accounts({
          admin: wpk,
          pool: pubkey(poolAddr),
          config: pdas.config,
          authority: pdas.authority,
          lpMint: pdas.lpMint,
          lpHolder: pdas.lpHolder,
          tokenProgram: pubkey(TOKEN_PROGRAM_ID),
        })
        .remainingAccounts(remainingAccounts)
        .transaction();

      var bh = await solConnection.getLatestBlockhash();
      txData.recentBlockhash = bh.blockhash;
      txData.feePayer = wpk;
      for (var k = 0; k < extraIxs.length; k++) txData.instructions.unshift(extraIxs[k]);
      var signed = await solProvider.wallet.signTransaction(txData);
      var sig = await solConnection.sendRawTransaction(signed.serialize());
      var result = await solConnection.confirmTransaction(sig, 'confirmed');
      if (result.value.err) throw new Error('TX failed: ' + JSON.stringify(result.value.err));

      return sig;
    });
  },

  removeLiquidity: async function (poolAddr, shares, minTokensOut, deadline = DEFAULT_DEADLINE_SECONDS) {
    const deadlineTs = deadline > 0 ? Math.floor(Date.now() / 1000) + deadline : 0;
    return traceCall('removeLiquidity @ ' + chainAPI.shortenAddress(poolAddr))(async function () {
      var pdas = chainAPI.getPdas(poolAddr);
      var bnShares = new solAnchor.BN(shares.toString());
      var bnMinOut = minTokensOut.map(function (m) {
        return new solAnchor.BN(m.toString());
      });

      var state = await fetchPoolState(poolAddr);
      var f = state.factors;
      var wpk = pubkey(solWalletKey);

      var remainingAccounts = [];
      for (var i = 0; i < f; i++) {
        var vaultAta = await getAta(state.tokens[i].toString(), pdas.authority);
        remainingAccounts.push({ pubkey: vaultAta, isSigner: false, isWritable: true });
      }
      for (var j = 0; j < f; j++) {
        var dstAta = await getAta(state.tokens[j].toString(), wpk);
        remainingAccounts.push({ pubkey: dstAta, isSigner: false, isWritable: true });
      }

      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var sig = await solProgram.methods
        .removeLiquidity(new solAnchor.BN(poolId), bnShares, bnMinOut)
        .accounts({
          admin: wpk,
          pool: pubkey(poolAddr),
          config: pdas.config,
          authority: pdas.authority,
          lpMint: pdas.lpMint,
          lpHolder: pdas.lpHolder,
          tokenProgram: pubkey(TOKEN_PROGRAM_ID),
        })
        .remainingAccounts(remainingAccounts)
        .rpc();

      return sig;
    });
  },

  getTokenSymbol: async function (tokenAddr) {
    return traceCall('symbol @ ' + chainAPI.shortenAddress(tokenAddr))(async function () {
      return chainAPI.shortenAddress(tokenAddr);
    });
  },

  getTokenDecimals: async function (tokenAddr) {
    return traceCall('decimals @ ' + chainAPI.shortenAddress(tokenAddr))(async function () {
      try {
        var pk = pubkey(tokenAddr);
        var info = await solConnection.getAccountInfo(pk);
        if (info && info.data.length >= 44) {
          return info.data[44];
        }
      } catch (_) {}
      return 6;
    });
  },

  getTokenBalance: async function (tokenAddr, account) {
    return traceCall('balanceOf(' + chainAPI.shortenAddress(account) + ') @ ' + chainAPI.shortenAddress(tokenAddr))(async function () {
      try {
        var owner = pubkey(account);
        var mintPk = pubkey(tokenAddr);
        var response = await solConnection.getTokenAccountsByOwner(owner, { mint: mintPk });
        if (response.value.length > 0) {
          var info = await solConnection.getTokenAccountBalance(response.value[0].pubkey);
          return info && info.value ? BigInt(info.value.amount) : 0n;
        }
        return 0n;
      } catch (_) {
        return 0n;
      }
    });
  },

  getPoolTokenBalance: async function (tokenAddr, poolAddr) {
    return traceCall('pool vault @ ' + chainAPI.shortenAddress(tokenAddr))(async function () {
      try {
        var pdas = chainAPI.getPdas(poolAddr);
        var owner = pdas.authority;
        var mintPk = pubkey(tokenAddr);
        var response = await solConnection.getTokenAccountsByOwner(owner, { mint: mintPk });
        if (response.value.length > 0) {
          var info = await solConnection.getTokenAccountBalance(response.value[0].pubkey);
          return info && info.value ? BigInt(info.value.amount) : 0n;
        }
        return 0n;
      } catch (_) {
        return 0n;
      }
    });
  },

  approveIfNeeded: async function (tokenAddr, spender, owner, amount) {
    return;
  },

  getPoolCount: async function (factoryAddr) {
    return traceCall('getPoolCount')(async function () {
      try {
        if (!solConnection) return 0;
        var factoryAddr = chainAPI._factoryPda();
        if (!factoryAddr) return 0;
        var info = await solConnection.getAccountInfo(factoryAddr);
        if (!info) return 0;
        var factory = decodeFactoryState(info.data);
        return Number(factory.poolCount || 0);
      } catch (e) {
        return 0;
      }
    });
  },

  getPools: async function (factoryAddr) {
    return traceCall('getPools')(async function () {
      try {
        if (!solConnection) return [];
        var factoryAddr = chainAPI._factoryPda();
        if (!factoryAddr) return [];
        var info = await solConnection.getAccountInfo(factoryAddr);
        if (!info) return [];
        var factory = decodeFactoryState(info.data);
        var poolCount = Number(factory.poolCount || 0);
        chainAPI._poolIdCache = {};
        var pools = [];
        for (var i = 0; i < poolCount; i++) {
          var pda = chainAPI._poolPda(i);
          if (pda) {
            pools.push(pda.toString());
            chainAPI._poolIdCache[pda.toString()] = i;
          }
        }
        return pools;
      } catch (e) {
        return [];
      }
    });
  },

  // ══════════════════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ══════════════════════════════════════════════════════════

  setFounder: async function (poolAddr, newFounder) {
    return traceCall('setFounder(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var pdas = chainAPI.getPdas(poolAddr);
      var wpk = pubkey(solWalletKey);
      return await solProgram.methods
        .setFounder(new solAnchor.BN(poolId), pubkey(newFounder))
        .accounts({ admin: wpk, pool: pubkey(poolAddr), config: pdas.config })
        .rpc();
    });
  },

  setFounderFund: async function (poolAddr, fund) {
    return traceCall('setFounderFund(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var pdas = chainAPI.getPdas(poolAddr);
      var wpk = pubkey(solWalletKey);
      return await solProgram.methods
        .setFounderFund(new solAnchor.BN(poolId), pubkey(fund))
        .accounts({ admin: wpk, pool: pubkey(poolAddr), config: pdas.config })
        .rpc();
    });
  },

  claimFounderRoyalty: async function (poolAddr, token) {
    return traceCall('claimFounderRoyalty(' + chainAPI.shortenAddress(poolAddr) + ', ' + chainAPI.shortenAddress(token) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var pdas = chainAPI.getPdas(poolAddr);
      var wpk = pubkey(solWalletKey);
      var config = await fetchPoolConfig(pdas.config.toString());
      var state = await fetchPoolState(poolAddr);
      var tokenIdx = 0;
      for (var i = 0; i < state.factors; i++) {
        if (state.tokens[i].toString() === token) { tokenIdx = i; break; }
      }
      var vaultAta = await getAta(token, pdas.authority);
      var dstAta = await getAta(token, config.founderFund);
      return await solProgram.methods
        .claimFounderRoyalty(new solAnchor.BN(poolId), tokenIdx)
        .accounts({
          admin: wpk,
          pool: pubkey(poolAddr),
          config: pdas.config,
          authority: pdas.authority,
          tokenProgram: pubkey(TOKEN_PROGRAM_ID),
        })
        .remainingAccounts([
          { pubkey: vaultAta, isSigner: false, isWritable: true },
          { pubkey: dstAta, isSigner: false, isWritable: true },
        ])
        .rpc();
    });
  },

  setPromoter: async function (poolAddr, newPromoter) {
    return traceCall('setPromoter(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var pdas = chainAPI.getPdas(poolAddr);
      var wpk = pubkey(solWalletKey);
      return await solProgram.methods
        .setPromoter(new solAnchor.BN(poolId), pubkey(newPromoter))
        .accounts({ admin: wpk, pool: pubkey(poolAddr), config: pdas.config })
        .rpc();
    });
  },

  setPromoterFund: async function (poolAddr, fund) {
    return traceCall('setPromoterFund(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var pdas = chainAPI.getPdas(poolAddr);
      var wpk = pubkey(solWalletKey);
      return await solProgram.methods
        .setPromoterFund(new solAnchor.BN(poolId), pubkey(fund))
        .accounts({ admin: wpk, pool: pubkey(poolAddr), config: pdas.config })
        .rpc();
    });
  },

  claimPromoterRoyalty: async function (poolAddr, token) {
    return traceCall('claimPromoterRoyalty(' + chainAPI.shortenAddress(poolAddr) + ', ' + chainAPI.shortenAddress(token) + ')')(async function () {
      var poolId = chainAPI._getPoolId(poolAddr);
      if (poolId === -1) throw new Error('Pool not found in factory');
      var pdas = chainAPI.getPdas(poolAddr);
      var wpk = pubkey(solWalletKey);
      var config = await fetchPoolConfig(pdas.config.toString());
      var state = await fetchPoolState(poolAddr);
      var tokenIdx = 0;
      for (var i = 0; i < state.factors; i++) {
        if (state.tokens[i].toString() === token) { tokenIdx = i; break; }
      }
      var vaultAta = await getAta(token, pdas.authority);
      var dstAta = await getAta(token, config.promoterFund);
      return await solProgram.methods
        .claimPromoterRoyalty(new solAnchor.BN(poolId), tokenIdx)
        .accounts({
          admin: wpk,
          pool: pubkey(poolAddr),
          config: pdas.config,
          authority: pdas.authority,
          tokenProgram: pubkey(TOKEN_PROGRAM_ID),
        })
        .remainingAccounts([
          { pubkey: vaultAta, isSigner: false, isWritable: true },
          { pubkey: dstAta, isSigner: false, isWritable: true },
        ])
        .rpc();
    });
  },

  getAdminState: async function (poolAddr) {
    return traceCall('getAdminState(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      var pdas = chainAPI.getPdas(poolAddr);
      if (!pdas.config) throw new Error('Pool not found in factory');
      var config = await fetchPoolConfig(pdas.config.toString());
      return {
        factory: pdas.factory ? pdas.factory.toString() : null,
        founder: config.founder.toString(),
        founderFund: config.founderFund.toString(),
        promoter: config.promoter.toString(),
        promoterFund: config.promoterFund.toString(),
      };
    });
  },

  getFounderRoyalties: async function (poolAddr) {
    return traceCall('getFounderRoyalties(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      try {
        var state = await fetchPoolState(poolAddr);
        var tokens = [];
        var amounts = [];
        if (state.founderRoyalties) {
          for (var i = 0; i < state.founderRoyalties.length; i++) {
            var token = state.tokens[i];
            if (token) { tokens.push(token.toString()); amounts.push(BigInt(state.founderRoyalties[i].toString())); }
          }
        }
        return { tokens: tokens, amounts: amounts };
      } catch (_) { return { tokens: [], amounts: [] }; }
    });
  },

  getPromoterRoyalties: async function (poolAddr) {
    return traceCall('getPromoterRoyalties(' + chainAPI.shortenAddress(poolAddr) + ')')(async function () {
      try {
        var state = await fetchPoolState(poolAddr);
        var tokens = [];
        var amounts = [];
        if (state.promoterRoyalties) {
          for (var i = 0; i < state.promoterRoyalties.length; i++) {
            var token = state.tokens[i];
            if (token) { tokens.push(token.toString()); amounts.push(BigInt(state.promoterRoyalties[i].toString())); }
          }
        }
        return { tokens: tokens, amounts: amounts };
      } catch (_) { return { tokens: [], amounts: [] }; }
    });
  },

  getFounderRoyalty: async function (poolAddr, token) {
    try {
      var state = await fetchPoolState(poolAddr);
      if (!state.founderRoyalties) return 0n;
      for (var i = 0; i < state.tokens.length; i++) {
        if (state.tokens[i].toString() === token) return BigInt(state.founderRoyalties[i].toString());
      }
    } catch (_) {}
    return 0n;
  },

  getPromoterRoyalty: async function (poolAddr, token) {
    try {
      var state = await fetchPoolState(poolAddr);
      if (!state.promoterRoyalties) return 0n;
      for (var i = 0; i < state.tokens.length; i++) {
        if (state.tokens[i].toString() === token) return BigInt(state.promoterRoyalties[i].toString());
      }
    } catch (_) {}
    return 0n;
  },

  isValidAddress: function (addr) {
    if (!addr || typeof addr !== 'string') return false;
    try {
      new solWeb3.PublicKey(addr);
      return true;
    } catch (_) {
      return false;
    }
  },

  shortenAddress: function (addr) {
    if (!addr || typeof addr !== 'string') return '\u2014';
    if (addr.length <= 10) return addr;
    return addr.slice(0, 6) + '\u2026' + addr.slice(-4);
  },

  async getBlock() {
    const height = await solConnection.getBlockHeight();
    return { currentBlock: height };
  },

  async getLastTxBlock(poolAddr) {
    const sigs = await solConnection.getSignaturesForAddress(
      new solWeb3.PublicKey(poolAddr),
      { limit: 1 }
    );
    if (!sigs || sigs.length === 0) return null;
    const tx = await solConnection.getTransaction(sigs[0].signature, { commitment: 'confirmed' });
    return tx ? Number(tx.slot) : Number(sigs[0].slot);
  },

  async getNonce(poolAddr) {
    const state = await fetchPoolState(poolAddr);
    return Number(state.transactions);
  },
});

window.chainAPI_solana = chainAPI;

})();
