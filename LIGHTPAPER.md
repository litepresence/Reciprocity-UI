# Contents

1. Protocol Narrative — the story, use cases, and architecture
2. Protocol Specification — formulas, constants, operations
3. Theory — overflow bounds, convergence, error budgets
4. Exploit Analysis — attack vectors and closure proofs
5. Gas Cost Analysis — fees across all 15 chains
6. Error Code Registry — universal error codes
7. Admin Architecture — fee splits, roles, factory
8. TVWAP Oracle — time-weighted oracles
9. Token Provenance — genesis anchor, apostolic chain
10. Bytecode Sizes & Deployment — chain constraints
11. MAX_TOKENS Analysis — per-port limits
12. Glossary — terms, constants, errors
# PROTOCOL NARRATIVE — Executive Summary

**Status**: Production — v1.0, May 2026.

---

## The Problem

Existing AMMs cannot distinguish a fair swap from a predatory one. Fees are static — the same 1% whether a swap is perfectly proportional or maximally imbalanced. LPs bear the cost of adverse selection. Fee adjustment requires governance votes, hooks, or manual intervention — introducing latency and attack surface.

## The Answer

Reciprocity is a self-governing liquidity pool for 2–8 assets. It measures swap fairness on every trade through a pairwise deviation function called **aequitas**. Fees adjust dynamically — proportional to the harm a swap causes — through a spread governor system. All parameters adjust atomically within each swap. No oracle. No governance. No external inputs.

## Single Value Stream for LPs

| Stream | Source | When |
|--------|--------|------|
| **Swap fees** | Compounded into pool for all LPs | Every swap |

## Core Mechanisms (Intuitive Guide)

| Mechanism | Analogy |
|-----------|---------|
| **Genesis normalization** | Stock returns from IPO price — K measures proportional growth from birth |
| **Aequitas spread** | Taxi meter that ticks faster on rough roads — imbalanced swaps pay more |
| **Spread governor** | Dual controller — ATR adjusts multiplier based on volatility, EMA adjusts additive based on average spread level |
| **TVWAP oracle** | Flight recorder — every swap writes a data point, no one can fake history |

## Extensions

1. **Weighted invariant**: Value-proportional portfolio targeting (80/20 BTC/ETH). Balancer-equivalent pricing with Reciprocity-equivalent fairness.
2. **Unit-fraction fee modulation**: Soft directional incentives — fee modifier proportional to deviation from target composition.

## Comparison to Balancer

Reciprocity shares Balancer's geometric mean foundation but adds genesis normalization, aequitas fairness, governance-free feedback, TVWAP oracle, and proportional full exit protection. Weighted variant is Balancer-equivalent for pricing + Reciprocity-equivalent for fairness.

## Example Fees Across Pool States

| Pool State | Reciprocity Fee | Balancer (1% pool) |
|-----------|----------------|-------------------|
| Perfectly balanced | ~0.25% | 1.00% |
| Minor imbalance | ~0.35% | 1.00% |
| Moderate imbalance | ~0.80% | 1.00% |
| Heavy imbalance | ~2.50% | 1.00% |
| Extreme imbalance | ~4.50% | 1.00% |

## Deployment

15 blockchain ports, all sharing identical function names, constants, and fee model. Single smart contract — no dependencies beyond the LP token.

---

*See `docs/whitepaper/narrative.md` for full whitepaper.*
*Created: 2026-05-31*
# PROTOCOL SPECIFICATION — Executive Summary

**Status**: Production — implementation reference for all 15 ports.

---

## Invariant (The Konstant)

Genesis-normalized geometric mean:
```
K = s × ∏ⁿᵢ₌₁ (bᵢ / gᵢ)^(1/n)
```
Homogeneous of degree 1. At genesis, K = s. Weighted variant: `K = s × ∏ⁿᵢ₌₁ (bᵢ / gᵢ)^(wᵢ / Σw)`.

Computed via Path A (direct nth root) for base, or Path B (Padé log-sum-exp) for weighted variant and overflow fallback. `_initialized` is NEVER reset on full exit — tokens and weights are immutable after first init.

