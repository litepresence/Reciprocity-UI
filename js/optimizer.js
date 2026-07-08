// SPDX-License-Identifier: MIT
// optimizer.js — on-chain swap optimizer
//
// Mirrors optimizer.py structure exactly.  Each D2 binary-search strategy and
// the D3 secant search is its own function for testability and readability.
//
// Entry point:  optimizeSwap(order, quoteFn, state, dom, ...)
//
// Uses global SCALE, ALPHA_DENOM from constants.js and _spotPrice from core.js.

const LP_TOLERANCE = 1;  // permyriad (0.01%) — matches optimizer.py:26

// ── Pure Helpers ─────────────────────────────────────────────────────────────

function netOverlappingTokens(order) {
  const tIn = [...order.tokensIn];
  const aIn = [...order.amountsIn];
  const tOut = [...order.tokensOut];
  const aOut = [...order.amountsOut];
  for (let i = tIn.length - 1; i >= 0; i--) {
    const addr = tIn[i].toLowerCase();
    const outI = tOut.findIndex(a => a.toLowerCase() === addr);
    if (outI === -1) continue;
    if (aOut[outI] <= 0n) { tOut.splice(outI, 1); aOut.splice(outI, 1); continue; }
    if (aIn[i] <= 0n) { tIn.splice(i, 1); aIn.splice(i, 1); continue; }
    if (aIn[i] > aOut[outI]) {
      aIn[i] -= aOut[outI];
      tOut.splice(outI, 1);
      aOut.splice(outI, 1);
    } else if (aOut[outI] > aIn[i]) {
      aOut[outI] -= aIn[i];
      tIn.splice(i, 1);
      aIn.splice(i, 1);
    } else {
      tIn.splice(i, 1);
      aIn.splice(i, 1);
      tOut.splice(outI, 1);
      aOut.splice(outI, 1);
    }
  }
  return { ...order, tokensIn: tIn, amountsIn: aIn, tokensOut: tOut, amountsOut: aOut };
}

function scaleBigIntArray(arr, factor, lockedMask, lockedAmounts) {
  return arr.map((a, i) => lockedMask && lockedMask[i] ? (lockedAmounts ? lockedAmounts[i] : a) : a * BigInt(Math.round(factor * 1000)) / 1000n);
}

function restoreLockedPositions(arr, state) {
  if (!state._lockedMask) return arr;
  for (let i = 0; i < arr.length; i++) {
    if (state._lockedMask[i]) arr[i] = state._lockedAmounts[i];
  }
  return arr;
}

function restoreLockedInResult(result, maxTokensAddrs, state) {
  if (!state._lockedMask || !result.tokensOut) return result;
  const amountsOut = [...result.amountsOut];
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    if (state._lockedMask[j]) {
      const idx = result.tokensOut.findIndex(t => t.toLowerCase() === maxTokensAddrs[j].toLowerCase());
      if (idx >= 0) amountsOut[idx] = state._lockedAmounts[j];
    }
  }
  return { ...result, amountsOut };
}

function symByAddrLookup(addr, state) {
  for (const t of state.TOKENS) if (t.addr.toLowerCase() === addr.toLowerCase()) return t.sym.toLowerCase();
  if (state.LP_ADDR && addr.toLowerCase() === state.LP_ADDR.toLowerCase()) return 'lp';
  return null;
}

function spotPrice(sym, state) {
  return _spotPrice(sym, state);
}

function poolValue(state) {
  let pv = 0n;
  for (const t of state.TOKENS) {
    const b = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
    if (b > 0n) {
      const p = spotPrice(t.sym.toLowerCase(), state);
      pv += b * p / SCALE;
    }
  }
  return pv;
}

function clampOuts(amounts, maxTokensAddrs, balances, tokensIn, amountsIn) {
  return amounts.map((a, i) => {
    const addr = maxTokensAddrs[i].toLowerCase();
    const poolBal = balances[addr] || 0n;
    const inputAmt = (() => { const idx = tokensIn.findIndex(t => t.toLowerCase() === addr); return idx >= 0 ? amountsIn[idx] : 0n; })();
    return a > poolBal + inputAmt ? poolBal + inputAmt : a;
  });
}

function targetAmt(totalOutVal, ratio, price) {
  const tv = totalOutVal * BigInt(Math.round(ratio * 100000)) / 100000n;
  return price > 0n ? tv * SCALE / price : 0n;
}

function symToAddr(sym, state) {
  const t = state.TOKEN_MAP[sym];
  return t ? t.addr : null;
}

// ── Quote Wrapper ────────────────────────────────────────────────────────────

async function quoteWithNetting(innerOrder, quoteFn) {
  const origTokens = [...innerOrder.tokensOut];
  const origAmounts = [...innerOrder.amountsOut];
  const netted = netOverlappingTokens(innerOrder);
  const q = await quoteFn(netted);
  if (!q) return q;

  // Normalize: flat format (local math) or nested {quote, ...} (on-chain)
  const target = q.quote || q;
  const qTokens = target.tokensOut || [];
  const qAmounts = target.amountsOut || [];
  const giveAddrs = new Set((innerOrder.tokensIn || []).map(t => t.toLowerCase()));
  const restoredTokens = [...qTokens];
  const restoredAmounts = [...qAmounts];

  for (let i = 0; i < origTokens.length; i++) {
    const addr = origTokens[i].toLowerCase();
    const inContract = qTokens.findIndex(t => t.toLowerCase() === addr);
    if (giveAddrs.has(addr) && inContract >= 0) {
      restoredAmounts[inContract] = origAmounts[i];
    } else if (inContract < 0) {
      restoredTokens.push(origTokens[i]);
      restoredAmounts.push(origAmounts[i]);
    }
  }

  target._netTokens = [...qTokens];
  target._netAmounts = [...qAmounts];
  target.tokensOut = restoredTokens;
  target.amountsOut = restoredAmounts;

  const sd = q.reciprocity !== undefined ? q.reciprocity : q.quote?.reciprocity;
  return { quote: q, reciprocity: sd };
}

// ── LP % Computation ─────────────────────────────────────────────────────────

