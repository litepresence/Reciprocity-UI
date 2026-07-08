// SPDX-License-Identifier: MIT
function createState() {
  return {
    TOKENS: [], LP_ADDR: '', LP_SYMBOL: 'LP', LP_DECIMALS: 18,
    ALL_SYMS: [], TOKEN_MAP: {},
    balEl: {}, poolEl: {},
    poolCache: {
      tvwapK: null, prices: {}, balances: {}, supply: null,
      timestamp: 0,
      fetching: false, balanceProportions: null,
    },
    ratioLock: false, debounceTimer: null, giveDefaultsApplied: false, lockedRecv: new Set(),
    poolAddr: '', factoryAddr: '', lastMode: '',
    lastNonce: 0, pollingTimer: null,
    currentBlock: null, lastTxBlock: null,
    tvwapWindowIdx: 1,
    pools: [], activePoolAddr: '', viewMode: 'single',
  };
}

function _safeStringify(obj) {
  return JSON.stringify(obj, (_, v) => typeof v === 'bigint' ? v.toString() + 'n' : v);
}
window._safeStringify = _safeStringify;

function fmt(val, dec) {
  if (typeof val !== 'bigint') {
    val = BigInt(Math.round(Number(val) * 10 ** dec));
  }
  const neg = val < 0n;
  const abs = neg ? -val : val;
  const divisor = 10n ** BigInt(dec);
  const whole = abs / divisor;
  const remainder = abs % divisor;
  const wholeStr = whole.toString();
  const remStr = remainder.toString().padStart(dec, '0');

  if (whole > 0n) {
    const maxFrac = 8;
    const frac = remStr.slice(0, maxFrac).replace(/0+$/, '');
    const w = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '\u2212' : '') + w + (frac ? '.' + frac : '');
  }

  let start = 0;
  while (start < remStr.length && remStr[start] === '0') start++;
  const sig = remStr.slice(start, start + 6).replace(/0+$/, '');
  if (sig.length === 0) return (neg ? '\u2212' : '') + '0';
  return (neg ? '\u2212' : '') + '0.' + '0'.repeat(start) + sig;
}

function parseAmt(str, dec) {
  if (!str || str.trim() === '') return null;
  let cleaned = str.trim();
  const neg = cleaned.startsWith('-');
  if (neg) cleaned = cleaned.slice(1);
  cleaned = cleaned.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  if (parts[0] === '') parts[0] = '0';
  const whole = parts[0].replace(/^0+/, '') || '0';
  const frac = (parts[1] || '').padEnd(dec, '0').slice(0, dec);
  if (whole === '0' && /^0+$/.test(frac)) return 0n;
  const result = BigInt(whole + frac);
  return neg ? -result : result;
}

function shortenAddr(addr) {
  if (!addr) return '\u2014';
  return addr.slice(0, 6) + '\u2026' + addr.slice(-4);
}

function getPctMax(sym, state) {
  return 100;
}

function getPrice(sym, state) {
  const t = state.TOKEN_MAP[sym];
  if (!t) return SCALE;
  return state.poolCache.prices[t.addr.toLowerCase()] || SCALE;
}

// ponytail: spot price from pool balances — matches the GMP invariant.
// TVWAP/SCALE prices are meaningless for optimizer calculations in a pool
// with imbalanced quantities. Falls back to SCALE if pool data is missing.
function _spotPrice(sym, state) {
  const t = state.TOKEN_MAP[sym];
  if (!t) return SCALE;
  const bal = state.poolCache.balances[t.addr.toLowerCase()];
  if (!bal || bal <= 0n) return SCALE;
  const baseBal = state.poolCache.balances[state.TOKENS[0]?.addr?.toLowerCase()];
  if (!baseBal || baseBal <= 0n) return SCALE;
  // price of sym in terms of first token: how much base you get for 1 sym
  return baseBal * SCALE / bal;
}

