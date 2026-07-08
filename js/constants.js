// SPDX-License-Identifier: MIT
var BASIS = 10000;
// SPREAD_TARGET removed in INTEGER2 — use ATR_SPREAD_TARGET/EMA_SPREAD_TARGET
var MAX_SPREAD_TARGET = 100;
var SPREAD_STEP = 100;
var CACHE_TTL_MS = 30000;
var TVWAP_WINDOWS = [900, 3600, 86400];

var SCALE = 1000000000000000000n;
var PRECISION = 1000000;
var EMA_PERIOD = 500;
var ATR_SPREAD_TARGET = 10;
var EMA_SPREAD_TARGET = 50;
var ATR_PERIOD = 100;
var SCALE_BUFFER = 4;
var MAX_TOKENS = 8;
var ALPHA_DENOM = 1_000_000n;
var NODE_COLORS = [
  '#3dcf8e', '#2d7cf0', '#d4a040', '#e85858', '#a855f7',
  '#06b6d4', '#f97316', '#ec4899',
];
var LP_NODE_COLOR = '#2d7cf0';
var DEFAULT_DEADLINE_SECONDS = 1800; // 30 minutes

const ERROR_CODES = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "NoFactory",
  4: "GenesisRequired",
  5: "NoKnownToken",
  6: "DuplicateToken",
  7: "InvalidToken",
  8: "ZeroAddress",
  9: "InvalidWeights",
  10: "WeightsSumExceeded",
  11: "Unauthorized",
  20: "InvalidOrder",
  21: "SlippageExceeded",
  22: "InsufficientShares",
  23: "InsufficientBalance",
  24: "Overflow",
  25: "ComputeLimit",
  26: "DivByZero",
  27: "LPSyncDrift",
  28: "PoolDrained",
  29: "NegativeReciprocity",
  30: "ZeroAmount",
  40: "ConsultInvalid",
  41: "InvalidPeriod",
  50: "NotFounder",
  51: "NotPromoter",
   52: "NothingToClaim",
   53: "PoolFullExit",
   54: "SpreadTargetOutOfRange",
   55: "DeadlineExpired",
   // 56–69: Reserved for future admin errors
  100: "AVAXTransferFailed",
  101: "AVAXNotAllowed",
  102: "AVAXAmountMismatch",
  103: "Renounced",
  104: "FactoryRequired",
  105: "TokenNotInPool",
  106: "PendingWithdrawalExists",
  107: "NoPendingWithdrawal",
  108: "InvalidTokenIndex",
  109: "StateMismatch",
  110: "InvalidFee",
};