function computeLpPct(sharesDelta, amountsOut, sharesIn, tokensOut,
                       maxTokensAddrs, state, order, recvAmounts) {
  const amtMap = {};
  const mapTokens = tokensOut || maxTokensAddrs;
  for (let j = 0; j < mapTokens.length; j++) {
    amtMap[mapTokens[j].toLowerCase()] = amountsOut[j] || 0n;
  }

  let tv = 0n;
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    const addr = maxTokensAddrs[j];
    const sym = symByAddrLookup(addr, state) || '?';
    const price = spotPrice(sym, state);
    tv += (amtMap[addr.toLowerCase()] || 0n) * price / SCALE;
  }

  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    if (dom.getSliderPct(sym) > 0 && order.tokensIn.some(a => a.toLowerCase() === t.addr.toLowerCase())) {
      const inTokensOut = (tokensOut || maxTokensAddrs).some(a => a.toLowerCase() === t.addr.toLowerCase());
      if (!inTokensOut) {
        const rAmt = recvAmounts[sym] || 0n;
        if (rAmt > 0n) {
          const price = spotPrice(sym, state);
          tv += rAmt * price / SCALE;
        }
      }
    }
  }

  const pv = poolValue(state);
  const totalSupply = state.poolCache.supply || 1n;
  const lpAmt = (sharesIn || 0n) > 0n && sharesDelta > (sharesIn || 0n) ? sharesDelta - sharesIn : sharesDelta;
  const sdValue = totalSupply > 0n ? lpAmt * pv / totalSupply : 0n;
  const total = sdValue + tv;
  if (total <= 0n || sdValue <= 0n) return 0;
  return Number(sdValue * 10000n / total);
}

// ── Base Amount Computation ──────────────────────────────────────────────────

function computeBaseTokenAmounts(state, dom, order, tokenSyms, pctByIdx, lockedMask, lockedAmounts) {
  let totalGiveVal = 0n;
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const g = dom.readGive(sym);
    if (g && g > 0n) {
      totalGiveVal += g * spotPrice(sym, state) / SCALE;
    }
  }

  const lpGive = dom.readGiveLp();
  if (lpGive && lpGive > 0n) {
    const optSupply = state.poolCache.supply;
    if (optSupply && optSupply > 0n) {
      const optPv = poolValue(state);
      totalGiveVal += lpGive * optPv / optSupply;
    }
  }

  // Deduct locked token values from total give
  let lockedVal = 0n;
  if (lockedMask && lockedAmounts) {
    for (let i = 0; i < tokenSyms.length; i++) {
      if (lockedMask[i]) {
        lockedVal += lockedAmounts[i] * spotPrice(tokenSyms[i], state) / SCALE;
      }
    }
  }
  const freeVal = totalGiveVal > lockedVal ? totalGiveVal - lockedVal : 0n;

  let freePctTotal = 0;
  for (let i = 0; i < tokenSyms.length; i++) {
    if (!(lockedMask && lockedMask[i])) freePctTotal += pctByIdx[i];
  }

  const base = [];
  for (let i = 0; i < tokenSyms.length; i++) {
    if (lockedMask && lockedMask[i]) {
      base.push(lockedAmounts[i]);
    } else {
      const sym = tokenSyms[i];
      const price = spotPrice(sym, state);
      const targetVal = freeVal > 0n && freePctTotal > 0n ? freeVal * BigInt(Math.round(pctByIdx[i] * 100)) / BigInt(Math.round(freePctTotal * 100)) : 0n;
      const amt = price > 0n ? targetVal * SCALE / price : 0n;
      base.push(amt > 0n ? amt : 1n);
    }
  }
  return base;
}

// ── Net & Rebalance ──────────────────────────────────────────────────────────

async function netAndRebalance(order, amtsOut, minShares, maxTokensAddrs, quoteFn) {
  const preNet = { ...order, tokensOut: maxTokensAddrs, amountsOut: amtsOut, minSharesOut: minShares };
  const netted = netOverlappingTokens(preNet);

  const overlapping = netted.tokensIn.length < order.tokensIn.length || netted.amountsIn.some((a, i) => {
    const oi = order.tokensIn.findIndex(t => t.toLowerCase() === netted.tokensIn[i].toLowerCase());
    return oi >= 0 && a !== order.amountsIn[oi];
  });
  if (!overlapping) return { order: restoreLockedInResult(netted, maxTokensAddrs, state), adjusted: false, reciprocity: null };

  const nq = await quoteWithNetting(netted, quoteFn);
  if (nq.quote == null || nq.reciprocity >= 0n) return { order: restoreLockedInResult(netted, maxTokensAddrs, state), adjusted: false, reciprocity: nq.reciprocity };

  let lo = 1000, hi = 10000, best = 10000, bestSd = nq.reciprocity;
  for (let bs = 0; bs < 12; bs++) {
    const mid = (lo + hi) >> 1;
    let scaled = amtsOut.map(a => a * BigInt(mid) / 10000n);
    if (state._lockedMask) restoreLockedPositions(scaled, state);
    const testNetted = netOverlappingTokens({ ...order, tokensOut: maxTokensAddrs, amountsOut: scaled, minSharesOut: minShares });
    const sq = await quoteWithNetting(testNetted, quoteFn);
    if (sq.quote !== null && sq.reciprocity >= 0n) {
      if (bestSd < 0n || sq.reciprocity < bestSd) { best = mid; bestSd = sq.reciprocity; }
      lo = mid + 1;
    } else { hi = mid - 1; }
  }

  if (bestSd >= 0n) {
    let scaledAmts = amtsOut.map(a => a * BigInt(best) / 10000n);
    if (state._lockedMask) restoreLockedPositions(scaledAmts, state);
    const rebOrder = netOverlappingTokens({ ...order, tokensOut: maxTokensAddrs, amountsOut: scaledAmts, minSharesOut: minShares });
    return { order: restoreLockedInResult(rebOrder, maxTokensAddrs, state), adjusted: true, reciprocity: bestSd };
  }
  return { order: restoreLockedInResult(netted, maxTokensAddrs, state), adjusted: false, reciprocity: nq.reciprocity };
}

// ── D2 Search Strategies ─────────────────────────────────────────────────────

async function redistributeDust(clamped, r, baseTokenAmounts, maxTokensAddrs,
                                state, order, quoteFn, iterations) {
  const pv = poolValue(state);
  const supply = state.poolCache.supply || 1n;
  const dustVal = r.reciprocity * pv / supply;
  if (dustVal <= 0n) return { clamped, r };

  let totalOutVal = 0n;
  const outVals = [];
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
    const price = spotPrice(sym, state);
    const v = BigInt(clamped[j]) * price / SCALE;
    outVals.push(v);
    totalOutVal += v;
  }
  if (totalOutVal <= 0n) return { clamped, r };

  const adjusted = clamped.map((a, j) => {
    if (state._lockedMask && state._lockedMask[j]) return a;
    const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
    const price = spotPrice(sym, state);
    const extra = outVals[j] * dustVal / totalOutVal;
    return a + (extra > 0n ? extra * SCALE / price : 0n);
  });
  const clamped2 = clampOuts(adjusted, maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);
  const r2 = await quoteWithNetting(
    { ...order, tokensOut: maxTokensAddrs, amountsOut: clamped2, sharesIn: order.sharesIn }, quoteFn);
  if (r2.quote !== null) {
    iterations.push({ iter: iterations.length, reciprocity: r2.reciprocity, amounts: {}, label: 'D2: dust adj' });
    return { clamped: clamped2, r: r2 };
  }
  return { clamped, r };
}