function anyTokenRecvActive(state, dom) {
  for (const t of state.TOKENS) {
    if (dom.getSliderPct(t.sym.toLowerCase()) > 0) return true;
  }
  return false;
}

function getMode(state, dom) {
  const lpGive = dom.readGiveLp();
  let hasTokenGive = false;
  let giveSyms = [];
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const g = dom.readGive(sym);
    if (g && g > 0n) { hasTokenGive = true; giveSyms.push(sym); }
  }
  const anyRecv = anyTokenRecvActive(state, dom);
  const lpPct = dom.getSliderPct('lp');
  const sliderPcts = {};
  for (const t of state.TOKENS) sliderPcts[t.sym.toLowerCase()] = dom.getSliderPct(t.sym.toLowerCase());
  const recvVals = {};
  for (const t of state.TOKENS) recvVals[t.sym.toLowerCase()] = dom.readRecv(t.sym.toLowerCase()) || 0n;
  let mode;
  if (lpGive && lpGive > 0n && !hasTokenGive) {
    if (anyRecv) mode = 'swap';
    else mode = 'withdraw';
  } else if (hasTokenGive && anyRecv) mode = 'swap';
  else mode = 'deposit';
  if (mode !== state.lastMode && state.lastMode) {
    console.log(`%c[getMode] %c${state.lastMode} → ${mode}`, 'color:#888', 'color:#a855f7;font-weight:bold',
      'lpGive=' + (lpGive ? lpGive.toString().slice(0,8) : 'null') + '...', 'hasTokenGive=' + hasTokenGive,
      'anyRecv=' + anyRecv, 'lpPct=' + lpPct, 'sliders=', sliderPcts, 'recv=', recvVals);
  }
  state.lastMode = mode;
  return mode;
}

function validate(state, dom) {
  const mode = getMode(state, dom);
  if (mode === 'deposit') {
    if (state.TOKENS.length > MAX_TOKENS) {
      dom.valMsg.textContent = 'Pool token count exceeds maximum supported';
      dom.valMsg.style.display = 'block';
      return false;
    }
    dom.valMsg.style.display = 'none'; return true;
  }
  if (!hasAnyRequest(state, dom)) { dom.valMsg.style.display = 'block'; return false; }
  dom.valMsg.style.display = 'none';
  return true;
}

function validateOrderLegal(order, poolBals) {
  if (order.tokensIn.length === 0 && order.sharesIn === 0n) return 'nothing given';
  if (order.tokensOut.length === 0 && order.minSharesOut === 0n) return 'nothing requested';

  // Pure token self-swap: giving exactly one token, wanting exactly that one token back
  if (order.sharesIn === 0n && order.minSharesOut === 0n &&
      order.tokensIn.length === 1 && order.tokensOut.length === 1 &&
      order.tokensIn[0].toLowerCase() === order.tokensOut[0].toLowerCase()) {
    return 'cannot give and receive the same token';
  }

  // Pure LP self-swap: giving LP, wanting LP back, no tokens involved
  if (order.tokensIn.length === 0 && order.tokensOut.length === 0 &&
      order.sharesIn > 0n && order.minSharesOut > 0n) {
    return 'cannot give LP and request LP in return';
  }

  return null;
}

function hasAnyRequest(state, dom) {
  for (const t of state.TOKENS) { if (dom.getSliderPct(t.sym.toLowerCase()) > 0) return true; const r = dom.readRecv(t.sym.toLowerCase()); if (r && r > 0n) return true; }
  if (dom.getSliderPct('lp') > 0) return true;
  const lpr = dom.readRecvLp(); if (lpr && lpr > 0n) return true;
  return false;
}

function buildOrderFromRatios(state, dom) {
  const tIn = [], aIn = [], tOut = [], aOut = [];
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const g = dom.readGive(sym);
    if (g && g > 0n) { tIn.push(t.addr); aIn.push(g); }
  }
  const lpGive = dom.readGiveLp();
  const sharesIn = lpGive || 0n;
  const lpPct = dom.getSliderPct('lp');
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const pct = dom.getSliderPct(sym);
    if (pct > 0) {
      tOut.push(t.addr);
      aOut.push(0n);
    }
  }
  const minSharesOut = sharesIn > 0n || lpPct <= 0 ? 0n : 1n;
  return { tokensIn: tIn, amountsIn: aIn, tokensOut: tOut, amountsOut: aOut, sharesIn, minSharesOut };
}