## Aequitas (Fairness)

Pairwise deviation of normalized balance ratios produces `spread ∈ [1, BASIS+1]`:
- spread ≈ 0 → perfectly proportional (near-zero fee)
- spread ≈ BASIS → maximally imbalanced (maximal fee)

Weighted aequitas scales pairwise differences by `wⱼ` with denominator `Σw × n`.

## Fee Computation

```
spread = max(1, aequitas × spread_multiplier / BASIS + spread_additive), no cap

Dual EMA+ATR governor: ATR→multiplier, EMA→additive. No fee cap.

## Spread Governor

| Trigger | ATR Effect | EMA Effect |
|---------|-----------|------------|
| spread volatility > ATR_SPREAD_TARGET | spread_multiplier decays by 100 bps (SPREAD_STEP) | — |
| spread volatility < ATR_SPREAD_TARGET | spread_multiplier grows by 100 bps (SPREAD_STEP) | — |
| avg spread > EMA_SPREAD_TARGET | — | spread_additive decrements by 1 |
| avg spread < EMA_SPREAD_TARGET | — | spread_additive increments by 1 |
| Dual convergence | spread_multiplier → equilibrium | spread_additive → equilibrium |

## Pool Operations

- **Initialize**: Set tokens, amounts, weights. Compute scale. Mint LP shares.
- **Swap**: User provides amountsIn/Out. Compute spread → fees → reciprocity. LP shares minted or burned.
- **Add Liquidity**: Deposit all tokens proportionally. After full exit, re-inits genesis.
- **Remove Liquidity**: Proportional withdrawal. Full exit on `shares ≥ supply` sweeps all tokens (zero dust).

## Accounting Invariants

`_supply = konstant(balances)`. `_initialized` NEVER reset on full exit.

## Key Constants

| Constant | Value |
|----------|-------|
| `BASIS` | 10,000 |
| `PRECISION` | 1,000,000 |
| `MAX_TOKENS` | 8 (varies per port) |
| `MAX_SUM_WEIGHTS` | 100 |
| `ATR_SPREAD_TARGET` | 10 (0.1%) |
| `EMA_SPREAD_TARGET` | 50 (0.5%) |
| `ATR_PERIOD` | 100 |
| `EMA_PERIOD` | 500 |
| `MAX_SPREAD_TARGET` | 100 (1%) |
| `SCALE_BUFFER` | 4 |
| `SPREAD_STEP` | 100 (1%) |

---

*See `docs/whitepaper/spec.md` for full specification.*
*Created: 2026-05-31*
# PROTOCOL THEORY — Executive Summary

**Status**: Production — all proofs, bounds, and convergence verified (AUDIT_4, AUDIT_5).

---

## Overflow Safety

Every arithmetic path in the weighted variant with `MAX_TOKENS = 8` and `MAX_SUM_WEIGHTS = 100` has a safety margin exceeding **20 orders of magnitude**. At n=32, the margin is still 61 orders on the widest path (`sumLn`). Overflow is not reachable for any realistic input.

## Padé Approximation Error

The weighted konstant uses log-sum-exp with two Padé [1/1] approximants:

- **ln**: `2 × BASIS × (r − BASIS) / (r + BASIS)` — Padé [1/1] at r=BASIS
- **exp**: `(2 × BASIS + avg) / (2 × BASIS − avg)` — Padé [1/1] at x=0

The Padé pair is exact for uniform ratios (zero K error at any deviation). For mixed ratios:

| Single-token deviation | K Error (Padé) |
|------------------------|---------------|
| Equilibrium (1.0×) | 0% |
| 1.5× | ~0.1% |
| 2.0× | ~0.6% |
| 5.0× | ~6% |

For practical pool operation (ratios within ±50% of genesis), the Padé K error is ≤0.1%.

## Convergence

The pool converges to correct equilibrium because: swap pricing is user-provided (not K-derived), fees are K-independent (raw balance ratios), and at equilibrium the approximation is exact (all ln_i = 0). Every rebalancing swap that moves ratios toward 1 reduces the error.

## Aequitas Spread Bounds

avg_err ∈ [0, BASIS/n] for ALL weight distributions — weight-independent bound. The Σw cancels in the error_i formula. The resulting spread bound is spread ∈ [1, 1 + BASIS × (2n-1)/n²] (minimum 1 bps). For n=8: 1 + BASIS × 15/64 ≈ 23.45%.

## Fee Properties

Proportional formula `fee_rate = spread × spread_multiplier / BASIS + spread_additive`, no cap. Dual EMA+ATR governor: ATR→multiplier, EMA→additive. Ceiling division ensures the protocol never collects less than the formula dictates.

## Drain Safety

Last-exit sweep: `shares ≥ supply` → LP receives ALL tokens, zero dust. `_initialized` remains TRUE — re-init goes through `add_liquidity(supply==0)`, preserving tokens and weights. Front-running resistant: only holder of ALL supply triggers drain.

## Truncation Bias

7 truncation points in the swap path: 3 favor pool, 3 favor traders, 1 is sign-dependent. Net bias slightly favors the pool. Total drift after 10⁹ swaps is < 10⁻¹² of pool value — economically negligible.

## Independent Audit Verification (AUDIT_5)

| Claim | Verdict |
|-------|---------|
| Overflow bounds (>20 orders) | ✅ Confirmed |
| Padé error bounds (≤1% at 2×, 0% uniform) | ✅ Confirmed |
| Weighted aequitas bound (BASIS/n) | ✅ Confirmed |
| Equilibrium convergence | ✅ Confirmed |
| Thermostat stability | ✅ Confirmed |
| Drain safety | ✅ Confirmed |
| Truncation bias | ✅ Confirmed |
| All A10 implementation bugs | ✅ All 5 fixed |

---

*See `docs/whitepaper/theory.md` for full analysis.*
*Created: 2026-05-31*
# EXPLOIT ANALYSIS — Executive Summary

**Status**: Production — all 10 implementation bugs confirmed fixed across Audits 1–5.

---

## Economic Attacks — All Blocked

| Attack | Defense |
|--------|---------|
| **Sandwich fee manipulation** | Attacker pays spread-based fees on both front-run and back-run trades (≥1.42% of swap). Profit < fees. |
| **K approximation exploit** | K error is conservative (K_approx < K_true). Cost to reach 10× imbalance ≥30% of TVL. Gain < cost. |
| **Flash loan + TVWAP** | dt = 0 within a single block — accumulators cannot change. Multi-block requires paying fees every block. |
| **Grief via full exit** | Attacker bears 100% capital cost each cycle. Gas costs exceed any possible gain. |

## Weight & Math — All Bounded

Weight re-init impossible (`_initialized` NEVER reset). Zero-weight rejected. SUM_WEIGHTS=100 enforced. Padé approximation error ≤1% at 2× (≤0.1% in practice). Truncation errors < 10⁻³² per swap. Overflow margins > 39 orders of magnitude.

## Reentrancy — CEI Verified

All 15 ports: state updates before token transfers. LP token has no callbacks. ERC-777 hooks see post-swap state. Direct token donations are off-protocol.

## Admin — LP Principal Protected

Admin functions: claim accumulated fees (founder/promoter split), redirect fee claim addresses. No function can drain LP principal or change pool identity. **Residual risk**: key compromise enables theft of unclaimed fees (not LP principal). Mitigated by multisig or DAO.

## Implementation Bugs — All Fixed

| Bug | Port | Severity | Status |
|-----|------|----------|--------|
| Wrong ratio denominator | Solana | Critical | ✅ CONFIRMED |
| Saturating overflow | Soroban | Critical | ✅ CONFIRMED |
| Aequitas weight divergence | Cosmos | High | ✅ CONFIRMED |
| CEI order | Solidity | Low | ✅ CONFIRMED |
| NEAR stale admin fields | NEAR | High | ✅ CONFIRMED |
| 4 more (clone guards, vars, getters) | 6 ports | Med/Critical | ✅ CONFIRMED |

---

*See `docs/whitepaper/exploits.md` for full analysis.*
*Created: 2026-05-31*
# GAS COST ANALYSIS — Executive Summary

**Status**: Production — all 15 chain ports profiled; prices from CoinMarketCap (May 29, 2026).

---

## Dominant Cost: Aequitas O(n²)

| n (tokens) | Pairwise comparisons | Relative cost (n=2 baseline) |
|------------|---------------------|-----------------------------|
| 2 | 4 | 1× |
| 4 | 16 | 4× |
| 8 | 64 | 16× |
| 16 | 256 | 64× |
| 32 | 1,024 | 256× |

## Cheapest Chains for 8-Token Swap (USD)

| Rank | Chain | Cost | 
|------|-------|------|
| 1 | Aleo | $0.000054 |
| 2 | Flow | $0.000088 |
| 3 | NEAR | $0.000181 |
| 4 | Solana | $0.00041 |
| 5 | Algorand | $0.000702 |
| 6 | Sui | $0.00139 |
| 7 | Polkadot | $0.00390 |
| 8 | Soroban | $0.00403 |
| 9 | Aptos | $0.0113 |
| 10 | TON | $0.02506 |
| 11 | Avalanche | $0.11 |
| 12 | BitShares | $0.295 |
| 13 | Ethereum | $1.02 |
| 14 | Cairo (StarkNet) | $1.02 |
| 15 | Cosmos | $1.21 |

## Operation Costs (8-Token, USD)

| Chain | Swap | Add Liq | Remove Liq |
|-------|------|---------|------------|
| Ethereum | $1.02 | $0.61 | $0.81 |
| Solana | $0.00041 | $0.00027 | $0.00033 |
| Sui | $0.00139 | $0.00074 | $0.00093 |
| NEAR | $0.000181 | $0.000116 | $0.000142 |
| Flow | $0.000088 | $0.000057 | $0.000069 |

## 32-Token Pool Feasibility

Viable only on near-zero gas chains (Flow, NEAR, Aleo). Ethereum at n=32 costs $36.67/swap. Even Solana at n=32 costs $0.027/swap — 100× more than n=2.

## Deployment Costs

| Chain | Pool + Factory | 
|-------|---------------|
| Ethereum | ~$87.00 |
| Solana | ~$0.027 |
| Sui | ~$0.020 |
| NEAR | ~$0.013 |
| Flow | ~$0.003 |

## MAX_TOKENS by Binding Constraint

Per-port MAX_TOKENS values are defined in `docs/whitepaper/max_tokens.md`. The table below shows the gas-theoretical upper bounds for each chain — actual deployed MAX_TOKENS reflects the binding constraint (bytecode, architecture, or circuit depth), not the gas ceiling.

| Port | Gas-Theoretical Max | Binding Constraint |
|------|:-------------------:|--------------------|
| Solidity | 8 | Code architecture (fixed arrays) |
| Solana | 499 | Packet size (1,232 bytes) |
| Sui | 253 | Type system / object size |
| NEAR | 719 | Contract size / storage |
| Flow | 1,026 | Contract size (Cadence) |
| Avalanche | 28 | EVM bytecode size (24 KB limit) |
| Aleo | 8 | ZK circuit depth |

---

*See `docs/whitepaper/max_tokens.md` for deployed MAX_TOKENS values. See `docs/whitepaper/gas.md` for gas analysis.*
*Created: 2026-05-31*
# ERROR CODE REGISTRY — Executive Summary

All 15 Reciprocity ports share a universal error code registry. Codes map to
canonical names, agent exit codes, and repair suggestions.

## Code Groups

| Range | Group | Agent Action |
|-------|-------|-------------|
| 1–19 | Genesis & Factory | Exit 2 — redeploy or fix config |
| 20–39 | Core Operations | Exit 1 — fix contract source |
| 40–49 | TVWAP Oracle | Exit 1 — verify consult() behavior |
| 50–69 | Admin & Access | Exit 3 — check wallet/role config |
| 70–79 | Drain & State Safety | Exit 1 — fix invariant logic |
| 100+ | Port-Specific | Group-dependent |

## Key Error Codes

| Code | Name | Trigger |
|------|------|---------|
| 1 | AlreadyInitialized | Re-init blocked |
| 2 | NotInitialized | Pool not ready |
| 8 | ZeroAddress | Bad address parameter |
| 20 | InvalidOrder | Malformed swap order |
| 21 | SlippageExceeded | Output below minimum |
| 24 | Overflow | Arithmetic overflow |
| 29 | NegativeReciprocity | Post-swap K < pre-swap K |
| 40 | ConsultInvalid | TVWAP window has no data |
| 50 | NotFounder | Caller not founder |
| 51 | NotPromoter | Caller not promoter |
| 57 | DeadlineExpired | Transaction past deadline |

## Ports Where Codes Are Blocked

Algorand (TEAL v8) and Aleo (Leo/ZK) cannot surface error codes on-chain.
Codes are reserved for documentation and tooling parity.
# ADMIN ARCHITECTURE — Executive Summary

**Status**: Production spec (v9) — on-chain implementation complete across all ports.

---

## Core Principle

**"The pool is math, not policy."** The pool is a mathematical primitive that computes swap rates, collects fees, and distributes liquidity shares. It does not know what tokens it holds. Corporate actions are the token issuer's responsibility.

## Fee Architecture

| Stakeholder | Royalty | Purpose |
|-------------|---------|---------|
| **Founder** | 2.5% (250 bps) | Protocol maintenance |
| **Promoter** | 2.5% (250 bps) | Pool operation |
| **LP holders** | 95% | Liquidity provision |

Fees are accumulated per-token in three separate buckets (founder, promoter, LP). LP share is reinjected into the pool as supply growth. Royalties are hard-coded at 250 bps each; no settable royalty functions exist.

## Admin Roles

Two independent roles:

- **Founder**: Controls founder address, founder_fund address
- **Promoter**: Controls promoter address, promoter_fund address

Royalties are hard-coded at 250 bps each (2.5%). No settable royalty or lock functions exist. Ownership transfer and fund addresses always remain mutable.

## Factory Architecture

Factory stores founder configuration and deploys all pools. Key properties:

- **Non-upgradeable** — replaced if needed
- **Brick enforcement** — pool constructor validates `msg.sender == factory`; direct deployment reverts
- **Inheritance at deploy time** — pools inherit founder, founder_fund, founder_royalty from factory
- **Per-pool mutability** — all parameters mutable post-deploy per-pool via admin functions

## Full Exit Behavior

Royalty percentages, fund addresses, and unclaimed fees persist across full exit. TVWAP accumulators reset independently (see TVWAP spec).

## Key Hardcoded Constants

| Constant | Value |
|----------|-------|
| `MAX_SPREAD_TARGET` | 100 (1%) |
| `SCALE_BUFFER` | 4 |
| `SPREAD_STEP` | 100 (1%) |
| `ATR_SPREAD_TARGET` | 10 (0.1%) |
| `EMA_SPREAD_TARGET` | 50 (0.5%) |
| `ATR_PERIOD` | 100 |
| `EMA_PERIOD` | 500 |
| `BASIS` | 10000 |

## Deployment

Factory stores `founder`, `founder_fund`. `founder_fund` defaults to `founder` address from factory. `promoter` set at deploy time (default: deployer). Royalties are hard-coded at 250 bps each.

---

*See `docs/whitepaper/admin.md` for full specification.*
*Created: 2026-05-31*
# TVWAP ORACLE — Executive Summary

**Status**: Production spec — all 15 ports audited; Solidity reference implementation confirmed.

---

## Purpose

Precomputed, 3-window, volume-weighted TVWAP (Time & Volume Weighted Average Price) oracle for the Reciprocity protocol. Provides a manipulation-resistant price feed for external consumers (UI, downstream protocols, oracle integrators). **Not** a circuit breaker — read-only, zero quant at query time.

## Windows

Three hardcoded windows — always on, no promoter configuration:

| Window | Seconds | Use Case |
|--------|---------|----------|
| **15m** | 900 | Intraday trading, medium-term oracles |
| **1hr** | 3600 | UI display, standard oracles, lending protocols |
| **24hr** | 86400 | Daily reporting, long-term oracles |

## Volume Weighting

Time-only averaging gives equal weight to a $1 swap and a $10M swap. Volume weighting uses stake-equivalent impact (`abs(postK_stake - preK) × BASIS / preK`) to weight by economic significance. This resists manipulation by tiny swaps.

## Accumulation

On every state-mutating operation (swap, add_liquidity, remove_liquidity):

```
product = delta × BASIS × dt    // pre-scaled, shared across all windows
acc_k[window] += product        // = preK × volume × dt
acc_w[window] += product / preK // = volume × dt
tvwap[window] = acc_k / acc_w  // precomputed on write
```

### Guards
- **`dt == 0`** — same-block operations contribute nothing (flash loan resistance)
- **`preK == 0`** — drained pool skips accumulation
- **`delta == 0`** — no K change = no volume to accumulate

## State

13 state variables (13 × 32 = 416 bytes) across 3 windows: `acc_k`, `acc_w`, `tvwap`, `window_start` per window, plus `last_timestamp`.

## Consult (Pure Data Lookup)

| `secondsAgo` | Returns |
|--------------|---------|
| `0` | Spot K (`_supply`) |
| `900` | Precomputed 15m TVWAP, or reverts if no data (ConsultInvalid) |
| `3600` | Precomputed 1hr TVWAP, or reverts if no data (ConsultInvalid) |
| `86400` | Precomputed 24hr TVWAP, or reverts if no data (ConsultInvalid) |
| Any other | Reverts `InvalidPeriod` |

Zero quant. Pure storage read. TVWAP persists as historical value even without recent swaps.

## Drain Safety

All three drain paths (swap, addLiquidity re-init, removeLiquidity) call `_resetTvwapState()` — all 13 vars to 0. Fresh accumulation begins post-reinit. No stale pre-drain data contamination.

## Manipulation Resistance

| Attack | Resistance |
|--------|-----------|
| Tiny swap to set TVWAP | Resisted (tiny volume) |
| Large swap to move TVWAP | Resisted (proportional cost) |
| Flash loan sandwich | Resisted (dt=0 within block) |
| Multi-block manipulation | Resisted (must maintain position, pays fees) |

---

*See `docs/whitepaper/tvwap.md` for full specification.*
*Created: 2026-05-31*
# APOSTOLIC CHAIN — Executive Summary

**Status**: v1.0 — spec complete.

---

## Problem

A factory that allows permissionless pool creation enables deployers to create pools between unverified fake tokens. Users may mistake these for legitimate deployments.

## Solution

Every pool traces its lineage back to a genesis pool with battle-tested tokens through shared token links.

## How It Works

1. **Genesis anchor** (mainnet): First pool must use WETH + WBTC + USDC (or chain equivalents). On testnets, founder picks any tokens.
2. **Known tokens registry**: Factory tracks every token used in any pool.
3. **Provenance check**: Every subsequent pool must share ≥1 token with an existing pool.

```
Mainnet (Ethereum):
  Genesis: WETH + WBTC + USDC     ← hardcoded, guaranteed real
  Pool #2: WETH + FakeToken        ← linked via WETH
  Pool #3: FakeToken + AnotherFake ← linked via FakeToken
  Pool #4: IsolatedFake + Scam     ← rejected (no known token)