async function scaleUpSearch(clamped, r, baseTokenAmounts, maxTokensAddrs,
                              balances, order, quoteFn, iterations) {
  let lo = 1.0, hi = 5.0;
  let bestR = r, bestSd = r.reciprocity, bestAmts = clamped;
  for (let bs = 0; bs < 8; bs++) {
    const mid = (lo + hi) / 2;
    let scaledAmts = baseTokenAmounts.map(function (a) {
      return a === 0n ? 0n : a * BigInt(Math.round(mid * 1000)) / 1000n;
    });
    restoreLockedPositions(scaledAmts, state);
    const scaled = clampOuts(scaledAmts, maxTokensAddrs, balances, order.tokensIn, order.amountsIn);
    const testR = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: scaled, sharesIn: order.sharesIn }, quoteFn);
    if (testR.quote !== null) {
      if (testR.reciprocity >= 0n && testR.reciprocity < bestSd) {
        bestSd = testR.reciprocity; bestR = testR; bestAmts = scaled;
      }
      if (testR.reciprocity > 0n) lo = mid; else hi = mid;
    } else { hi = mid; }
  }
  if (bestSd < r.reciprocity) {
    iterations.push({ iter: iterations.length, reciprocity: bestSd, amounts: {}, label: 'D2: dust bs' });
    return { clamped: bestAmts, r: bestR };
  }
  return { clamped, r };
}

async function scaleDownSearch(clamped, r, baseTokenAmounts, maxTokensAddrs,
                                balances, order, quoteFn, iterations) {
  let lo = 0, hi = 9999;
  let bestR = r, bestSd = r.reciprocity, bestAmts = clamped;
  for (let bs = 0; bs < 14; bs++) {
    const mid = (lo + hi) >> 1;
    let scaledAmts = baseTokenAmounts.map(a => a * BigInt(mid) / 10000n);
    restoreLockedPositions(scaledAmts, state);
    const scaled = clampOuts(scaledAmts,
      maxTokensAddrs, balances, order.tokensIn, order.amountsIn);
    const testR = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: scaled, sharesIn: order.sharesIn }, quoteFn);
    if (testR.quote !== null && testR.reciprocity >= 0n) {
      if (testR.reciprocity < bestSd) { bestSd = testR.reciprocity; bestR = testR; bestAmts = scaled; }
      lo = mid + 1;
    } else { hi = mid - 1; }
  }

  if (bestSd < r.reciprocity) {
    iterations.push({ iter: iterations.length, reciprocity: bestSd, amounts: {}, label: 'D2: scale down' });
    return { clamped: bestAmts, r: bestR };
  }

  if (order.sharesIn > 0n && order.tokensIn.length === 0) {
    let fineAmts2 = baseTokenAmounts.map(a => a * 9999n / 10000n);
    restoreLockedPositions(fineAmts2, state);
    const fineAmts = clampOuts(fineAmts2,
      maxTokensAddrs, balances, order.tokensIn, order.amountsIn);
    const fineR = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: fineAmts, sharesIn: order.sharesIn }, quoteFn);
    if (fineR.quote !== null && fineR.reciprocity >= 0n && fineR.reciprocity < bestSd) {
      iterations.push({ iter: iterations.length, reciprocity: fineR.reciprocity, amounts: {}, label: 'D2: fine scale' });
      return { clamped: fineAmts, r: fineR };
    }
  }
  return { clamped, r };
}

async function extendedScaleUp(clamped, r, baseTokenAmounts, maxTokensAddrs,
                                balances, order, quoteFn, iterations) {
  let maxFactor = 100;
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    const bal = balances[maxTokensAddrs[j].toLowerCase()] || 0n;
    const giveAmt = (order.amountsIn || [])[j] || 0n;
    const cap = bal + giveAmt;
    const base = baseTokenAmounts[j];
    if (base > 0n) {
      const tf = Number(cap * 100n / base);
      if (tf < maxFactor) maxFactor = tf;
    }
  }
  if (maxFactor < 100) maxFactor = 100;
  if (maxFactor <= 5) return { clamped, r };

  let lo = 1.0, hi = maxFactor;
  let bestR = r, bestSd = r.reciprocity, bestAmts = clamped;
  for (let bs = 0; bs < 20; bs++) {
    const mid = (lo + hi) / 2;
    let scaledAmts = baseTokenAmounts.map(function (a) {
      return a === 0n ? 0n : a * BigInt(Math.round(mid * 1000)) / 1000n;
    });
    restoreLockedPositions(scaledAmts, state);
    const scaled = clampOuts(scaledAmts, maxTokensAddrs, balances, order.tokensIn, order.amountsIn);
    const testR = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: scaled, sharesIn: order.sharesIn }, quoteFn);
    if (testR.quote !== null) {
      if (testR.reciprocity >= 0n && testR.reciprocity < bestSd) {
        bestSd = testR.reciprocity; bestR = testR; bestAmts = scaled;
      }
      if (testR.reciprocity > 0n) lo = mid; else hi = mid;
    } else { hi = mid; }
  }
  if (bestSd < r.reciprocity) {
    iterations.push({ iter: iterations.length, reciprocity: bestSd, amounts: {}, label: 'D2: ext bs' });
    return { clamped: bestAmts, r: bestR };
  }
  return { clamped, r };
}

async function perTokenSearch(clamped, r, baseTokenAmounts, maxTokensAddrs,
                               balances, order, quoteFn, iterations) {
  let bestR = r, bestSd = r.reciprocity, bestAmts = [...clamped];
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    if (state._lockedMask && state._lockedMask[j]) continue;
    const addr = maxTokensAddrs[j].toLowerCase();
    const gIdx = (order.tokensIn || []).findIndex(t => t.toLowerCase() === addr);
    const gAmt = gIdx >= 0 ? (order.amountsIn || [])[gIdx] || 0n : 0n;
    if (gAmt > 0n && clamped[j] > gAmt) {
      let lo = gAmt, hi = clamped[j];
      for (let bs = 0; bs < 20; bs++) {
        const mid = (lo + hi) >> 1n;
        const testAmts = clamped.map(a => BigInt(a));
        testAmts[j] = mid;
        const testR = await quoteWithNetting(
          { ...order, tokensOut: maxTokensAddrs, amountsOut: testAmts, sharesIn: order.sharesIn }, quoteFn);
        if (testR.quote !== null && testR.reciprocity >= 0n && testR.reciprocity < bestSd) {
          bestSd = testR.reciprocity; bestR = testR; bestAmts = testAmts;
        }
        if (testR.quote == null || testR.reciprocity > 0n) hi = mid; else lo = mid + 1n;
        if (lo >= hi) break;
      }
    }
  }
  if (bestSd < r.reciprocity) {
    iterations.push({ iter: iterations.length, reciprocity: bestSd, amounts: {}, label: 'D2: net bs' });
    return { clamped: bestAmts, r: bestR };
  }
  return { clamped, r };
}