function redistributeRatios(changedSym, newPct, state, dom) {
  if (state.ratioLock) {
    console.log('%c[redist] %cBLOCKED ' + changedSym + ' → ' + newPct, 'color:#888', 'color:#e85858');
    return;
  }
  state.ratioLock = true;
  newPct = Math.max(0, newPct);
  newPct = Math.round(newPct * 10) / 10;

  if (changedSym === 'lp') {
    const prevLpPct = state._prevLpPct !== undefined ? state._prevLpPct : dom.getSliderPct('lp');
    const currLpPct = newPct;

    if (currLpPct === 0 && prevLpPct > 0.05 && state._savedTokenPcts) {
      for (const s of state.ALL_SYMS)
        if (s !== 'lp' && !state.lockedRecv.has(s)) {
          dom.setSliderPct(s, state._savedTokenPcts[s]);
          dom.setPctVal(s, state._savedTokenPcts[s]);
        }
      delete state._savedTokenPcts;
      state._prevLpPct = currLpPct;

      // Normalize after restore: only scale unlocked tokens
      let lockedSum = 0;
      let unlockedSum = 0;
      const curPcts = {};
      for (const s of state.ALL_SYMS) {
        const pct = dom.getSliderPct(s);
        curPcts[s] = pct;
        if (state.lockedRecv.has(s)) lockedSum += pct;
        else unlockedSum += pct;
      }
      const expected = 100 - lockedSum;
      if (Math.abs(unlockedSum - expected) > 0.01) {
        const scale = expected / unlockedSum;
        for (const s of state.ALL_SYMS) {
          if (state.lockedRecv.has(s)) continue;
          const norm = Math.round(curPcts[s] * scale * 10) / 10;
          dom.setSliderPct(s, norm);
          dom.setPctVal(s, norm);
        }
      }

      state.ratioLock = false;
      console.log('%c[redist] %crestore saved %c' + changedSym + ' → ' + newPct, 'color:#888', 'color:#3dcf8e', 'color:#f59e0b');
      return;
    }

    if (currLpPct > 0 && prevLpPct <= 0.05 && !state._savedTokenPcts) {
      const tokenVals = {};
      for (const s of state.ALL_SYMS)
        if (s !== 'lp') tokenVals[s] = dom.getSliderPct(s);
      const anyNonZero = Object.values(tokenVals).some(v => v > 0.05);
      if (anyNonZero) state._savedTokenPcts = tokenVals;
    }

    state._prevLpPct = currLpPct;
  }

  try {
    const beforePcts = {};
    for (const s of state.ALL_SYMS) beforePcts[s] = dom.getSliderPct(s);

    const others = state.ALL_SYMS.filter(s => s !== changedSym && !state.lockedRecv.has(s));
    const vals = {}, maxes = {};
    for (const s of others) { vals[s] = dom.getSliderPct(s); maxes[s] = dom.getPctMax(s); }

    const targetLockedSum = state.ALL_SYMS.reduce((sum, s) => {
      if (s !== changedSym && state.lockedRecv.has(s)) return sum + dom.getSliderPct(s);
      return sum;
    }, 0);
    const target = Math.max(0, 100 - newPct - targetLockedSum);
    const EPS = 0.05;

    for (let iter = 0; iter < 20; iter++) {
      const curSum = others.reduce((sum, s) => sum + vals[s], 0);
      let delta = Math.round((target - curSum) * 10) / 10;
      if (Math.abs(delta) < EPS) break;

      const movable = others.filter(s => delta > 0 ? vals[s] < maxes[s] - EPS : vals[s] > EPS);

      if (movable.length === 0) {
        const atZero = others.filter(s => vals[s] <= EPS);
        const atMax = others.filter(s => vals[s] >= maxes[s] - EPS);

        if (delta > 0) {
          if (atZero.length === others.length) {
            const share = target / others.length;
            for (const s of others) { const v = Math.min(share, maxes[s]); vals[s] = Math.round(v * 10) / 10; }
          }
        } else {
          if (atMax.length === others.length) {
            const sum = others.reduce((s, sym) => s + vals[sym], 0);
            if (sum > 0) { const scale = target / sum; for (const s of others) vals[s] = Math.round(vals[s] * scale * 100) / 100; }
          }
        }
        break;
      }

      const pinned = others.filter(s => !movable.includes(s));
      const pinnedSum = pinned.reduce((sum, s) => sum + vals[s], 0);
      const movableTarget = target - pinnedSum;
      const movableSum = movable.reduce((sum, s) => sum + vals[s], 0);

      let anyPinned = false;
      if (movableSum > 0) {
        const scale = movableTarget / movableSum;
        for (const s of movable) {
          const v = Math.round(vals[s] * scale * 100) / 100;
          const clamped = Math.max(0, Math.min(v, maxes[s]));
          if (Math.abs(clamped - v) > EPS) anyPinned = true;
          vals[s] = clamped;
        }
      } else if (delta > 0) {
        const share = movableTarget / movable.length;
        for (const s of movable) {
          vals[s] = Math.min(share, maxes[s]);
          if (share > maxes[s]) anyPinned = true;
        }
      }

      if (!anyPinned) break;
    }

    dom.setSliderPct(changedSym, newPct); dom.setPctVal(changedSym, newPct);
    for (const s of others) { dom.setSliderPct(s, vals[s]); dom.setPctVal(s, vals[s]); }

    // Normalize: ensure unlocked slider percentages fill the remaining allocation
    let lockedSum = 0;
    let unlockedSum = 0;
    const curPcts = {};
    for (const s of state.ALL_SYMS) {
      const pct = dom.getSliderPct(s);
      curPcts[s] = pct;
      if (state.lockedRecv.has(s)) lockedSum += pct;
      else unlockedSum += pct;
    }
    const expected = 100 - lockedSum;
    if (Math.abs(unlockedSum - expected) > 0.01) {
      const scale = expected / unlockedSum;
      for (const s of state.ALL_SYMS) {
        if (state.lockedRecv.has(s)) continue;
        const norm = Math.round(curPcts[s] * scale * 10) / 10;
        dom.setSliderPct(s, norm);
        dom.setPctVal(s, norm);
      }
    }

    const afterPcts = {};
    for (const s of state.ALL_SYMS) afterPcts[s] = dom.getSliderPct(s);
    if (Math.abs(afterPcts[changedSym] - newPct) > 0.1) {
      console.log('%c[redist] %cnorm ' + changedSym + ' → ' + newPct + ' (target ' + target + ')', 'color:#888', 'color:#3dcf8e',
        'after:', afterPcts);
    }
    console.log(`%c[redist] %c${changedSym} → ${newPct}`, 'color:#888', 'color:#f59e0b',
      'before:', beforePcts, 'after:', afterPcts);
  } finally {
    state.ratioLock = false;
  }
}

