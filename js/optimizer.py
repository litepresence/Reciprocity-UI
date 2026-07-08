"""Pure Python port of the on-chain swap optimizer (optimizer.js).

Finds optimal receive amounts given an order and a quote callback by running:
  D1 — Pure LP (no token receives)
  D2 — Pure tokens, LP slider = 0% (binary searches, dust redistribution)
  D3 — Mixed LP + tokens (secant root-finding on alpha scale factor)

Each D2 binary-search strategy and the D3 secant search is extracted as
a standalone function for testability and readability.  The quote callback
abstracts the on-chain contract call so this module has no blockchain deps.

Mirrors optimizer.js lines 1–795 (originally core.js:184–1221).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional


# ── Constants ────────────────────────────────────────────────────────────────

SCALE = 1_000_000_000_000_000_000   # 10^18 fixed-point precision
ALPHA_DENOM = 1_000_000
LP_TOLERANCE = 1                     # permyriad tolerance for LP % (0.01%)


# ── Data Model ───────────────────────────────────────────────────────────────

@dataclass
class Token:
    sym: str
    addr: str
    dec: int


@dataclass
class Order:
    tokens_in: list[str] = field(default_factory=list)
    amounts_in: list[int] = field(default_factory=list)
    tokens_out: list[str] = field(default_factory=list)
    amounts_out: list[int] = field(default_factory=list)
    shares_in: int = 0
    min_shares_out: int = 0


@dataclass
class QuoteResult:
    tokens_out: list[str] = field(default_factory=list)
    amounts_out: list[int] = field(default_factory=list)
    reciprocity: int = -1
    net_tokens: list[str] = field(default_factory=list)
    net_amounts: list[int] = field(default_factory=list)


@dataclass
class QuoteCallResult:
    quote: Optional[QuoteResult] = None
    reciprocity: int = -1
    time_ms: str = "0"


@dataclass
class OptimizerResult:
    order: Optional[Order] = None
    quote: Optional[QuoteResult] = None
    reciprocity: int = -1
    converged: bool = False
    iterations: list[dict] = field(default_factory=list)
    alpha: int = ALPHA_DENOM
    alpha_pct: int = 10000
    lp_target: int = 0
    fan_rounds: int = 0
    would_revert: bool = False
    reason: str = ""


# ── Pure Helpers ─────────────────────────────────────────────────────────────

def net_overlapping_tokens(order: Order) -> Order:
    t_in = list(order.tokens_in)
    a_in = list(order.amounts_in)
    t_out = list(order.tokens_out)
    a_out = list(order.amounts_out)

    i = len(t_in) - 1
    while i >= 0:
        addr = t_in[i].lower()
        try:
            out_i = next(j for j, a in enumerate(t_out) if a.lower() == addr)
        except StopIteration:
            i -= 1
            continue

        if a_out[out_i] <= 0:
            t_out.pop(out_i)
            a_out.pop(out_i)
        elif a_in[i] <= 0:
            t_in.pop(i)
            a_in.pop(i)
        elif a_in[i] > a_out[out_i]:
            a_in[i] -= a_out[out_i]
            t_out.pop(out_i)
            a_out.pop(out_i)
        elif a_out[out_i] > a_in[i]:
            a_out[out_i] -= a_in[i]
            t_in.pop(i)
            a_in.pop(i)
        else:
            t_in.pop(i)
            a_in.pop(i)
            t_out.pop(out_i)
            a_out.pop(out_i)
        i -= 1

    return Order(tokens_in=t_in, amounts_in=a_in, tokens_out=t_out,
                 amounts_out=a_out, shares_in=order.shares_in,
                 min_shares_out=order.min_shares_out)


def scale_bigint_array(arr: list[int], factor: float) -> list[int]:
    return [v * int(round(factor * 1000)) // 1000 for v in arr]


def sym_by_addr_lookup(addr: str, tokens: list[Token],
                       lp_addr: str = "") -> Optional[str]:
    addr_lower = addr.lower()
    for t in tokens:
        if t.addr.lower() == addr_lower:
            return t.sym
    if lp_addr and addr_lower == lp_addr.lower():
        return "lp"
    return None


def spot_price(sym: str, tokens: list[Token],
               balances: dict[str, int]) -> int:
    t = next((t for t in tokens if t.sym == sym), None)
    if t is None:
        return SCALE
    bal = balances.get(t.addr.lower(), 0)
    if bal <= 0:
        return SCALE
    base_addr = tokens[0].addr.lower() if tokens else None
    base_bal = balances.get(base_addr, 0) if base_addr else 0
    if base_bal <= 0:
        return SCALE
    return base_bal * SCALE // bal


def pool_value(tokens: list[Token], balances: dict[str, int]) -> int:
    pv = 0
    for t in tokens:
        b = balances.get(t.addr.lower(), 0)
        if b > 0:
            p = spot_price(t.sym, tokens, balances)
            pv += b * p // SCALE
    return pv


def clamp_outs(amounts: list[int], max_token_addrs: list[str],
               balances: dict[str, int],
               tokens_in: list[str], amounts_in: list[int]) -> list[int]:
    result = []
    for i, a in enumerate(amounts):
        addr = max_token_addrs[i].lower()
        pool_bal = balances.get(addr, 0)
        try:
            idx = next(j for j, t in enumerate(tokens_in) if t.lower() == addr)
            input_amt = amounts_in[idx]
        except StopIteration:
            input_amt = 0
        cap = pool_bal + input_amt
        result.append(min(a, cap))
    return result


def target_amt(total_out_val: int, ratio: float, price: int) -> int:
    return (total_out_val * int(round(ratio * 100000)) // 100000
            * SCALE // price if price > 0 else 0)


# ── Quote Wrapper ────────────────────────────────────────────────────────────

def quote_with_netting(inner_order: Order,
                       quote_fn: Callable[[Order], QuoteCallResult],
                       ) -> QuoteCallResult:
    orig_tokens = list(inner_order.tokens_out)
    orig_amounts = list(inner_order.amounts_out)
    netted = net_overlapping_tokens(inner_order)
    q = quote_fn(netted)

    target = q.quote if q.quote is not None else q
    q_tokens = target.tokens_out or []
    q_amounts = target.amounts_out or []
    give_addrs = {t.lower() for t in (inner_order.tokens_in or [])}
    restored_tokens = list(q_tokens)
    restored_amounts = list(q_amounts)

    for i, addr in enumerate(orig_tokens):
        addr_lower = addr.lower()
        try:
            in_contract = next(
                j for j, t in enumerate(q_tokens) if t.lower() == addr_lower
            )
        except StopIteration:
            in_contract = -1
        if addr_lower in give_addrs and in_contract >= 0:
            restored_amounts[in_contract] = orig_amounts[i]
        elif in_contract < 0:
            restored_tokens.append(orig_tokens[i])
            restored_amounts.append(orig_amounts[i])

    target.net_tokens = list(q_tokens)
    target.net_amounts = list(q_amounts)
    target.tokens_out = restored_tokens
    target.amounts_out = restored_amounts

    sd = q.reciprocity if q.reciprocity is not None else (q.quote.reciprocity if q.quote else None)
    return QuoteCallResult(quote=q, reciprocity=sd)


# ── LP % Computation ─────────────────────────────────────────────────────────

def compute_lp_pct(
    shares_delta: int,
    amounts_out: list[int],
    shares_in: int,
    tokens_out: list[str],
    max_token_addrs: list[str],
    tokens: list[Token],
    balances: dict[str, int],
    supply: int,
    slider_pcts: dict[str, float],
    give_tokens_in: list[str],
    recv_amounts: dict[str, int],
) -> float:
    """LP percentage of total output value, in permyriad (0–10000).

    This is the objective function ``f(α)`` for the secant root-finder.
    """
    amt_map: dict[str, int] = {}
    map_tokens = tokens_out or max_token_addrs
    for j, a in enumerate(map_tokens):
        amt_map[a.lower()] = amounts_out[j] if j < len(amounts_out) else 0

    tv = 0
    for j, addr in enumerate(max_token_addrs):
        sym = sym_by_addr_lookup(addr, tokens) or "?"
        price = spot_price(sym, tokens, balances)
        tv += (amt_map.get(addr.lower(), 0)) * price // SCALE

    for t in tokens:
        sym = t.sym
        pct = slider_pcts.get(sym, 0.0)
        if pct > 0 and any(a.lower() == t.addr.lower() for a in give_tokens_in):
            in_tokens_out = any(
                a.lower() == t.addr.lower()
                for a in (tokens_out or max_token_addrs)
            )
            if not in_tokens_out:
                r_amt = recv_amounts.get(sym, 0)
                if r_amt > 0:
                    price = spot_price(sym, tokens, balances)
                    tv += r_amt * price // SCALE

    pv = pool_value(tokens, balances)
    total_supply = supply or 1
    if (shares_in or 0) > 0 and shares_delta > (shares_in or 0):
        lp_amt = shares_delta - shares_in
    else:
        lp_amt = shares_delta
    sd_value = lp_amt * pv // total_supply if total_supply > 0 else 0
    total = sd_value + tv
    if total <= 0 or sd_value <= 0:
        return 0.0
    return sd_value * 10000.0 / total


# ── Base Amount Computation ──────────────────────────────────────────────────

def compute_base_token_amounts(
    tokens: list[Token],
    token_map: dict[str, Token],
    balances: dict[str, int],
    supply: int,
    give_amounts: dict[str, int],
    lp_give: int,
    token_syms: list[str],
    pct_by_idx: list[float],
) -> list[int]:
    total_give_val = 0
    for t in tokens:
        g = give_amounts.get(t.sym, 0)
        if g and g > 0:
            total_give_val += g * spot_price(t.sym, tokens, balances) // SCALE

    if lp_give and lp_give > 0 and supply and supply > 0:
        pv = pool_value(tokens, balances)
        total_give_val += lp_give * pv // supply

    base = []
    for i, sym in enumerate(token_syms):
        price = spot_price(sym, tokens, balances)
        target_val = total_give_val * int(round(pct_by_idx[i] * 100)) // 10000
        amt = (target_val * SCALE // price) if price > 0 else 0
        base.append(amt if amt > 0 else 1)
    return base


# ── Net & Rebalance ──────────────────────────────────────────────────────────

def net_and_rebalance(
    order: Order,
    amts_out: list[int],
    min_shares: int,
    max_token_addrs: list[str],
    quote_fn: Callable[[Order], QuoteCallResult],
) -> tuple[Order, bool, int]:
    pre_net = Order(tokens_in=order.tokens_in, amounts_in=order.amounts_in,
                    tokens_out=max_token_addrs, amounts_out=amts_out,
                    shares_in=order.shares_in, min_shares_out=min_shares)
    netted = net_overlapping_tokens(pre_net)

    overlapping = len(netted.tokens_in) < len(order.tokens_in)
    if not overlapping:
        for i, a in enumerate(netted.amounts_in):
            oi = next((j for j, t in enumerate(order.tokens_in)
                       if t.lower() == netted.tokens_in[i].lower()), None)
            if oi is not None and a != order.amounts_in[oi]:
                overlapping = True
                break
    if not overlapping:
        return netted, False, -1

    nq = quote_with_netting(netted, quote_fn)
    if nq.quote is None or nq.reciprocity >= 0:
        return netted, False, nq.reciprocity

    lo, hi = 1000, 10000
    best, best_sd = 10000, nq.reciprocity
    for _ in range(12):
        mid = (lo + hi) >> 1
        scaled = [a * mid // 10000 for a in amts_out]
        test_netted = net_overlapping_tokens(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=scaled,
            shares_in=order.shares_in, min_shares_out=min_shares))
        sq = quote_with_netting(test_netted, quote_fn)
        if sq.quote is not None and sq.reciprocity >= 0:
            if best_sd < 0 or sq.reciprocity < best_sd:
                best, best_sd = mid, sq.reciprocity
            lo = mid + 1
        else:
            hi = mid - 1

    if best_sd >= 0:
        scaled_amts = [a * best // 10000 for a in amts_out]
        reb_order = net_overlapping_tokens(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=scaled_amts,
            shares_in=order.shares_in, min_shares_out=min_shares))
        return reb_order, True, best_sd
    return netted, False, nq.reciprocity


# ── D2 Search Strategies ─────────────────────────────────────────────────────

def redistribute_dust(
    clamped: list[int], r: QuoteCallResult,
    base_token_amounts: list[int], max_token_addrs: list[str],
    tokens: list[Token], balances: dict[str, int], supply: int,
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> tuple[list[int], QuoteCallResult]:
    pv = pool_value(tokens, balances)
    dust_val = r.reciprocity * pv // (supply or 1)
    if dust_val <= 0:
        return clamped, r

    total_out_val = 0
    out_vals = []
    for j, addr in enumerate(max_token_addrs):
        sym = sym_by_addr_lookup(addr, tokens) or "?"
        price = spot_price(sym, tokens, balances)
        v = int(clamped[j]) * price // SCALE
        out_vals.append(v)
        total_out_val += v
    if total_out_val <= 0:
        return clamped, r

    adjusted = []
    for j, a in enumerate(clamped):
        sym = sym_by_addr_lookup(max_token_addrs[j], tokens) or "?"
        price = spot_price(sym, tokens, balances)
        extra = out_vals[j] * dust_val // total_out_val
        adjusted.append(a + (extra * SCALE // price if extra > 0 else 0))

    clamped2 = clamp_outs(adjusted, max_token_addrs, balances,
                          order.tokens_in, order.amounts_in)
    r2 = quote_with_netting(Order(
        tokens_in=order.tokens_in, amounts_in=order.amounts_in,
        tokens_out=max_token_addrs, amounts_out=clamped2,
        shares_in=order.shares_in), quote_fn)
    if r2.quote is not None:
        iterations.append({"iter": len(iterations), "reciprocity": r2.reciprocity,
                           "amounts": {}, "label": "D2: dust adj"})
        return clamped2, r2
    return clamped, r


def scale_up_search(
    clamped: list[int], r: QuoteCallResult,
    base_token_amounts: list[int], max_token_addrs: list[str],
    balances: dict[str, int],
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> tuple[list[int], QuoteCallResult]:
    lo, hi = 1.0, 5.0
    best_r, best_sd, best_amts = r, r.reciprocity, clamped
    for _ in range(8):
        mid = (lo + hi) / 2.0
        scaled = clamp_outs(
            [a * int(round(mid * 1000)) // 1000 if a != 0 else 0
             for a in base_token_amounts],
            max_token_addrs, balances, order.tokens_in, order.amounts_in)
        test_r = quote_with_netting(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=scaled,
            shares_in=order.shares_in), quote_fn)
        if test_r.quote is not None:
            if test_r.reciprocity >= 0 and test_r.reciprocity < best_sd:
                best_sd, best_r, best_amts = test_r.reciprocity, test_r, scaled
            if test_r.reciprocity > 0:
                lo = mid
            else:
                hi = mid
        else:
            hi = mid
    if best_sd < r.reciprocity:
        iterations.append({"iter": len(iterations), "reciprocity": best_sd,
                           "amounts": {}, "label": "D2: dust bs"})
        return best_amts, best_r
    return clamped, r


def scale_down_search(
    clamped: list[int], r: QuoteCallResult,
    base_token_amounts: list[int], max_token_addrs: list[str],
    balances: dict[str, int],
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> tuple[list[int], QuoteCallResult]:
    lo, hi = 0, 9999
    best_r, best_sd, best_amts = r, r.reciprocity, clamped
    for _ in range(14):
        mid = (lo + hi) >> 1
        scaled = clamp_outs(
            [a * mid // 10000 for a in base_token_amounts],
            max_token_addrs, balances, order.tokens_in, order.amounts_in)
        test_r = quote_with_netting(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=scaled,
            shares_in=order.shares_in), quote_fn)
        if test_r.quote is not None and test_r.reciprocity >= 0:
            if test_r.reciprocity < best_sd:
                best_sd, best_r, best_amts = test_r.reciprocity, test_r, scaled
            lo = mid + 1
        else:
            hi = mid - 1

    if best_sd < r.reciprocity:
        iterations.append({"iter": len(iterations), "reciprocity": best_sd,
                           "amounts": {}, "label": "D2: scale down"})
        return best_amts, best_r

    if order.shares_in > 0 and len(order.tokens_in) == 0:
        fine_amts = clamp_outs(
            [a * 9999 // 10000 for a in base_token_amounts],
            max_token_addrs, balances, order.tokens_in, order.amounts_in)
        fine_r = quote_with_netting(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=fine_amts,
            shares_in=order.shares_in), quote_fn)
        if (fine_r.quote is not None and fine_r.reciprocity >= 0
                and fine_r.reciprocity < best_sd):
            iterations.append({"iter": len(iterations), "reciprocity": fine_r.reciprocity,
                               "amounts": {}, "label": "D2: fine scale"})
            return fine_amts, fine_r

    return clamped, r


def extended_scale_up(
    clamped: list[int], r: QuoteCallResult,
    base_token_amounts: list[int], max_token_addrs: list[str],
    balances: dict[str, int],
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> tuple[list[int], QuoteCallResult]:
    max_factor = 100
    for j, addr in enumerate(max_token_addrs):
        bal = balances.get(addr.lower(), 0)
        give_amt = (order.amounts_in or [])[j] if j < len(order.amounts_in) else 0
        cap = bal + give_amt
        base = base_token_amounts[j]
        if base > 0:
            tf = int(cap * 100 // base)
            if tf < max_factor:
                max_factor = tf
    if max_factor < 100:
        max_factor = 100
    if max_factor <= 5:
        return clamped, r

    lo, hi = 1.0, float(max_factor)
    best_r, best_sd, best_amts = r, r.reciprocity, clamped
    for _ in range(20):
        mid = (lo + hi) / 2.0
        scaled = clamp_outs(
            [a * int(round(mid * 1000)) // 1000 if a != 0 else 0
             for a in base_token_amounts],
            max_token_addrs, balances, order.tokens_in, order.amounts_in)
        test_r = quote_with_netting(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=scaled,
            shares_in=order.shares_in), quote_fn)
        if test_r.quote is not None:
            if test_r.reciprocity >= 0 and test_r.reciprocity < best_sd:
                best_sd, best_r, best_amts = test_r.reciprocity, test_r, scaled
            if test_r.reciprocity > 0:
                lo = mid
            else:
                hi = mid
        else:
            hi = mid
    if best_sd < r.reciprocity:
        iterations.append({"iter": len(iterations), "reciprocity": best_sd,
                           "amounts": {}, "label": "D2: ext bs"})
        return best_amts, best_r
    return clamped, r


def per_token_search(
    clamped: list[int], r: QuoteCallResult,
    base_token_amounts: list[int], max_token_addrs: list[str],
    balances: dict[str, int],
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> tuple[list[int], QuoteCallResult]:
    best_r, best_sd, best_amts = r, r.reciprocity, list(clamped)
    for j, addr in enumerate(max_token_addrs):
        addr_lower = addr.lower()
        try:
            g_idx = next(k for k, t in enumerate(order.tokens_in)
                         if t.lower() == addr_lower)
        except StopIteration:
            continue
        g_amt = (order.amounts_in or [])[g_idx] or 0
        if g_amt <= 0 or clamped[j] <= g_amt:
            continue
        lo, hi = g_amt, clamped[j]
        for _ in range(20):
            mid = (lo + hi) >> 1
            test_amts = [int(a) for a in best_amts]
            test_amts[j] = mid
            test_r = quote_with_netting(Order(
                tokens_in=order.tokens_in, amounts_in=order.amounts_in,
                tokens_out=max_token_addrs, amounts_out=test_amts,
                shares_in=order.shares_in), quote_fn)
            if (test_r.quote is not None and test_r.reciprocity >= 0
                    and test_r.reciprocity < best_sd):
                best_sd, best_r, best_amts = test_r.reciprocity, test_r, test_amts
            if test_r.quote is None or test_r.reciprocity > 0:
                hi = mid
            else:
                lo = mid + 1
            if lo >= hi:
                break
    if best_sd < r.reciprocity:
        iterations.append({"iter": len(iterations), "reciprocity": best_sd,
                           "amounts": {}, "label": "D2: net bs"})
        return best_amts, best_r
    return clamped, r


def proportional_share(
    clamped: list[int], r: QuoteCallResult,
    max_token_addrs: list[str],
    balances: dict[str, int], supply: int,
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> tuple[list[int], QuoteCallResult]:
    if r.reciprocity <= 0 or order.shares_in <= 0 or len(order.tokens_in) != 0:
        return clamped, r
    sup = supply or 1
    prop_amts = clamp_outs(
        [balances.get(addr.lower(), 0) * order.shares_in // sup
         for addr in max_token_addrs],
        max_token_addrs, balances, order.tokens_in, order.amounts_in)
    test_r = quote_with_netting(Order(
        tokens_in=order.tokens_in, amounts_in=order.amounts_in,
        tokens_out=max_token_addrs, amounts_out=prop_amts,
        shares_in=order.shares_in), quote_fn)
    if test_r.quote is not None and test_r.reciprocity <= 0:
        iterations.append({"iter": len(iterations), "reciprocity": test_r.reciprocity,
                           "amounts": {}, "label": "D2: prop share"})
        return prop_amts, test_r
    return clamped, r


def scale_down_negative(
    clamped: list[int], r: QuoteCallResult,
    base_token_amounts: list[int], max_token_addrs: list[str],
    balances: dict[str, int],
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> tuple[list[int], QuoteCallResult, Optional[OptimizerResult]]:
    lo, hi = 0, 10000
    best_r, best_sd, best_amts = r, r.reciprocity, clamped
    for _ in range(16):
        mid = (lo + hi) >> 1
        scaled = clamp_outs(
            [a * mid // 10000 for a in base_token_amounts],
            max_token_addrs, balances, order.tokens_in, order.amounts_in)
        test_r = quote_with_netting(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=scaled,
            shares_in=order.shares_in), quote_fn)
        if test_r.quote is not None and test_r.reciprocity >= 0:
            if best_sd < 0 or test_r.reciprocity < best_sd:
                best_sd, best_r, best_amts = test_r.reciprocity, test_r, scaled
            lo = mid + 1
        else:
            hi = mid - 1

    if best_sd < 0:
        return clamped, r, OptimizerResult(
            would_revert=True, reason="Requested amounts exceed pool capacity.")
    iterations.append({"iter": len(iterations), "reciprocity": best_sd,
                       "amounts": {}, "label": "D2: scale down"})
    return best_amts, best_r, None


# ── Ratio Balancing ──────────────────────────────────────────────────────────

def ratio_balance(
    clamped: list[int], r: QuoteCallResult,
    max_token_addrs: list[str],
    token_ratios: list[float],
    tokens: list[Token], balances: dict[str, int],
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
    is_large_trade: bool,
) -> tuple[list[int], QuoteCallResult]:

    rb_limit = 2 if is_large_trade else 8
    for rb in range(rb_limit):
        out_vals = []
        total_out_val = 0
        for j, addr in enumerate(max_token_addrs):
            sym = sym_by_addr_lookup(addr, tokens) or "?"
            price = spot_price(sym, tokens, balances)
            v = int(clamped[j]) * price // SCALE
            out_vals.append(v)
            total_out_val += v
        if total_out_val <= 0:
            break

        max_dev = 0
        for j in range(len(max_token_addrs)):
            pct = out_vals[j] / total_out_val if total_out_val > 0 else 0
            max_dev = max(max_dev, abs(pct - token_ratios[j]))
        if max_dev < 0.005:
            break

        target = []
        for j, addr in enumerate(max_token_addrs):
            sym = sym_by_addr_lookup(addr, tokens) or "?"
            price = spot_price(sym, tokens, balances)
            target.append(target_amt(total_out_val, token_ratios[j], price))
        target = clamp_outs(target, max_token_addrs, balances,
                            order.tokens_in, order.amounts_in)

        new_total = 0
        for j, addr in enumerate(max_token_addrs):
            sym = sym_by_addr_lookup(addr, tokens) or "?"
            price = spot_price(sym, tokens, balances)
            new_total += int(target[j]) * price // SCALE
        if new_total > total_out_val:
            scale = total_out_val * 100000 // new_total
            target = [a * scale // 100000 for a in target]

        test_r = quote_with_netting(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=target,
            shares_in=order.shares_in), quote_fn)
        if test_r.quote is not None and test_r.reciprocity >= 0:
            iterations.append({"iter": len(iterations), "reciprocity": test_r.reciprocity,
                               "amounts": {}, "label": f"D2: ratio bal {rb}"})
            clamped, r = target, test_r
        else:
            break
    return clamped, r


# ── D2 Pure Tokens ───────────────────────────────────────────────────────────

def optimize_pure_tokens(
    order: Order,
    base_token_amounts: list[int],
    max_token_addrs: list[str],
    tokens: list[Token],
    balances: dict[str, int],
    supply: int,
    token_ratios: list[float],
    quote_fn: Callable[[Order], QuoteCallResult],
    iterations: list[dict],
) -> OptimizerResult:
    clamped = clamp_outs([int(a) for a in base_token_amounts],
                         max_token_addrs, balances,
                         order.tokens_in, order.amounts_in)
    r = quote_with_netting(Order(
        tokens_in=order.tokens_in, amounts_in=order.amounts_in,
        tokens_out=max_token_addrs, amounts_out=clamped,
        shares_in=order.shares_in), quote_fn)
    iterations.append({"iter": len(iterations), "reciprocity": r.reciprocity,
                       "amounts": {}, "label": "D2: pure tokens"})
    if r.quote is None:
        return OptimizerResult(
            would_revert=True, reason="Requested amounts exceed pool capacity.")

    # Positive reciprocity → LP minted, zero it out via search strategies
    if r.reciprocity > 0:
        clamped, r = redistribute_dust(
            clamped, r, base_token_amounts, max_token_addrs,
            tokens, balances, supply, order, quote_fn, iterations)
        clamped, r = scale_up_search(
            clamped, r, base_token_amounts, max_token_addrs,
            balances, order, quote_fn, iterations)
        clamped, r = scale_down_search(
            clamped, r, base_token_amounts, max_token_addrs,
            balances, order, quote_fn, iterations)
        clamped, r = extended_scale_up(
            clamped, r, base_token_amounts, max_token_addrs,
            balances, order, quote_fn, iterations)
        clamped, r = per_token_search(
            clamped, r, base_token_amounts, max_token_addrs,
            balances, order, quote_fn, iterations)
        clamped, r = proportional_share(
            clamped, r, max_token_addrs, balances, supply,
            order, quote_fn, iterations)

    # Negative reciprocity → scale down
    elif r.reciprocity < 0:
        clamped, r, err = scale_down_negative(
            clamped, r, base_token_amounts, max_token_addrs,
            balances, order, quote_fn, iterations)
        if err is not None:
            return err

    if r.reciprocity < 0:
        return OptimizerResult(
            would_revert=True,
            reason="Insufficient give value for requested receive ratios.")

    # Ratio balancing
    pre_r, pre_amts = r, list(clamped)

    is_large = (order.shares_in > (supply or 0) // 10
                or any(
                    (order.tokens_in or [])[i]
                    and (a or 0) > (balances.get(order.tokens_in[i].lower(), 0) * 2)
                    for i, a in enumerate(order.amounts_in or [])))
    clamped, r = ratio_balance(
        clamped, r, max_token_addrs, token_ratios, tokens, balances,
        order, quote_fn, iterations, is_large)

    # Revert if ratio balancing increased LP (LP=0% target)
    if r.reciprocity > pre_r.reciprocity:
        r, clamped = pre_r, pre_amts

    nr, nr_adj, nr_sd = net_and_rebalance(order, clamped, 0,
                                          max_token_addrs, quote_fn)
    return OptimizerResult(
        order=nr, quote=r.quote,
        reciprocity=nr_sd if nr_adj else r.reciprocity,
        converged=True, iterations=iterations, alpha=ALPHA_DENOM,
        alpha_pct=10000, lp_target=0, fan_rounds=0)


# ── D3 Secant Search State ───────────────────────────────────────────────────

@dataclass
class SecantState:
    """Mutable state tracked across secant evaluations."""
    best_quote: Optional[QuoteResult] = None
    best_sd: int = 0
    best_tokens: Optional[list[int]] = None
    best_error: float = float("inf")
    best_scale: float = 0.0
    converged: bool = False


# ── D3 Mixed LP + Tokens ─────────────────────────────────────────────────────

def secant_eval(
    alpha: float,
    base_token_amounts: list[int],
    max_token_addrs: list[str],
    tokens: list[Token], balances: dict[str, int], supply: int,
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    slider_pcts: dict[str, float],
    recv_amounts: dict[str, int],
    lp_pct_raw: int,
    state: SecantState,
    iterations: list[dict],
) -> tuple[float, QuoteCallResult]:
    clamped = clamp_outs(
        scale_bigint_array(base_token_amounts, alpha),
        max_token_addrs, balances, order.tokens_in, order.amounts_in)
    q = quote_with_netting(Order(
        tokens_in=order.tokens_in, amounts_in=order.amounts_in,
        tokens_out=max_token_addrs, amounts_out=clamped,
        shares_in=order.shares_in), quote_fn)
    lp = (compute_lp_pct(q.reciprocity, q.quote.amounts_out,
                         order.shares_in, q.quote.tokens_out,
                         max_token_addrs, tokens, balances, supply or 1,
                         slider_pcts,
                         [t.lower() for t in order.tokens_in],
                         recv_amounts)
           if q.quote else -10000.0)
    err = abs(lp - lp_pct_raw)
    if q.reciprocity < 0:
        err += 10000

    if err < state.best_error and q.quote:
        state.best_error = err
        state.best_quote = q.quote
        state.best_sd = q.reciprocity
        state.best_tokens = [int(a) for a in clamped]
        state.best_scale = alpha
        state.converged = err <= LP_TOLERANCE

    iterations.append({
        "iter": len(iterations), "reciprocity": q.reciprocity,
        "amounts": {},
        "label": f"α={alpha:.4f} LP={(lp / 10 if lp else 0):.1f}%",
    })
    return lp, q


def secant_search(
    base_token_amounts: list[int],
    max_token_addrs: list[str],
    tokens: list[Token], balances: dict[str, int], supply: int,
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    slider_pcts: dict[str, float],
    recv_amounts: dict[str, int],
    lp_pct_raw: int,
    d2_result: QuoteCallResult,
    q_zero_result: QuoteCallResult,
    lp_at_one: float,
    state: SecantState,
    iterations: list[dict],
) -> tuple[float, int]:
    """Secant root-finding: f(α) = LP%(α) - target.

    Returns (best_scale, fan_rounds).
    """
    a0, f0 = 0.0, 10000.0 - lp_pct_raw
    a1, f1 = 1.0, lp_at_one - lp_pct_raw
    fan_rounds = 0

    if f1 > 0:
        up = 2
        while up <= 64 and f1 > 0:
            f1_eval = secant_eval(
                float(up), base_token_amounts, max_token_addrs,
                tokens, balances, supply, order, quote_fn,
                slider_pcts, recv_amounts, lp_pct_raw,
                state, iterations)
            f1 = f1_eval[0] - lp_pct_raw
            a1 = float(up)
            fan_rounds += 1
            up *= 2

    stable_converged = False
    for _ in range(20):
        if stable_converged:
            break
        fan_rounds += 1
        f_diff = f1 - f0
        if f_diff == 0:
            a2 = (a0 + a1) / 2.0
        else:
            a2 = a1 - f1 * (a1 - a0) / f_diff
        a_lo, a_hi = min(a0, a1), max(a0, a1)
        if a2 <= a_lo or a2 >= a_hi:
            a2 = (a_lo + a_hi) / 2.0
        a2 = max(0.0001, min(100.0, a2))

        eval_result = secant_eval(
            a2, base_token_amounts, max_token_addrs,
            tokens, balances, supply, order, quote_fn,
            slider_pcts, recv_amounts, lp_pct_raw,
            state, iterations)
        f2 = eval_result[0] - lp_pct_raw

        if state.converged and state.best_error <= LP_TOLERANCE:
            stable_converged = True
        if f2 > 0:
            a0, f0 = a2, f2
        else:
            a1, f1 = a2, f2

    if not stable_converged and abs(a1 - a0) < 0.0005:
        state.converged = True

    return state.best_scale, fan_rounds


def ratio_balance_secant(
    state: SecantState,
    max_token_addrs: list[str],
    token_ratios: list[float],
    pct_by_idx: list[float],
    tokens: list[Token], balances: dict[str, int],
    supply: int,
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    slider_pcts: dict[str, float],
    recv_amounts: dict[str, int],
    lp_pct_raw: int,
    iterations: list[dict],
) -> None:
    """Post-secant ratio balancing. Mutates *state* in-place."""
    if not state.converged or not state.best_quote or len(pct_by_idx) <= 1:
        return

    best_tokens = [int(a) for a in (state.best_tokens or [])]
    rb_amts = list(best_tokens)
    if state.best_quote.amounts_out:
        rb_amts = []
        for i, addr in enumerate(max_token_addrs):
            try:
                idx = next(j for j, t in enumerate(state.best_quote.tokens_out)
                           if t.lower() == addr.lower())
                rb_amts.append(int(state.best_quote.amounts_out[idx]))
            except StopIteration:
                rb_amts.append(0)

    pv = pool_value(tokens, balances)
    sup = supply or 1

    for rb in range(8):
        out_vals = []
        total_out_val = 0
        for j, addr in enumerate(max_token_addrs):
            sym = sym_by_addr_lookup(addr, tokens) or "?"
            price = spot_price(sym, tokens, balances)
            v = int(rb_amts[j]) * price // SCALE
            out_vals.append(v)
            total_out_val += v
        if total_out_val <= 0:
            break

        max_dev = 0
        for j in range(len(max_token_addrs)):
            pct = out_vals[j] / total_out_val if total_out_val > 0 else 0
            max_dev = max(max_dev, abs(pct - token_ratios[j]))
        if max_dev < 0.005:
            break

        target = []
        for j, addr in enumerate(max_token_addrs):
            sym = sym_by_addr_lookup(addr, tokens) or "?"
            price = spot_price(sym, tokens, balances)
            target.append(target_amt(total_out_val, token_ratios[j], price))
        target = clamp_outs(target, max_token_addrs, balances,
                            order.tokens_in, order.amounts_in)

        new_total = 0
        new_out_vals = []
        for j, addr in enumerate(max_token_addrs):
            sym = sym_by_addr_lookup(addr, tokens) or "?"
            price = spot_price(sym, tokens, balances)
            v = int(target[j]) * price // SCALE
            new_out_vals.append(v)
            new_total += v
        if new_total > total_out_val:
            scale = total_out_val * 100000 // new_total
            target = [a * scale // 100000 for a in target]
            new_out_vals = [v * scale // 100000 for v in new_out_vals]
            new_total = total_out_val

        test_r = quote_with_netting(Order(
            tokens_in=order.tokens_in, amounts_in=order.amounts_in,
            tokens_out=max_token_addrs, amounts_out=target,
            shares_in=order.shares_in), quote_fn)
        if test_r.quote is None or test_r.reciprocity <= 0:
            break

        rb_lp = compute_lp_pct(
            test_r.reciprocity, test_r.quote.amounts_out,
            order.shares_in, test_r.quote.tokens_out,
            max_token_addrs, tokens, balances, sup,
            slider_pcts, [t.lower() for t in order.tokens_in], recv_amounts)
        rb_lp_error = abs(rb_lp - lp_pct_raw)
        sd_v = test_r.reciprocity * pv // sup if sup > 0 else 0
        rb_ratio_error = 0
        for j, _pct in enumerate(pct_by_idx):
            denom = new_total + sd_v
            pct = int(new_out_vals[j] * 10000 // denom) if denom > 0 else 0
            rb_ratio_error += abs(pct - round(pct_by_idx[j] * 100))

        if rb_lp_error + rb_ratio_error < state.best_error:
            state.best_error = rb_lp_error + rb_ratio_error
            state.best_quote = test_r.quote
            state.best_sd = test_r.reciprocity
            state.best_tokens = [int(a) for a in target]
            rb_amts = list(target)
            iterations.append({
                "iter": len(iterations), "reciprocity": test_r.reciprocity,
                "amounts": {}, "label": f"LP: ratio bal {rb}"})
        else:
            break


def outer_convergence(
    state: SecantState,
    max_token_addrs: list[str],
    pct_by_idx: list[float],
    tokens: list[Token], balances: dict[str, int],
    supply: int, lp_pct_raw: int, net_sd2: int,
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    all_syms: list[str], lp_decimals: int,
    give_amounts: dict[str, int], lp_give: int,
    slider_pcts: dict[str, float],
    recv_amounts: dict[str, int],
    iterations: list[dict],
    outer_iter: int,
) -> Optional[OptimizerResult]:
    """Check if output value distribution matches slider targets.

    If error > 5 permille and outer_iter < 5, rebase and restart optimiser.
    Returns an OptimizerResult if recursion is needed, or None to continue.
    """
    if not state.best_quote or not state.best_quote.tokens_out:
        return None

    amt_by_addr: dict[str, int] = {}
    for k, addr in enumerate(state.best_quote.tokens_out):
        amt_by_addr[addr.lower()] = int(state.best_quote.amounts_out[k] or 0)

    _t = 0
    _v: dict[str, int] = {}
    for j, addr in enumerate(max_token_addrs):
        sym = sym_by_addr_lookup(addr, tokens) or "?"
        amt = amt_by_addr.get(addr.lower(), 0)
        val = amt * spot_price(sym, tokens, balances) // SCALE
        _v[sym] = val
        _t += val

    _pool_val = pool_value(tokens, balances)
    _sup = supply or 1
    _lp_val = net_sd2 * _pool_val // _sup if _sup > 0 else 0
    _total_val = _t + _lp_val
    _max_err = 0
    for j, pct in enumerate(pct_by_idx):
        sym = sym_by_addr_lookup(max_token_addrs[j], tokens) or "?"
        apct = int((_v.get(sym, 0) or 0) * 10000 // _total_val) if _total_val > 0 else 0
        _max_err = max(_max_err, abs(apct - round(pct * 100)))
    _lp_apct = int(_lp_val * 10000 // _total_val) if _total_val > 0 else 0
    _max_err = max(_max_err, abs(_lp_apct - round(lp_pct_raw)))

    if _max_err <= 5 or outer_iter >= 5:
        return None

    new_base = []
    for j, addr in enumerate(max_token_addrs):
        sym = sym_by_addr_lookup(addr, tokens)
        if not sym:
            new_base.append(1)
            continue
        pct = slider_pcts.get(sym, 0.0)
        if pct <= 0:
            new_base.append(1)
            continue
        price = spot_price(sym, tokens, balances)
        target_val = _total_val * int(round(pct * 100)) // 10000
        amt = target_val * SCALE // price if price > 0 else 0
        new_base.append(amt if amt > 0 else 1)

    token_map = {t.sym: t for t in tokens}
    return optimize_swap(
        order, quote_fn,
        tokens, balances, supply, "",
        all_syms, lp_decimals,
        give_amounts, lp_give, slider_pcts, recv_amounts,
        precomputed_base=new_base, outer_iter=outer_iter + 1)


# ── D3 Mixed LP + Tokens ─────────────────────────────────────────────────────

def optimize_mixed_lp_tokens(
    order: Order,
    base_token_amounts: list[int],
    max_token_addrs: list[str],
    tokens: list[Token],
    balances: dict[str, int],
    supply: int,
    token_ratios: list[float],
    pct_by_idx: list[float],
    quote_fn: Callable[[Order], QuoteCallResult],
    slider_pcts: dict[str, float],
    recv_amounts: dict[str, int],
    lp_pct_raw: int,
    lp_decimals: int,
    all_syms: list[str],
    give_amounts: dict[str, int],
    lp_give: int,
    iterations: list[dict],
    outer_iter: int,
) -> OptimizerResult:
    # Quote at α=1 and α=0 to bracket the secant search
    d2_result = quote_with_netting(Order(
        tokens_in=order.tokens_in, amounts_in=order.amounts_in,
        tokens_out=max_token_addrs,
        amounts_out=clamp_outs([int(a) for a in base_token_amounts],
                               max_token_addrs, balances,
                               order.tokens_in, order.amounts_in),
        shares_in=order.shares_in), quote_fn)
    q_zero_result = quote_with_netting(Order(
        tokens_in=order.tokens_in, amounts_in=order.amounts_in,
        tokens_out=max_token_addrs,
        amounts_out=[0] * len(base_token_amounts),
        shares_in=order.shares_in), quote_fn)

    iterations.append({"iter": len(iterations), "reciprocity": d2_result.reciprocity,
                       "amounts": {}, "label": "D2: pure tokens"})
    iterations.append({"iter": len(iterations), "reciprocity": q_zero_result.reciprocity,
                       "amounts": {}, "label": "qZero: scale=0"})

    if d2_result.quote is None or d2_result.reciprocity < 0:
        return OptimizerResult(
            would_revert=True, reason="Requested amounts exceed pool capacity.")

    lp_at_one = compute_lp_pct(
        d2_result.reciprocity, d2_result.quote.amounts_out,
        order.shares_in, d2_result.quote.tokens_out,
        max_token_addrs, tokens, balances, supply or 1,
        slider_pcts, [t.lower() for t in order.tokens_in], recv_amounts)

    # Early exit if α=1 already satisfies the LP target
    if abs(lp_at_one - lp_pct_raw) <= LP_TOLERANCE:
        clamped = clamp_outs([int(a) for a in base_token_amounts],
                             max_token_addrs, balances,
                             order.tokens_in, order.amounts_in)
        nr, nr_adj, nr_sd = net_and_rebalance(order, clamped, 0,
                                              max_token_addrs, quote_fn)
        return OptimizerResult(
            order=nr, quote=d2_result.quote,
            reciprocity=nr_sd if nr_adj else d2_result.reciprocity,
            converged=True, iterations=iterations,
            alpha=ALPHA_DENOM, alpha_pct=10000, lp_target=0, fan_rounds=0)

    # Secant root-finding
    state = SecantState()
    state.best_tokens = [0] * len(base_token_amounts)
    best_scale, fan_rounds = secant_search(
        base_token_amounts, max_token_addrs,
        tokens, balances, supply, order, quote_fn,
        slider_pcts, recv_amounts, lp_pct_raw,
        d2_result, q_zero_result, lp_at_one, state, iterations)

    # Ratio balancing post-secant
    ratio_balance_secant(
        state, max_token_addrs, token_ratios, pct_by_idx,
        tokens, balances, supply, order, quote_fn,
        slider_pcts, recv_amounts, lp_pct_raw, iterations)

    # Padé fallback: if secant couldn't detect any LP, fall back to D2
    if (state.best_sd == 0
            and state.best_tokens
            and all(t == 0 for t in state.best_tokens)
            and lp_pct_raw > 0
            and d2_result.quote and d2_result.reciprocity >= 0):
        state.best_quote = d2_result.quote
        state.best_sd = d2_result.reciprocity
        state.best_tokens = clamp_outs(
            [int(a) for a in base_token_amounts],
            max_token_addrs, balances, order.tokens_in, order.amounts_in)
        state.best_error = 0
        state.converged = True

    if state.best_quote is None:
        return OptimizerResult(
            would_revert=True,
            reason="Pool cannot satisfy requested LP/token ratio.")

    sd = state.best_sd
    final_min_shares = (sd * 995 // 1000
                        if sd > 10 ** max(0, lp_decimals - 2) else 0)
    best_tokens = state.best_tokens or []

    nr2, nr2_adj, nr2_sd = net_and_rebalance(
        order, best_tokens, final_min_shares, max_token_addrs, quote_fn)
    net_sd2 = nr2_sd if nr2_adj else sd

    # Outer convergence
    recurse = outer_convergence(
        state, max_token_addrs, pct_by_idx, tokens, balances,
        supply, lp_pct_raw, net_sd2, order, quote_fn,
        all_syms, lp_decimals, give_amounts, lp_give,
        slider_pcts, recv_amounts, iterations, outer_iter)
    if recurse is not None:
        return recurse

    return OptimizerResult(
        order=nr2, quote=state.best_quote, reciprocity=net_sd2,
        converged=state.converged, iterations=iterations,
        alpha=ALPHA_DENOM, alpha_pct=10000,
        lp_target=final_min_shares, fan_rounds=fan_rounds)


# ── Main Entry Point ─────────────────────────────────────────────────────────

def optimize_swap(
    order: Order,
    quote_fn: Callable[[Order], QuoteCallResult],
    tokens: list[Token],
    balances: dict[str, int],
    supply: int,
    lp_addr: str,
    all_syms: list[str],
    lp_decimals: int,
    give_amounts: dict[str, int],
    lp_give: int,
    slider_pcts: dict[str, float],
    recv_amounts: dict[str, int],
    precomputed_base: Optional[list[int]] = None,
    outer_iter: int = 0,
) -> OptimizerResult:
    token_map = {t.sym: t for t in tokens}
    iterations: list[dict] = []

    # Parse slider percentages
    lp_pct_raw = round(slider_pcts.get("lp", 0.0) * 100)

    token_syms: list[str] = []
    pct_by_idx: list[float] = []
    for s in all_syms:
        if s == "lp":
            continue
        pct = slider_pcts.get(s, 0.0)
        if pct > 0:
            token_syms.append(s)
            pct_by_idx.append(pct)

    token_pct_total = sum(pct_by_idx)
    token_ratios: list[float] = (
        [p / token_pct_total for p in pct_by_idx] if token_pct_total > 0 else []
    )
    max_token_addrs = [token_map[s].addr for s in token_syms]

    # Compute base token amounts from give value, or use precomputed
    base_token_amounts = list(precomputed_base) if precomputed_base else []
    if token_syms and precomputed_base is None:
        base_token_amounts = compute_base_token_amounts(
            tokens, token_map, balances, supply,
            give_amounts, lp_give, token_syms, pct_by_idx)

    # Guard: nothing requested
    if not token_syms and lp_pct_raw == 0:
        return OptimizerResult(
            would_revert=True, reason="Nothing requested. Set a receive percentage.")

    # D1: Pure LP (no token receives)
    if not token_syms:
        lp_order = Order(tokens_in=order.tokens_in, amounts_in=order.amounts_in,
                         shares_in=order.shares_in, min_shares_out=0)
        r = quote_with_netting(lp_order, quote_fn)
        iterations.append({"iter": len(iterations), "reciprocity": r.reciprocity,
                           "amounts": {}, "label": "D1: pure LP"})
        target_lp = r.reciprocity * lp_pct_raw // 10000 if r.reciprocity > 0 else 0
        if r.reciprocity < target_lp:
            return OptimizerResult(
                would_revert=True,
                reason="Pool state prevents requested LP amount.")
        min_shares = (r.reciprocity * 995 // 1000
                      if r.reciprocity > 10 ** max(0, lp_decimals - 2) else 0)
        final = Order(tokens_in=order.tokens_in, amounts_in=order.amounts_in,
                      shares_in=order.shares_in, min_shares_out=min_shares)
        return OptimizerResult(
            order=net_overlapping_tokens(final), quote=r.quote,
            reciprocity=r.reciprocity, converged=True,
            iterations=iterations, alpha=ALPHA_DENOM, alpha_pct=10000,
            lp_target=min_shares, fan_rounds=0)

    # D2 / D3 dispatch
    if lp_pct_raw == 0:
        return optimize_pure_tokens(
            order, base_token_amounts, max_token_addrs,
            tokens, balances, supply, token_ratios,
            quote_fn, iterations)
    else:
        return optimize_mixed_lp_tokens(
            order, base_token_amounts, max_token_addrs,
            tokens, balances, supply, token_ratios, pct_by_idx,
            quote_fn, slider_pcts, recv_amounts, lp_pct_raw,
            lp_decimals, all_syms, give_amounts, lp_give,
            iterations, outer_iter)