async function proportionalShare(clamped, r, maxTokensAddrs, balances, supply,
                                  order, quoteFn, iterations) {
  if (r.reciprocity <= 0n || order.sharesIn <= 0n || order.tokensIn.length !== 0) return { clamped, r };
  const sup = supply || 1n;
  let propRaw = maxTokensAddrs.map(function (addr) {
    return (balances[addr.toLowerCase()] || 0n) * order.sharesIn / sup;
  });
  restoreLockedPositions(propRaw, state);
  const propAmts = clampOuts(propRaw, maxTokensAddrs, balances, order.tokensIn, order.amountsIn);
  const testR = await quoteWithNetting(
    { ...order, tokensOut: maxTokensAddrs, amountsOut: propAmts, sharesIn: order.sharesIn }, quoteFn);
  if (testR.quote !== null && testR.reciprocity <= 0n) {
    iterations.push({ iter: iterations.length, reciprocity: testR.reciprocity, amounts: {}, label: 'D2: prop share' });
    return { clamped: propAmts, r: testR };
  }
  return { clamped, r };
}

async function scaleDownNegative(clamped, r, baseTokenAmounts, maxTokensAddrs,
                                  balances, order, quoteFn, iterations) {
  let lo = 0, hi = 10000;
  let bestR = r, bestSd = r.reciprocity, bestAmts = clamped;
  for (let bs = 0; bs < 16; bs++) {
    const mid = (lo + hi) >> 1;
    let scaledAmts = baseTokenAmounts.map(a => a * BigInt(mid) / 10000n);
    restoreLockedPositions(scaledAmts, state);
    const scaled = clampOuts(scaledAmts,
      maxTokensAddrs, balances, order.tokensIn, order.amountsIn);
    const testR = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: scaled, sharesIn: order.sharesIn }, quoteFn);
    if (testR.quote !== null && testR.reciprocity >= 0n) {
      if (bestSd < 0n || testR.reciprocity < bestSd) { bestSd = testR.reciprocity; bestR = testR; bestAmts = scaled; }
      lo = mid + 1;
    } else { hi = mid - 1; }
  }
  if (bestSd < 0n) return { clamped, r, err: { wouldRevert: true, reason: 'Requested amounts exceed pool capacity.' } };
  iterations.push({ iter: iterations.length, reciprocity: bestSd, amounts: {}, label: 'D2: scale down' });
  return { clamped: bestAmts, r: bestR, err: null };
}

// ── Ratio Balancing ──────────────────────────────────────────────────────────

async function ratioBalance(clamped, r, maxTokensAddrs, tokenRatios,
                             state, order, quoteFn, iterations, isLargeTrade) {
  const rbLimit = isLargeTrade ? 2 : 8;
  for (let rb = 0; rb < rbLimit; rb++) {
    let outVals = [];
    let totalOutVal = 0n;
    for (let j = 0; j < maxTokensAddrs.length; j++) {
      if (state._lockedMask && state._lockedMask[j]) continue;
      const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
      const price = spotPrice(sym, state);
      const v = BigInt(clamped[j]) * price / SCALE;
      outVals.push(v);
      totalOutVal += v;
    }
    if (totalOutVal <= 0n) break;

    let maxDev = 0;
    for (let j = 0; j < maxTokensAddrs.length; j++) {
      if (state._lockedMask && state._lockedMask[j]) continue;
      const pct = Number(outVals[j]) / Number(totalOutVal);
      maxDev = Math.max(maxDev, Math.abs(pct - tokenRatios[j]));
    }
    if (maxDev < 0.005) break;

    const target = maxTokensAddrs.map((addr, j) => {
      if (state._lockedMask && state._lockedMask[j]) return clamped[j];
      const sym = symByAddrLookup(addr, state) || '?';
      const price = spotPrice(sym, state);
      return targetAmt(totalOutVal, tokenRatios[j], price);
    });
    const clampedTarget = clampOuts(target, maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);

    let newTotal = 0n;
    for (let j = 0; j < maxTokensAddrs.length; j++) {
      if (state._lockedMask && state._lockedMask[j]) continue;
      const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
      const price = spotPrice(sym, state);
      newTotal += BigInt(clampedTarget[j]) * price / SCALE;
    }
    let finalTarget = clampedTarget;
    if (newTotal > totalOutVal) {
      const scale = totalOutVal * 100000n / newTotal;
      finalTarget = clampedTarget.map((a, j) => state._lockedMask && state._lockedMask[j] ? a : a * scale / 100000n);
    }

    const testR = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: finalTarget, sharesIn: order.sharesIn }, quoteFn);
    if (testR.quote !== null && testR.reciprocity >= 0n) {
      iterations.push({ iter: iterations.length, reciprocity: testR.reciprocity, amounts: {}, label: `D2: ratio bal ${rb}` });
      clamped = finalTarget; r = testR;
    } else { break; }
  }
  return { clamped, r };
}

// ── D2 Pure Tokens ───────────────────────────────────────────────────────────