function computeTargetAmounts(state, dom) {
  if (state.poolCache.tvwapK === null || state.poolCache.tvwapK === undefined) return;
  if (state.ratioLock) {
    console.log('%c[comp] %cBLOCKED (ratioLock)', 'color:#888', 'color:#e85858');
    return;
  }
  try {
    state.ratioLock = true;

    let totalTokenGive = 0n;
    const giveMap = {};
    for (const t of state.TOKENS) {
      const sym = t.sym.toLowerCase();
      const g = dom.readGive(sym);
      if (g && g > 0n) {
        giveMap[sym] = g;
        const price = _spotPrice(sym, state);
        const val = g * price / SCALE;
        totalTokenGive += val;
      }
    }
    const lpGive = dom.readGiveLp();
    if (lpGive && lpGive > 0n) giveMap['lp'] = lpGive;

    if (getMode(state, dom) === 'withdraw') {
      const totalLP = state.poolCache.supply;
      if (totalLP && totalLP > 0n) {
        for (const s of state.ALL_SYMS) {
          if (s === 'lp') { dom.recvEl(s).value = ''; continue; }
          const t = state.TOKEN_MAP[s];
          const bal = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
          const recvAmt = bal * lpGive / totalLP;
          dom.recvEl(s).value = recvAmt > 0n ? fmt(recvAmt, t.dec) : '';
        }
      } else {
        for (const s of state.ALL_SYMS) dom.recvEl(s).value = '';
      }
      dom.updateUI(state, dom);
      return;
    }

    let poolValue = 0n;
    const supply = state.poolCache.supply;
    if (supply && supply > 0n) {
      for (const t of state.TOKENS) {
        const bal = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
        const p = _spotPrice(t.sym.toLowerCase(), state);
        poolValue += bal * p / SCALE;
      }
    }

    let totalGiveValue = totalTokenGive;
    if (lpGive && lpGive > 0n && supply && supply > 0n && poolValue > 0n) {
      totalGiveValue += lpGive * poolValue / supply;
    }

    if (totalGiveValue === 0n) {
      for (const s of state.ALL_SYMS) dom.recvEl(s).value = '';
      return;
    }

    let lockedValue = 0n;
    for (const s of state.ALL_SYMS) {
      if (!state.lockedRecv.has(s)) continue;
      if (s === 'lp') {
        const lockedLp = dom.readRecvLp();
        if (lockedLp && lockedLp > 0n && supply && supply > 0n && poolValue > 0n)
          lockedValue += lockedLp * poolValue / supply;
      } else {
        const t = state.TOKEN_MAP[s];
        const rv = dom.readRecv(s);
        if (rv && rv > 0n) {
          const price = _spotPrice(s, state);
          lockedValue += rv * price / SCALE;
        }
      }
    }

    let freePctSum = 0;
    for (const s of state.ALL_SYMS) {
      if (state.lockedRecv.has(s)) continue;
      const pct = dom.getSliderPct(s);
      if (pct > 0) freePctSum += pct;
    }

    const freeGiveValue = totalGiveValue > lockedValue ? totalGiveValue - lockedValue : 0n;

    const computed = {};
    for (const s of state.ALL_SYMS) {
      if (state.lockedRecv.has(s)) continue;
      const pct = dom.getSliderPct(s);
      if (pct <= 0) { dom.recvEl(s).value = ''; continue; }
      if (s === 'lp') {
        const targetValue = freeGiveValue > 0n && freePctSum > 0n ? freeGiveValue * BigInt(Math.round(pct * 100)) / BigInt(Math.round(freePctSum * 100)) : 0n;
        let lpAmt = targetValue;
        if (supply && supply > 0n && poolValue > 0n) lpAmt = targetValue * supply / poolValue;
        const val = lpAmt > 0n ? fmt(lpAmt, state.LP_DECIMALS) : '';
        dom.recvEl(s).value = val;
        computed[s] = { pct, value: lpAmt.toString(), display: val };
      } else {
        const t = state.TOKEN_MAP[s];
        const price = _spotPrice(s, state);
        const targetValue = freeGiveValue > 0n && freePctSum > 0n ? freeGiveValue * BigInt(Math.round(pct * 100)) / BigInt(Math.round(freePctSum * 100)) : 0n;
        const targetAmt = targetValue * SCALE / price;
        const val = targetAmt > 0n ? fmt(targetAmt, t.dec) : '';
        dom.recvEl(s).value = val;
        computed[s] = { pct, value: targetAmt.toString(), display: val };
      }
    }

    dom.updateUI(state, dom);
  } finally {
    state.ratioLock = false;
  }
}



