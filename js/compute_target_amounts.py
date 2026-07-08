"""Pure Python port of computeTargetAmounts() from core.js.

Estimates received output amounts given slider percentages and give amounts,
using cached TVWAP/spot prices. No on-chain calls, no DOM — pure integer math.

Mirrors ui/js/core.js lines 319–405. See AGENTS.md for canonical ref.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# ── Constants ────────────────────────────────────────────────────────────────

SCALE = 1_000_000_000_000_000_000   # 10^18 — fixed-point precision
BASIS = 10_000                       # basis points denominator (100%)


# ── Data Model ───────────────────────────────────────────────────────────────

@dataclass
class Token:
    """A single token in the pool."""
    sym: str          # lowercase symbol, e.g. "usdc"
    addr: str         # lowercase contract address
    dec: int          # decimal places, e.g. 6 for USDC


@dataclass
class PoolCache:
    """Cached on-chain pool state (mirrors JS state.poolCache)."""
    tvwap_k: Optional[int] = None      # TVWAP invariant K (None = not loaded)
    supply: Optional[int] = None       # total LP shares outstanding
    balances: dict[str, int] = field(default_factory=dict)   # addr → raw amount
    prices: dict[str, int] = field(default_factory=dict)     # addr → TVWAP price


@dataclass
class State:
    """Aggregate pool + token metadata (mirrors JS state)."""
    tokens: list[Token] = field(default_factory=list)
    token_map: dict[str, Token] = field(default_factory=dict)
    all_syms: list[str] = field(default_factory=list)   # includes "lp"
    lp_decimals: int = 18
    pool_cache: PoolCache = field(default_factory=PoolCache)


@dataclass
class EstimateResult:
    """Output of compute_target_amounts()."""
    amounts: dict[str, int]           # sym → raw amount (0 = nothing)
    display: dict[str, str]           # sym → formatted string ("" = nothing)
    total_give_value: int             # total give-side value in base-token terms
    mode: str                         # "swap" | "withdraw" | "deposit"


# ── Helpers ──────────────────────────────────────────────────────────────────

def spot_price(sym: str, tokens: list[Token],
               token_map: dict[str, Token],
               balances: dict[str, int]) -> int:
    """Price of *sym* in terms of the first (base) token.

    Uses the pool balance ratio:  base_bal * SCALE / bal.
    Returns SCALE (1:1) when data is missing.
    Mirrors JS ``_spotPrice()`` at core.js:86–95.
    """
    t = token_map.get(sym)
    if t is None:
        return SCALE
    bal = balances.get(t.addr, 0)
    if bal <= 0:
        return SCALE
    base_addr = tokens[0].addr if tokens else None
    base_bal = balances.get(base_addr, 0) if base_addr else 0
    if base_bal <= 0:
        return SCALE
    # How much base you get for 1 sym
    return base_bal * SCALE // bal


def detect_mode(give: dict[str, int], lp_give: int,
                slider_pcts: dict[str, float]) -> str:
    """Determine operation mode from give/receive state.

    Mirrors JS ``getMode()`` at core.js:104–132 (simplified — omits logging).
    """
    has_token_give = any(v > 0 for v in give.values())
    any_recv = any(p > 0 for p in slider_pcts.values())

    if lp_give > 0 and not has_token_give:
        return "withdraw" if not any_recv else "swap"
    if has_token_give and any_recv:
        return "swap"
    return "deposit"


def fmt_amount(val: int, dec: int) -> str:
    """Format a raw integer amount as a human-readable string.

    Mirrors JS ``fmt()`` at core.js:26–50.
    """
    if val == 0:
        return ""

    divisor = 10 ** dec
    whole = abs(val) // divisor
    frac = abs(val) % divisor

    if whole > 0:
        # Show up to 8 fractional digits, strip trailing zeros
        frac_str = str(frac).zfill(dec)[:8].rstrip("0")
        return f"{whole:,}{'.' + frac_str if frac_str else ''}"

    # Small number (< 1): show first 6 significant figures
    frac_str = str(frac).zfill(dec)
    start = 0
    while start < len(frac_str) and frac_str[start] == "0":
        start += 1
    sig = frac_str[start:start + 6].rstrip("0")
    if not sig:
        return "0"
    return f"0.{'0' * start}{sig}"


# ── Main Estimation ──────────────────────────────────────────────────────────

def compute_target_amounts(
    give: dict[str, int],
    lp_give: int,
    slider_pcts: dict[str, float],
    state: State,
) -> Optional[EstimateResult]:
    """Estimate receive amounts from give amounts + slider percentages.

    This is the instant-feedback layer — uses cached TVWAP/pool-balance
    data for immediate estimates (no on-chain calls).  The JS counterpart
    (``computeTargetAmounts()`` at core.js:319–405) writes directly to DOM;
    this pure function returns an ``EstimateResult`` instead.

    Parameters
    ----------
    give : dict[str, int]
        Token symbol → raw amount being given.  Missing or zero means "not
        giving this token".
    lp_give : int
        Raw amount of LP shares being given.  0 = none.
    slider_pcts : dict[str, float]
        Token symbol → receive-side slider percentage (0–100).  ``"lp"`` is
        always present.  Missing syms are treated as 0 %.
    state : State
        Pool metadata and cached on-chain state.

    Returns
    -------
    EstimateResult or None
        ``None`` when TVWAP data is unavailable.  Otherwise an
        ``EstimateResult`` with raw amounts, display strings, and metadata.
    """
    cache = state.pool_cache

    # ── Guard: TVWAP data must be loaded ─────────────────────────────────
    if cache.tvwap_k is None:
        return None

    # ── Sum give-side value in base-token (first token) terms ────────────
    total_token_give = 0
    give_map: dict[str, int] = {}
    for sym, g in give.items():
        if g and g > 0:
            give_map[sym] = g
            price = spot_price(sym, state.tokens, state.token_map,
                               cache.balances)
            total_token_give += g * price // SCALE

    # ── Withdraw mode: LP → pro-rata tokens ──────────────────────────────
    mode = detect_mode(give, lp_give, slider_pcts)
    if mode == "withdraw":
        total_lp = cache.supply
        amounts: dict[str, int] = {}
        display: dict[str, str] = {}
        if total_lp and total_lp > 0:
            for s in state.all_syms:
                if s == "lp":
                    amounts[s] = 0
                    display[s] = ""
                    continue
                t = state.token_map.get(s)
                bal = cache.balances.get(t.addr, 0) if t else 0
                recv_amt = bal * lp_give // total_lp
                amounts[s] = recv_amt
                dec = t.dec if t else state.lp_decimals
                display[s] = fmt_amount(recv_amt, dec) if recv_amt > 0 else ""
        else:
            for s in state.all_syms:
                amounts[s] = 0
                display[s] = ""

        return EstimateResult(
            amounts=amounts,
            display=display,
            total_give_value=total_token_give,
            mode=mode,
        )

    # ── Compute pool value (all token balances valued in base terms) ────
    pool_value = 0
    supply = cache.supply
    if supply and supply > 0:
        for t in state.tokens:
            bal = cache.balances.get(t.addr, 0)
            if bal > 0:
                p = spot_price(t.sym, state.tokens, state.token_map,
                               cache.balances)
                pool_value += bal * p // SCALE

    # ── Total give value (tokens + LP) ──────────────────────────────────
    total_give_value = total_token_give
    if lp_give and lp_give > 0 and supply and supply > 0 and pool_value > 0:
        total_give_value += lp_give * pool_value // supply

    # ── Zero-value guard ────────────────────────────────────────────────
    if total_give_value == 0:
        amounts = {}
        display = {}
        for s in state.all_syms:
            amounts[s] = 0
            display[s] = ""
        return EstimateResult(
            amounts=amounts,
            display=display,
            total_give_value=0,
            mode=mode,
        )

    # ── Per-asset receive estimation ────────────────────────────────────
    amounts = {}
    display = {}

    for s in state.all_syms:
        pct = slider_pcts.get(s, 0.0)
        if pct <= 0:
            amounts[s] = 0
            display[s] = ""
            continue

        # target_value = total_give_value * pct / 100 %
        # JS: BigInt(Math.round(pct * 100)) — pct is 0-100, so pct*100 is 0-10000
        target_value = total_give_value * int(round(pct * 100)) // BASIS

        if s == "lp":
            lp_amt = target_value
            if supply and supply > 0 and pool_value > 0:
                lp_amt = target_value * supply // pool_value
            amounts[s] = lp_amt
            display[s] = fmt_amount(lp_amt, state.lp_decimals) if lp_amt > 0 else ""
        else:
            t = state.token_map.get(s)
            if t is None:
                amounts[s] = 0
                display[s] = ""
                continue
            price = spot_price(s, state.tokens, state.token_map, cache.balances)
            target_amt = target_value * SCALE // price
            amounts[s] = target_amt
            display[s] = fmt_amount(target_amt, t.dec) if target_amt > 0 else ""

    return EstimateResult(
        amounts=amounts,
        display=display,
        total_give_value=total_give_value,
        mode=mode,
    )


# ── Self-Test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Build a 3-token USDC / WETH / WBTC pool example
    usdc = Token(sym="usdc", addr="0xusdc", dec=6)
    weth = Token(sym="weth", addr="0xweth", dec=18)
    wbtc = Token(sym="wbtc", addr="0xwbtc", dec=8)

    tokens = [usdc, weth, wbtc]
    token_map = {t.sym: t for t in tokens}
    all_syms = [t.sym for t in tokens] + ["lp"]

    cache = PoolCache(
        tvwap_k=123456789,
        supply=1_000_000 * SCALE,       # 1M LP shares
        balances={
            usdc.addr: 2_000_000 * SCALE // SCALE,       # 2M USDC (6 dec → raw)
            weth.addr: 1_000 * SCALE,                    # 1K WETH
            wbtc.addr: 100 * 10 ** 8,                     # 100 WBTC
        },
    )

    state = State(
        tokens=tokens,
        token_map=token_map,
        all_syms=all_syms,
        lp_decimals=18,
        pool_cache=cache,
    )

    # ── Scenario 1: Swap 10 WETH → USDC + WBTC ─────────────────────────
    print("=== Scenario 1: Swap 10 WETH → USDC (60%) + WBTC (40%) ===")
    result = compute_target_amounts(
        give={"weth": 10 * 10 ** 18},
        lp_give=0,
        slider_pcts={"usdc": 60.0, "weth": 0.0, "wbtc": 40.0, "lp": 0.0},
        state=state,
    )
    if result:
        print(f"  Mode: {result.mode}")
        print(f"  Total give value: {result.total_give_value}")
        for s in all_syms:
            amt = result.amounts.get(s, 0)
            disp = result.display.get(s, "")
            if amt > 0:
                print(f"  Receive {s}: raw={amt}  display='{disp}'")
    print()

    # ── Scenario 2: Withdraw 100K LP (all tokens pro-rata) ─────────────
    print("=== Scenario 2: Withdraw 100K LP → all tokens pro-rata ===")
    result = compute_target_amounts(
        give={},
        lp_give=100_000 * SCALE,   # 100K LP shares
        slider_pcts={"usdc": 0.0, "weth": 0.0, "wbtc": 0.0, "lp": 0.0},
        state=state,
    )
    if result:
        print(f"  Mode: {result.mode}")
        for s in all_syms:
            if s == "lp":
                continue
            amt = result.amounts.get(s, 0)
            disp = result.display.get(s, "")
            if amt > 0:
                print(f"  Receive {s}: raw={amt}  display='{disp}'")
    print()

    # ── Scenario 3: No give → empty result ─────────────────────────────
    print("=== Scenario 3: No give (zero guard) ===")
    result = compute_target_amounts(
        give={"usdc": 0},
        lp_give=0,
        slider_pcts={"usdc": 100.0, "weth": 0.0, "wbtc": 0.0, "lp": 0.0},
        state=state,
    )
    if result:
        print(f"  Mode: {result.mode}")
        print(f"  Total give value: {result.total_give_value}")
        print(f"  Amounts: {result.amounts}")
    print()

    # ── Scenario 4: TVWAP not loaded → None ────────────────────────────
    print("=== Scenario 4: TVWAP not loaded (None guard) ===")
    empty_state = State(pool_cache=PoolCache(tvwap_k=None))
    result = compute_target_amounts(
        give={"weth": 10 * 10 ** 18},
        lp_give=0,
        slider_pcts={"usdc": 100.0},
        state=empty_state,
    )
    print(f"  Result: {result}")
    print()

    # ── Scenario 5: LP token receive ───────────────────────────────────
    print("=== Scenario 5: Swap 10 WETH → receive LP shares ===")
    result = compute_target_amounts(
        give={"weth": 10 * 10 ** 18},
        lp_give=0,
        slider_pcts={"usdc": 0.0, "weth": 0.0, "wbtc": 0.0, "lp": 100.0},
        state=state,
    )
    if result:
        print(f"  Mode: {result.mode}")
        print(f"  Total give value: {result.total_give_value}")
        lp_amt = result.amounts.get("lp", 0)
        lp_disp = result.display.get("lp", "")
        print(f"  Receive lp: raw={lp_amt}  display='{lp_disp}'")