async function optimizePureTokens(order, baseTokenAmounts, maxTokensAddrs,
                                    state, quoteFn, iterations, tokenRatios) {
  let clamped = clampOuts(baseTokenAmounts.map(a => BigInt(a)),
    maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);
  let r = await quoteWithNetting(
    { ...order, tokensOut: maxTokensAddrs, amountsOut: clamped, sharesIn: order.sharesIn }, quoteFn);
  iterations.push({ iter: iterations.length, reciprocity: r.reciprocity, amounts: {}, label: 'D2: pure tokens' });
  if (r.quote == null) {
    return { wouldRevert: true, reason: 'Requested amounts exceed pool capacity.' };
  }

  if (r.reciprocity > 0n) {
    let res;
    res = await redistributeDust(clamped, r, baseTokenAmounts, maxTokensAddrs, state, order, quoteFn, iterations);
    clamped = res.clamped; r = res.r;
    res = await scaleUpSearch(clamped, r, baseTokenAmounts, maxTokensAddrs, state.poolCache.balances, order, quoteFn, iterations);
    clamped = res.clamped; r = res.r;
    res = await scaleDownSearch(clamped, r, baseTokenAmounts, maxTokensAddrs, state.poolCache.balances, order, quoteFn, iterations);
    clamped = res.clamped; r = res.r;
    res = await extendedScaleUp(clamped, r, baseTokenAmounts, maxTokensAddrs, state.poolCache.balances, order, quoteFn, iterations);
    clamped = res.clamped; r = res.r;
    res = await perTokenSearch(clamped, r, baseTokenAmounts, maxTokensAddrs, state.poolCache.balances, order, quoteFn, iterations);
    clamped = res.clamped; r = res.r;
    res = await proportionalShare(clamped, r, maxTokensAddrs, state.poolCache.balances, state.poolCache.supply, order, quoteFn, iterations);
    clamped = res.clamped; r = res.r;
  } else if (r.reciprocity < 0n) {
    const res = await scaleDownNegative(clamped, r, baseTokenAmounts, maxTokensAddrs, state.poolCache.balances, order, quoteFn, iterations);
    if (res.err) return res.err;
    clamped = res.clamped; r = res.r;
  }

  if (r.reciprocity < 0n) {
    return { wouldRevert: true, reason: 'Insufficient give value for requested receive ratios.' };
  }

  const preR = r;
  const preAmts = [...clamped];

  const isLarge = order.sharesIn > (state.poolCache.supply || 0n) / 10n ||
    (order.amountsIn || []).some(function (a, i) {
      const addr = (order.tokensIn || [])[i];
      return addr && (a || 0n) > ((state.poolCache.balances[addr.toLowerCase()] || 0n) * 2n);
    });
  const rbRes = await ratioBalance(clamped, r, maxTokensAddrs, tokenRatios, state, order, quoteFn, iterations, isLarge);
  clamped = rbRes.clamped; r = rbRes.r;

  if (r.reciprocity > preR.reciprocity) {
    r = preR; clamped = preAmts;
  }

  const nr = await netAndRebalance(order, clamped, 0n, maxTokensAddrs, quoteFn);
  return { order: nr.order, quote: r.quote, reciprocity: nr.adjusted ? nr.reciprocity : r.reciprocity,
    converged: true, iterations, alpha: ALPHA_DENOM, alphaPct: 10000, lpTarget: 0n, fanRounds: 0 };
}

// ── D3 Secant Search State ───────────────────────────────────────────────────

function createSecantState() {
  return { bestQuote: null, bestSd: 0n, bestTokens: null, bestError: Number.MAX_SAFE_INTEGER, bestScale: 0, converged: false };
}

// ── D3 Mixed LP + Tokens ─────────────────────────────────────────────────────

async function secantEval(alpha, baseTokenAmounts, maxTokensAddrs,
                           state, order, quoteFn, recvAmounts,
                           lpPctRaw, secantState, iterations) {
  const clamped = clampOuts(scaleBigIntArray(baseTokenAmounts, alpha, state._lockedMask, state._lockedAmounts),
    maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);
  const q = await quoteWithNetting(
    { ...order, tokensOut: maxTokensAddrs, amountsOut: clamped, sharesIn: order.sharesIn }, quoteFn);
  let err, lp;
  if (state._lockedLpAmt) {
    const sd = q.reciprocity > 0n ? q.reciprocity : 0n;
    const sdDiff = sd > state._lockedLpAmt ? sd - state._lockedLpAmt : state._lockedLpAmt - sd;
    err = Number(sdDiff * 10000n / (state._lockedLpAmt || 1n));
    if (q.reciprocity < 0n) err += 10000;
    let sdVal = 0n;
    if (q.quote && state.poolCache.supply > 0n) {
      const pv = poolValue(state);
      sdVal = sd * pv / BigInt(state.poolCache.supply);
    }
    if (sdVal > 0n && q.quote) {
      const qo = q.quote.tokensOut || q.quote[0] || [];
      const qa = q.quote.amountsOut || q.quote[1] || [];
      let tv = 0n;
      for (let j = 0; j < qo.length; j++) {
        const sym = symByAddrLookup(qo[j], state);
        if (sym) tv += BigInt(qa[j] || 0n) * spotPrice(sym, state) / SCALE;
      }
      const total = sdVal + tv;
      lp = total > 0n ? Number(sdVal * 10000n / total) : 0;
    } else {
      lp = 0;
    }
  } else {
    lp = q.quote ? computeLpPct(q.reciprocity, q.quote.amountsOut, order.sharesIn, q.quote.tokensOut,
      maxTokensAddrs, state, order, recvAmounts) : -10000;
    err = Math.abs(lp - lpPctRaw);
    if (q.reciprocity < 0n) err += 10000;
  }

  if (err < secantState.bestError && q.quote) {
    secantState.bestError = err;
    secantState.bestQuote = q.quote;
    secantState.bestSd = q.reciprocity;
    secantState.bestTokens = clamped.map(a => a);
    secantState.bestScale = alpha;
    secantState.converged = err <= LP_TOLERANCE;
  }

  iterations.push({ iter: iterations.length, reciprocity: q.reciprocity, amounts: {},
    label: `α=${alpha.toFixed(4)} LP=${((lp / 10) || 0).toFixed(1)}%` });
  return { lp, q };
}

async function secantSearch(baseTokenAmounts, maxTokensAddrs,
                             state, order, quoteFn, recvAmounts,
                             lpPctRaw, d2Result, qZeroResult, lpAtOne,
                             secantState, iterations) {
  let a0 = 0, f0 = 10000 - lpPctRaw;
  let a1 = 1, f1 = lpAtOne - lpPctRaw;
  let fanRounds = 0;

  if (f1 > 0) {
    for (let up = 2; up <= 64 && f1 > 0; up *= 2) {
      const eRes = await secantEval(up, baseTokenAmounts, maxTokensAddrs, state, order, quoteFn, recvAmounts, lpPctRaw, secantState, iterations);
      f1 = eRes.lp - lpPctRaw;
      a1 = up;
      fanRounds++;
    }
  }

  let stableConverged = false;
  for (let iter = 0; iter < 20 && !stableConverged; iter++) {
    fanRounds++;
    const fDiff = f1 - f0;
    let a2;
    if (fDiff === 0) { a2 = (a0 + a1) / 2; }
    else { a2 = a1 - f1 * (a1 - a0) / fDiff; }
    const aLo = Math.min(a0, a1), aHi = Math.max(a0, a1);
    if (a2 <= aLo || a2 >= aHi) a2 = (aLo + aHi) / 2;
    a2 = Math.max(0.0001, Math.min(100.0, a2));

    const eRes = await secantEval(a2, baseTokenAmounts, maxTokensAddrs, state, order, quoteFn, recvAmounts, lpPctRaw, secantState, iterations);
    const f2 = eRes.lp - lpPctRaw;
    if (secantState.converged && secantState.bestError <= LP_TOLERANCE) stableConverged = true;
    if (f2 > 0) { a0 = a2; f0 = f2; } else { a1 = a2; f1 = f2; }
  }
  if (!stableConverged && Math.abs(a1 - a0) < 0.0005) secantState.converged = true;
  return { bestScale: secantState.bestScale, fanRounds };
}