Testnet (Sepolia, Fuji, etc.):
  Pool #1: MockA + MockB           ← founder picks any tokens
  Pool #2: MockA + MockC           ← linked via MockA
  Pool #3: MockD + MockE           ← rejected (no known token)
```

## Security Properties

- Genesis pool is always real tokens (hardcoded, immutable)
- No pool can be an island (provenance check enforced)
- Every pool is at most 1 hop from a real token
- No admin override (genesis tokens are `immutable`)

## Gas Cost

~900 gas overhead on `deploy_pool`. Negligible for deployment transactions.

## Limitation

Provenance guarantees connectivity, not quality. Pool #2 can include a fake token linked via a real token. Users must still verify token legitimacy.

---

*See `docs/whitepaper/provenance.md` for full specification.*
*Created: 2026-05-31*
# BYTECODE SIZES & DEPLOYMENT — Executive Summary

**Status**: Production — all 15 smart contract ports compiled and measured.

---

## Bytecode Sizes

Smallest: **Solana** (6.5 KB BPF), **TON** (17.6 KB BOC), **Sui** (18.9 KB Move). Largest: **Cairo** (795 KB CASM), **Aleo** (326 KB Leo). All EVM ports fit under the 24 KB EIP-170 limit — but Avalanche (98%) and Solidity (96%) have thin margins (514 B and 1,003 B respectively). WASM ports (NEAR 365 KB, Cosmos 276 KB, Polkadot 136 KB) all well within their chain limits. Soroban pool at 59.1 KB (90% of 64 KB), factory at 17.3 KB after 2026-06-02 dependency removal fix.

## Chain Compatibility

All ports fit within target chain limits — the tightest margin is 514 B (Avalanche pool, 98%):

| Chain | Limit | Largest Port | Utilization |
|-------|-------|-------------|:-----------:|
| Ethereum L1 | 24 KB | Solidity (23.0 KB) | 96% |
| Avalanche C-Chain | 24 KB | Avalanche (23.5 KB) | 98% |
| Solana | 123 KB | Solana (6.5 KB) | 5% |
| TON | 128 KB | TON (17.6 KB) | 13% |
| NEAR | 4 MB | NEAR (365 KB) | 9% |
| Soroban | 64 KB | Soroban (59.1 KB) | 90% |

## Storage Model

Per-token state scales linearly with n. No port exceeds 9% of its chain's storage limit at MAX_TOKENS. Storage is never the binding constraint — gas cost (dynamic-array ports) or code architecture (fixed-array ports) always binds first.

## Binding Constraints

| Constraint Type | Ports | MAX_TOKENS |
|-----------------|-------|:----------:|
| Gas cost (<$1/swap) | Solana, Sui, NEAR, Flow, TON, Aptos, Algorand, Soroban, Polkadot | 28–1,026 |
| Bytecode size (EIP-170) | Avalanche | 28 |
| Code architecture (fixed arrays) | Solidity, Cosmos, Cairo, BitShares | 8 |
| Code + ZK circuit depth | Aleo | 8 |

Avalanche is bytecode-bounded — the only port where EIP-170 (24 KB) is the binding constraint. Gas allows 28 tokens, and the contract was restructured in Cycle 55 to stay within the 24 KB limit (see `docs/whitepaper/max_tokens.md` §3.2). All other ports have at least 90% headroom on their chain's storage limit.

---

*See `docs/whitepaper/bytes.md` for full analysis.*
*Created: 2026-05-31*
# MAX TOKENS ANALYSIS — Executive Summary

Two-tier model: *theoretical max* (platform physical limit) and *deployed max*
(production cap, at most 100 tokens by policy).

## Port-by-Port Deployed Maxes

| Port | Deployed Max | Binding Constraint |
|------|:------------:|--------------------|
| Solidity | 8 | Gas cost |
| Avalanche | 28 | Gas cost (C-Chain cheap) |
| Solana | 13 | Tx packet size (1,232 B) |
| Sui | 100 | Policy cap (gas allows 253) |
| Aptos | 89 | Gas cost |
| NEAR | 100 | Policy cap (u8 factors caps at 255) |
| Polkadot | 100 | Policy cap (gas allows 149) |
| Flow | 100 | Policy cap (UInt8 factors caps at 255) |
| Cosmos | 8 | Gas cost |
| Cairo | 8 | Step limit |
| TON | 12 | Gas optimization (gas allows 60) |
| Algorand | 8 | Inner txn limit (max 16) |
| Aleo | 8 | ZK circuit depth + code architecture |
| Soroban | 100 | Policy cap (gas allows 188) |
| BitShares | 8 | Committee governance |

## Policy Cap

Six ports (Sui, NEAR, Polkadot, Flow, Algorand, Soroban) have theoretical maxes
above 100. A uniform 100-token cap provides consistency, auditability, and
practical headroom — few portfolios exceed 20–30 assets. Ports with theoretical
maxes below 100 are unaffected.
# GLOSSARY — Executive Summary

**Status**: Production — cross-referenced with all whitepapers.

---

## Core Protocol Terms

| Term | Definition |
|------|------------|
| **Aequitas** | Fairness function computing `spread` from pairwise deviation of genesis-normalized ratios. Higher spread = more imbalanced = higher fee. |
| **BASIS** | Fixed-point denominator: 10,000 = 1.0. All fees, spread, ratios in BASIS units. |
| **Full Exit** | Last LP exits: all balances → 0, supply → 0. `_initialized` preserved. Re-init via `add_liquidity(supply==0)`. |
| **Spread** | Aequitas output in [1, BASIS+1]. 1 = perfectly balanced, BASIS+1 = maximally imbalanced swap. |
| **Konstant (K)** | Genesis-normalized geometric mean invariant. Always equals total LP supply. `K = s × ∏ (bᵢ/gᵢ)^(1/n)`. |
| **Reciprocity** | Net LP share change from a swap: `reciprocity = shares_in + postK - preK`. |
| **Scale (s)** | Dynamic precision factor: `10^(digits(max_genesis) + SCALE_BUFFER)`. |
| **Spread Multiplier** | ATR-adjusted fee multiplier. Adjusted ±SPREAD_STEP (100 bps) per swap based on spread volatility relative to ATR_SPREAD_TARGET. |
| **Spread Additive** | EMA-adjusted fee additive. Adjusted ±1 per swap based on average spread relative to EMA_SPREAD_TARGET. |
| **TVWAP** | Time & Volume Weighted Average K. 3 hardcoded windows (15m, 1hr, 24hr). `consult(secondsAgo)` — zero-quant data lookup. |

## Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `BASIS` | 10,000 | 100% = 10,000 bps |
| `SCALE_BUFFER` | 4 | Extra decimal digits in K baseline |
| `SPREAD_STEP` | 100 (1%) | Spread governor adjustment step |
| `MAX_SPREAD_TARGET` | 100 (1%) | Maximum allowed spread target for both ATR and EMA governors |
| `MAX_SUM_WEIGHTS` | 100 | Total sum cap for weights |
| `MAX_TOKENS` | Per-port (see docs/whitepaper/max_tokens.md) | Pool asset limit |
| `ATR_SPREAD_TARGET` | 10 (0.1%) | ATR target spread for spread governor |
| `EMA_SPREAD_TARGET` | 50 (0.5%) | EMA target spread for spread governor |
| `ATR_PERIOD` | 100 | ATR period for spread governor |
| `EMA_PERIOD` | 500 | EMA period for spread governor |
| `TVWAP_15M` | 900 | 15-minute window |
| `TVWAP_1HR` | 3600 | 1-hour window |
| `TVWAP_24HR` | 86400 | 24-hour window |

## TVWAP State (13 Variables)

Per-window: `_accK`, `_accW`, `_tvwap`, `_windowStart` × 3 windows + `_lastTimestamp` = 13 state vars, 416 bytes total. Replaces old 3-var TWAP (`cumulative_k`, `cumulative_k_prev`, `last_timestamp`).

## Key Invariant Properties

- `_supply = konstant(balances)` — supply always matches K
- `_initialized` NEVER reset on full exit

---

*See `docs/whitepaper/glossary.md` for complete definitions (terms, constants, state, math functions, events, errors).*
*Created: 2026-05-31*
