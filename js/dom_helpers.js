// SPDX-License-Identifier: MIT
// dom_helpers.js — DOM element getters/setters and slider helpers

const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

function giveRowEl(sym) { return document.querySelector(`.give-row[data-token="${sym}"]`); }
function requestRowEl(sym) { return document.querySelector(`.request-row[data-token="${sym}"]`); }
function giveEl(sym) { const r = giveRowEl(sym); return r ? r.querySelector('.give') : null; }
function recvEl(sym) { const r = requestRowEl(sym); return r ? r.querySelector('.recv') : null; }
function giveSliderEl(sym) { const r = giveRowEl(sym); return r ? r.querySelector('.give-slider') : null; }
function givePctEl(sym) { const r = giveRowEl(sym); return r ? r.querySelector('.give-pct') : null; }
function sliderEl(sym) { const r = requestRowEl(sym); return r ? r.querySelector('.slider') : null; }
function pctEl(sym) { const r = requestRowEl(sym); return r ? r.querySelector('.pct') : null; }
function getGiveSliderPct(sym) { return Number(giveSliderEl(sym).value); }
function setGiveSliderPct(sym, pct) {
  const el = giveSliderEl(sym);
  if (!el) return;
  el.value = Math.round(pct);
  el.style.setProperty('--pct', Math.round(pct) + '%');
}
function setGivePctDisplay(sym, pct) { givePctEl(sym).textContent = Math.round(pct) + '%'; }

function getSliderPct(sym) { return Number(sliderEl(sym).value) / 10; }
function setSliderPct(sym, pct) {
  const el = sliderEl(sym);
  const max = parseInt(el.max);
  const clamped = Math.min(Math.round(pct * 10), max);
  el.value = Math.max(0, clamped);
  el.style.setProperty('--pct', (clamped / max * 100) + '%');
}
function setPctVal(sym, pct) { pctEl(sym).value = Math.min(pct, getPctMax(sym, state)); }

function readGive(sym) { return parseAmt(giveEl(sym).value, (state.TOKEN_MAP[sym] || { dec: state.LP_DECIMALS }).dec); }
function readRecv(sym) { return parseAmt(recvEl(sym).value, (state.TOKEN_MAP[sym] || { dec: state.LP_DECIMALS }).dec); }
function readGiveLp() { return parseAmt(giveEl('lp').value, state.LP_DECIMALS); }
function readRecvLp() { return parseAmt(recvEl('lp').value, state.LP_DECIMALS); }

function isGiveSym(sym) {
  if (sym === 'lp') { const g = readGiveLp(); return g && g > 0n; }
  const t = state.TOKEN_MAP[sym];
  if (!t) return false;
  const g = readGive(sym);
  return g && g > 0n;
}

function lockBtnEl(sym) { const r = requestRowEl(sym); return r ? r.querySelector('.lock-btn') : null; }
function isLocked(sym) { return state.lockedRecv && state.lockedRecv.has(sym); }
function setLocked(sym, locked, state, dom) {
  if (locked) {
    state.lockedRecv.add(sym);
  } else {
    state.lockedRecv.delete(sym);
    recvEl(sym).value = '';
    setSliderPct(sym, 0);
    setPctVal(sym, 0);
  }
  const btn = lockBtnEl(sym);
  if (btn) { btn.innerHTML = locked ? LOCK_SVG : UNLOCK_SVG; btn.classList.toggle('locked', locked); }
  const inp = recvEl(sym);
  if (inp) inp.classList.toggle('locked', locked);
}

function updateDisabledState() {
  for (const s of state.ALL_SYMS) {
    const row = requestRowEl(s);
    if (!row) continue;
    row.classList.remove('disabled');
    sliderEl(s).disabled = false;
    pctEl(s).disabled = false;
  }
}

function buildDomRefs(dom) {
  dom.getSliderPct = getSliderPct;
  dom.setSliderPct = setSliderPct;
  dom.setPctVal = setPctVal;
  dom.getPctMax = (sym) => getPctMax(sym, state);
  dom.isGiveSym = isGiveSym;
  dom.readGive = readGive;
  dom.readRecv = readRecv;
  dom.readGiveLp = readGiveLp;
  dom.readRecvLp = readRecvLp;
  dom.recvEl = recvEl;
  dom.giveEl = giveEl;
  dom.isLocked = isLocked;
  dom.setLocked = (sym, locked) => setLocked(sym, locked, state, dom);
  dom.balEl = {};
  dom.poolEl = {};
}

function parseDisplayAmount(text, dec) {
  const parts = text.split('.');
  let raw = BigInt(parts[0].replace(/,/g, '')) * 10n ** BigInt(dec);
  if (parts.length > 1) {
    const frac = parts[1].padEnd(dec, '0').slice(0, dec);
    raw += BigInt(frac);
  }
  return raw;
}