async function ratioBalanceSecant(secantState, maxTokensAddrs, tokenRatios, pctByIdx,
                                   state, order, quoteFn, recvAmounts,
                                   lpPctRaw, iterations) {
  if (!secantState.converged || !secantState.bestQuote || pctByIdx.length <= 1) return;

  let rbAmts = secantState.bestTokens ? [...secantState.bestTokens] : [];
  if (secantState.bestQuote.amountsOut) {
    rbAmts = maxTokensAddrs.map((addr) => {
      const idx = (secantState.bestQuote.tokensOut || []).findIndex(t => t.toLowerCase() === addr.toLowerCase());
      return idx >= 0 ? (secantState.bestQuote.amountsOut[idx] || 0n) : 0n;
    });
  }

  const pv = poolValue(state);
  const sup = state.poolCache.supply || 1n;

  for (let rb = 0; rb < 8; rb++) {
    let outVals = [];
    let totalOutVal = 0n;
    for (let j = 0; j < maxTokensAddrs.length; j++) {
      if (state._lockedMask && state._lockedMask[j]) continue;
      const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
      const price = spotPrice(sym, state);
      const v = BigInt(rbAmts[j]) * price / SCALE;
      outVals.push(v);
      totalOutVal += v;
    }
    if (totalOutVal <= 0n) break;

    let maxDev = 0;
    for (let j = 0; j < maxTokensAddrs.length; j++) {
      if (state._lockedMask && state._lockedMask[j]) continue;
      const pct = Number(outVals[j]) / Number(totalOutVal);
      maxDev = Math.max(maxDev, Math.abs(pct - tokenRatios[j]));
    }
    if (maxDev < 0.005) break;

    const target = maxTokensAddrs.map((addr, j) => {
      if (state._lockedMask && state._lockedMask[j]) return rbAmts[j];
      const sym = symByAddrLookup(addr, state) || '?';
      const price = spotPrice(sym, state);
      return targetAmt(totalOutVal, tokenRatios[j], price);
    });
    const clampedTarget = clampOuts(target, maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);

    let newTotal = 0n;
    let newOutVals = [];
    for (let j = 0; j < maxTokensAddrs.length; j++) {
      if (state._lockedMask && state._lockedMask[j]) continue;
      const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
      const price = spotPrice(sym, state);
      const v = BigInt(clampedTarget[j]) * price / SCALE;
      newOutVals.push(v);
      newTotal += v;
    }
    let finalTarget = clampedTarget;
    let finalOutVals = newOutVals;
    if (newTotal > totalOutVal) {
      const scale = totalOutVal * 100000n / newTotal;
      finalTarget = clampedTarget.map((a, j) => state._lockedMask && state._lockedMask[j] ? a : a * scale / 100000n);
      finalOutVals = newOutVals.map(v => v * scale / 100000n);
      newTotal = totalOutVal;
    }

    const testR = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: finalTarget, sharesIn: order.sharesIn }, quoteFn);
    if (testR.quote !== null && testR.reciprocity > 0n) {
      let rbLpError;
      if (state._lockedLpAmt) {
        const sdDiff = testR.reciprocity > state._lockedLpAmt ? testR.reciprocity - state._lockedLpAmt : state._lockedLpAmt - testR.reciprocity;
        rbLpError = Number(sdDiff * 10000n / (state._lockedLpAmt || 1n));
      } else {
        const rbLp = computeLpPct(testR.reciprocity, testR.quote.amountsOut, order.sharesIn, testR.quote.tokensOut,
          maxTokensAddrs, state, order, recvAmounts);
        rbLpError = Math.abs(rbLp - lpPctRaw);
      }
      const sdV = testR.reciprocity * pv / sup;
      let rbRatioError = 0;
      for (let j = 0; j < pctByIdx.length; j++) {
        const pct = newTotal + sdV > 0n ? Number(finalOutVals[j] * 10000n / (newTotal + sdV)) : 0;
        rbRatioError += Math.abs(pct - Math.round(pctByIdx[j] * 100));
      }
      if (rbLpError + rbRatioError < secantState.bestError) {
        secantState.bestError = rbLpError + rbRatioError;
        secantState.bestQuote = testR.quote;
        secantState.bestSd = testR.reciprocity;
        secantState.bestTokens = finalTarget.map(a => a);
        rbAmts = [...finalTarget];
        iterations.push({ iter: iterations.length, reciprocity: testR.reciprocity, amounts: {}, label: `LP: ratio bal ${rb}` });
      } else { break; }
    } else { break; }
  }
}

async function outerConvergence(secantState, maxTokensAddrs, pctByIdx,
                                 state, order, quoteFn, recvAmounts,
                                 lpPctRaw, netSd2, allSyms, lpDecimals,
                                 giveAmounts, lpGive, sliderPcts,
                                 iterations, outerIter) {
  if (!secantState.bestQuote || !secantState.bestQuote.tokensOut) return null;

  const amtByAddr = {};
  if (secantState.bestQuote.tokensOut) {
    for (let k = 0; k < secantState.bestQuote.tokensOut.length; k++) {
      amtByAddr[secantState.bestQuote.tokensOut[k].toLowerCase()] = BigInt(secantState.bestQuote.amountsOut[k] || 0n);
    }
  }

  let _t = 0n; const _v = {};
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
    const amt = amtByAddr[maxTokensAddrs[j].toLowerCase()] || 0n;
    const val = amt * spotPrice(sym, state) / SCALE;
    _v[sym] = val; _t += val;
  }
  const _poolVal = poolValue(state);
  const _sup = state.poolCache.supply || 1n;
  const _lpVal = netSd2 * _poolVal / _sup;
  const _totalVal = _t + _lpVal;
  let _maxErr = 0;
  for (let j = 0; j < pctByIdx.length; j++) {
    const sym = symByAddrLookup(maxTokensAddrs[j], state) || '?';
    const apct = _totalVal > 0n ? Number((_v[sym] || 0n) * 10000n / _totalVal) : 0;
    _maxErr = Math.max(_maxErr, Math.abs(apct - Math.round(pctByIdx[j] * 100)));
  }
  const _lpApct = _totalVal > 0n ? Number(_lpVal * 10000n / _totalVal) : 0;
  _maxErr = Math.max(_maxErr, Math.abs(_lpApct - Math.round(lpPctRaw)));

  if (_maxErr <= 5 || outerIter >= 5) return null;

  // Deduct locked token value from total
  let lockedTotalVal = 0n;
  if (state._lockedMask) {
    for (let j = 0; j < maxTokensAddrs.length; j++) {
      if (state._lockedMask[j]) {
        const sym = symByAddrLookup(maxTokensAddrs[j], state);
        if (sym) lockedTotalVal += state._lockedAmounts[j] * spotPrice(sym, state) / SCALE;
      }
    }
  }
  const freeTotalVal = _totalVal > lockedTotalVal ? _totalVal - lockedTotalVal : 0n;

  // Compute free-only percentage sum
  let freePctSum = 0;
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    if (state._lockedMask && state._lockedMask[j]) continue;
    const sym = symByAddrLookup(maxTokensAddrs[j], state);
    if (sym) { const p = dom.getSliderPct(sym); if (p > 0) freePctSum += p; }
  }

  const newBase = [];
  for (let j = 0; j < maxTokensAddrs.length; j++) {
    const sym = symByAddrLookup(maxTokensAddrs[j], state);
    if (!sym) { newBase.push(1n); continue; }
    if (state._lockedMask && state._lockedMask[j]) { newBase.push(state._lockedAmounts[j] || 1n); continue; }
    const pct = dom.getSliderPct(sym);
    if (pct <= 0 || freePctSum <= 0) { newBase.push(1n); continue; }
    const price = spotPrice(sym, state);
    const targetVal = freeTotalVal * BigInt(Math.round(pct * 100)) / BigInt(Math.round(freePctSum * 100));
    const amt = price > 0n ? targetVal * SCALE / price : 0n;
    newBase.push(amt > 0n ? amt : 1n);
  }

  return optimizeSwap(order, quoteFn, state, dom, newBase, outerIter + 1);
}

// ── D3 Mixed LP + Tokens ─────────────────────────────────────────────────────

async function optimizeMixedLpTokens(order, baseTokenAmounts, maxTokensAddrs,
                                      state, quoteFn, recvAmounts,
                                      lpPctRaw, lpDecimals, allSyms,
                                      giveAmounts, lpGive, sliderPcts,
                                      tokenRatios, pctByIdx,
                                      iterations, outerIter) {
  const d2Result = await quoteWithNetting(
    { ...order, tokensOut: maxTokensAddrs,
      amountsOut: clampOuts(baseTokenAmounts.map(a => BigInt(a)), maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn),
      sharesIn: order.sharesIn }, quoteFn);
  const qZeroResult = await quoteWithNetting(
    { ...order, tokensOut: maxTokensAddrs, amountsOut: baseTokenAmounts.map(() => 0n), sharesIn: order.sharesIn }, quoteFn);

  iterations.push({ iter: iterations.length, reciprocity: d2Result.reciprocity, amounts: {}, label: 'D2: pure tokens' });
  iterations.push({ iter: iterations.length, reciprocity: qZeroResult.reciprocity, amounts: {}, label: 'qZero: scale=0' });

  // Negative reciprocity at α=1 is handled by secant — LP% clamps to 0,
  // giving f(1) < 0, bracketed against f(0) ≈ 1000 - target > 0.
  if (d2Result.quote == null) {
    return { wouldRevert: true, reason: 'Requested amounts exceed pool capacity.' };
  }

  const lpAtOne = computeLpPct(d2Result.reciprocity, d2Result.quote.amountsOut, order.sharesIn, d2Result.quote.tokensOut,
    maxTokensAddrs, state, order, recvAmounts);

  if (Math.abs(lpAtOne - lpPctRaw) <= LP_TOLERANCE) {
    const clamped = clampOuts(baseTokenAmounts.map(a => BigInt(a)),
      maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);
    const nr = await netAndRebalance(order, clamped, 0n, maxTokensAddrs, quoteFn);
    return { order: nr.order, quote: d2Result.quote, reciprocity: nr.adjusted ? nr.reciprocity : d2Result.reciprocity,
      converged: true, iterations, alpha: ALPHA_DENOM, alphaPct: 10000, lpTarget: 0n, fanRounds: 0 };
  }

  const secantState = createSecantState();
  secantState.bestTokens = baseTokenAmounts.map(() => 0n);
  const { fanRounds } = await secantSearch(baseTokenAmounts, maxTokensAddrs, state, order, quoteFn, recvAmounts,
    lpPctRaw, d2Result, qZeroResult, lpAtOne, secantState, iterations);

  await ratioBalanceSecant(secantState, maxTokensAddrs, tokenRatios, pctByIdx, state, order, quoteFn, recvAmounts,
    lpPctRaw, iterations);

  if (secantState.bestSd === 0n && secantState.bestTokens && secantState.bestTokens.every(t => t === 0n)
      && lpPctRaw > 0 && d2Result.quote && d2Result.reciprocity >= 0n) {
    secantState.bestQuote = d2Result.quote;
    secantState.bestSd = d2Result.reciprocity;
    secantState.bestTokens = clampOuts(baseTokenAmounts.map(a => BigInt(a)),
      maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);
    secantState.bestError = 0;
    secantState.converged = true;
  }

  if (!secantState.bestQuote) {
    return { wouldRevert: true, reason: 'Pool cannot satisfy requested LP/token ratio.' };
  }

  const sd = secantState.bestSd;
  const finalMinShares = sd > 10n ** BigInt(Math.max(0, lpDecimals - 2)) ? sd * 995n / 1000n : 0n;
  const bestTokens = secantState.bestTokens || [];

  const nr2 = await netAndRebalance(order, bestTokens, finalMinShares, maxTokensAddrs, quoteFn);
  const netSd2 = nr2.adjusted ? nr2.reciprocity : sd;

  const recurse = await outerConvergence(secantState, maxTokensAddrs, pctByIdx, state, order, quoteFn, recvAmounts,
    lpPctRaw, netSd2, allSyms, lpDecimals, giveAmounts, lpGive, sliderPcts, iterations, outerIter);
  if (recurse) return recurse;

  return { order: nr2.order, quote: secantState.bestQuote, reciprocity: netSd2,
    converged: secantState.converged, iterations, alpha: ALPHA_DENOM, alphaPct: 10000,
    lpTarget: finalMinShares, fanRounds: fanRounds || 0 };
}

// ── Main Entry Point ─────────────────────────────────────────────────────────

async function optimizeSwap(order, quoteFn, state, dom, precomputedBase, outerIter = 0) {
  const iterations = [];

  // Build locked info from DOM
  const lockedSyms = state.lockedRecv || new Set();
  const lockedMask = [];
  const lockedAmounts = [];
  for (const s of state.ALL_SYMS) {
    if (s === 'lp') continue;
    if (lockedSyms.has(s)) {
      const rv = dom.readRecv(s);
      lockedMask.push(true);
      lockedAmounts.push(rv || 0n);
    } else {
      lockedMask.push(false);
      lockedAmounts.push(0n);
    }
  }
  const hasLpLock = lockedSyms.has('lp');
  const lockedLpAmt = hasLpLock ? (dom.readRecvLp() || 0n) : 0n;

  // Set ephemeral state for sub-functions
  state._lockedMask = lockedMask;
  state._lockedAmounts = lockedAmounts;
  state._lockedLpAmt = hasLpLock ? lockedLpAmt : null;

  const lpPct = dom.getSliderPct('lp');
  const lpPctRaw = Math.round(lpPct * 100);

  const tokenSyms = [];
  const pctByIdx = [];
  for (const s of state.ALL_SYMS) {
    if (s === 'lp') continue;
    const pct = dom.getSliderPct(s);
    if (pct > 0) { tokenSyms.push(s); pctByIdx.push(pct); }
  }

  const maxTokensAddrs = tokenSyms.map(s => state.TOKEN_MAP[s].addr);

  // Build locked mask for the active token set
  state._lockedMask = tokenSyms.map((s, i) => lockedSyms.has(s));
  state._lockedAmounts = tokenSyms.map((s, i) => lockedSyms.has(s) ? (dom.readRecv(s) || 0n) : 0n);

  // Renormalize ratios to free-only tokens
  const freePctTotal = pctByIdx.reduce((sum, p, i) => !state._lockedMask[i] ? sum + p : sum, 0);
  const tokenRatios = freePctTotal > 0 ? pctByIdx.map(p => p / freePctTotal) : [];

  let baseTokenAmounts = precomputedBase ? [...precomputedBase] : [];
  if (tokenSyms.length > 0 && !precomputedBase) {
    baseTokenAmounts = computeBaseTokenAmounts(state, dom, order, tokenSyms, pctByIdx, state._lockedMask, state._lockedAmounts);
  }

  if (tokenSyms.length === 0 && lpPctRaw === 0) {
    delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
    return { wouldRevert: true, reason: 'Nothing requested. Set a receive percentage.' };
  }

  // All tokens locked — single quote with fixed amounts
  if (tokenSyms.length > 0 && state._lockedMask.every(Boolean)) {
    const clamped = clampOuts(state._lockedAmounts, maxTokensAddrs, state.poolCache.balances, order.tokensIn, order.amountsIn);
    const q = await quoteWithNetting(
      { ...order, tokensOut: maxTokensAddrs, amountsOut: clamped, sharesIn: order.sharesIn }, quoteFn);
    if (!q.quote || q.reciprocity < 0n) {
      delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
      return { wouldRevert: true, reason: 'Pool cannot satisfy locked amounts.' };
    }
    const finalSd = q.reciprocity;
    const nr = await netAndRebalance(order, clamped, 0n, maxTokensAddrs, quoteFn);
    delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
    return { order: nr.order, quote: q.quote, reciprocity: nr.adjusted ? nr.reciprocity : finalSd,
      converged: true, iterations, alpha: ALPHA_DENOM, alphaPct: 10000, lpTarget: 0n, fanRounds: 0 };
  }

  // D1: Pure LP
  if (tokenSyms.length === 0) {
    const lpOrder = { tokensIn: order.tokensIn, amountsIn: order.amountsIn, sharesIn: order.sharesIn, minSharesOut: 0n };
    const r = await quoteWithNetting(lpOrder, quoteFn);
    iterations.push({ iter: iterations.length, reciprocity: r.reciprocity, amounts: {}, label: 'D1: pure LP' });
    if (hasLpLock) {
      if (r.reciprocity < lockedLpAmt) {
        delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
        return { wouldRevert: true, reason: 'Pool cannot produce requested LP amount.' };
      }
      const minShares = lockedLpAmt > 10n ** BigInt(Math.max(0, state.LP_DECIMALS - 2)) ? lockedLpAmt * 995n / 1000n : 0n;
      const final = { tokensIn: order.tokensIn, amountsIn: order.amountsIn, sharesIn: order.sharesIn, minSharesOut: minShares };
      delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
      return { order: netOverlappingTokens(final), quote: r.quote, reciprocity: lockedLpAmt,
        converged: true, iterations, alpha: ALPHA_DENOM, alphaPct: 10000, lpTarget: minShares, fanRounds: 0 };
    }
    const targetLP = r.reciprocity > 0n ? r.reciprocity * BigInt(lpPctRaw) / 10000n : 0n;
    if (r.reciprocity < targetLP) {
      delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
      return { wouldRevert: true, reason: 'Pool state prevents requested LP amount.' };
    }
    const minShares = r.reciprocity > 10n ** BigInt(Math.max(0, state.LP_DECIMALS - 2)) ? r.reciprocity * 995n / 1000n : 0n;
    const final = { tokensIn: order.tokensIn, amountsIn: order.amountsIn, sharesIn: order.sharesIn, minSharesOut: minShares };
    delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
    return { order: netOverlappingTokens(final), quote: r.quote, reciprocity: r.reciprocity,
      converged: true, iterations, alpha: ALPHA_DENOM, alphaPct: 10000, lpTarget: minShares, fanRounds: 0 };
  }

  // D2 / D3 dispatch
  const recvAmounts = {};
  for (const s of state.ALL_SYMS) {
    if (s === 'lp') continue;
    const rv = dom.readRecv(s);
    if (rv && rv > 0n) recvAmounts[s] = rv;
  }

  let result;
  if (lpPctRaw === 0) {
    result = await optimizePureTokens(order, baseTokenAmounts, maxTokensAddrs, state, quoteFn, iterations, tokenRatios);
  } else {
    result = await optimizeMixedLpTokens(order, baseTokenAmounts, maxTokensAddrs, state, quoteFn, recvAmounts,
      lpPctRaw, state.LP_DECIMALS, state.ALL_SYMS, null, null, null,
      tokenRatios, pctByIdx, iterations, outerIter);
  }
  delete state._lockedMask; delete state._lockedAmounts; delete state._lockedLpAmt;
  return result;
}
