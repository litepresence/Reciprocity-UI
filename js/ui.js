// SPDX-License-Identifier: MIT
// ui.js — Slim bootstrap: initUI, URL params, event binding, state coordination

function updateUI() {
  const ok = validate(state, dom);
  const prevMode = state.lastMode;
  const mode = getMode(state, dom);
  if (mode !== prevMode) {
    logDev(`Mode: ${prevMode || 'none'} → ${mode}`, '#a855f7');
    state.lastMode = mode;
    if (prevMode) {
      log(`🔄 Switched to ${mode === 'deposit' ? 'deposit' : mode === 'withdraw' ? 'withdraw' : 'swap'} mode`, 'info');
    }
  }
  dom.executeBtn.disabled = !ok || !state.poolAddr;
  setActionLabel();
  clearTimeout(state.debounceTimer);
  if (ok && state.poolAddr) {
    state.debounceTimer = setTimeout(async () => {
      hideError();
      clearLog();
      dom.previewCard.classList.remove('visible');
      try {
        if (mode === 'deposit') await previewAdd();
        else if (mode === 'withdraw') await previewRemove();
        else await previewSwap();
      } catch (e) { log('Preview: ' + e.message, 'err'); }
    }, 1000);
  }
}

function updateUrlParams(poolAddr, factoryAddr) {
  const params = new URLSearchParams(window.location.search);
  if (poolAddr) params.set('pool', poolAddr);
  if (factoryAddr) params.set('factory', factoryAddr);
  const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
  window.history.replaceState({}, '', newUrl);
}

function loadUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const pool = params.get('pool');
  if (pool && _chainAPI.isValidAddress(pool)) return pool;
  return null;
}

function applyDefaults() {
  const params = new URLSearchParams(window.location.search);
  const chain = params.get('chain') || localStorage.getItem('reciprocity_chain') || 'evm';
  const factory = params.get('factory');
  const pool = params.get('pool');
  const network = params.get('network');

  document.getElementById('chain-select').value = chain;

  const factoryList = document.getElementById('factory-list');
  factoryList.innerHTML = '';
  if (_chainAPI.configs) {
    for (const key of Object.keys(_chainAPI.configs)) {
      const cfg = _chainAPI.configs[key];
      if (cfg.factory) {
        const opt = document.createElement('option');
        opt.value = cfg.factory;
        factoryList.appendChild(opt);
      }
    }
  }

  if (factory) {
    document.getElementById('factory-addr').value = factory;
  } else {
    const saved = localStorage.getItem('reciprocity_factory_addr');
    if (saved) document.getElementById('factory-addr').value = saved;
    else if (_chainAPI.defaultFactory) document.getElementById('factory-addr').value = _chainAPI.defaultFactory;
  }

  if (pool) {
    document.getElementById('pool-addr').value = pool;
  } else {
    const saved = localStorage.getItem('reciprocity_pool_addr');
    if (saved) document.getElementById('pool-addr').value = saved;
  }

  if (network) {
    document.getElementById('network-input').value = network;
  } else {
    const saved = localStorage.getItem('reciprocity_network');
    if (saved) document.getElementById('network-input').value = saved;
  }

  document.getElementById('factory-addr').disabled = false;
  document.getElementById('pool-addr').disabled = false;
  document.getElementById('discover-btn').disabled = false;
  document.getElementById('connect-pool-btn').disabled = false;
}

// ponytail: button works even when loadSDK fails — no chainAPI dependency
document.addEventListener('DOMContentLoaded', function() {
  const btn = document.getElementById('enter-engine-btn');
  const empty = document.getElementById('empty-dashboard');
  const form = document.getElementById('connection-form');
  if (btn && empty && form) {
    btn.addEventListener('click', function() {
      empty.style.display = 'none';
      form.style.display = 'block';
    });
  }
});

var _chainAPI = window.chainAPI;
let state = null;
let walletAccount = null;
const dom = {};

window.initUI = function initUI(api) {
  _chainAPI = api;
  state = createState();

  dom.output = document.getElementById('output');
  dom.executeBtn = document.getElementById('execute-btn');
  dom.previewCard = document.getElementById('preview-card');
  dom.previewContent = document.getElementById('preview-content');
  dom.verifyToggle = document.getElementById('verify-toggle');
  dom.detailsToggle = document.getElementById('details-toggle');
  dom.detailsCheckbox = document.getElementById('details-checkbox');
  dom.errorBanner = document.getElementById('error-banner');
  dom.errorTitle = document.getElementById('error-title');
  dom.errorMessage = document.getElementById('error-message');
  dom.valMsg = document.getElementById('validation-msg');

  buildDomRefs(dom);
  dom.updateUI = updateUI;

  let giveInputTimer;
  document.getElementById('give-container').addEventListener('input', (e) => {
    const row = e.target.closest('.give-row');
    if (!row) return;
    const sym = row.dataset.token;
    if (!state.giveDefaultsApplied) {
      const givingLp = sym === 'lp';
      const curGive = givingLp ? readGiveLp() : readGive(sym);
      if (curGive && curGive > 0n) {
        let allOthersZero = true;
        for (const t of state.TOKENS) {
          const s = t.sym.toLowerCase();
          if (s === sym) continue;
          const g = readGive(s);
          if (g && g > 0n) { allOthersZero = false; break; }
        }
        if (sym !== 'lp') {
          const lg = readGiveLp();
          if (lg && lg > 0n) allOthersZero = false;
        }
        if (allOthersZero) {
          state.giveDefaultsApplied = true;
          state.ratioLock = true;
          if (givingLp) {
            for (const t of state.TOKENS) {
              setSliderPct(t.sym.toLowerCase(), 0);
              setPctVal(t.sym.toLowerCase(), 0);
            }
            setSliderPct('lp', 0);
            setPctVal('lp', 0);
          } else {
            for (const t of state.TOKENS) {
              setSliderPct(t.sym.toLowerCase(), 0);
              setPctVal(t.sym.toLowerCase(), 0);
            }
            setSliderPct('lp', 100);
            setPctVal('lp', 100);
          }
          state.ratioLock = false;
        }
      }
    }

    if (e.target.classList.contains('give-slider')) {
      const pct = getGiveSliderPct(sym);
      setGiveSliderPct(sym, pct);
      setGivePctDisplay(sym, pct);
      const bal = dom.balEl[sym];
      if (bal && bal.textContent !== '\u2014' && bal.textContent !== '0') {
        const dec = sym === 'lp' ? state.LP_DECIMALS : state.TOKEN_MAP[sym].dec;
        const rawBal = parseDisplayAmount(bal.textContent, dec);
        const giveAmt = rawBal * BigInt(pct) / 100n;
        giveEl(sym).value = giveAmt > 0n ? fmt(giveAmt, dec).replace(/,/g, '') : '';
      }
      clearTimeout(giveInputTimer);
      giveInputTimer = setTimeout(() => {
        const mode = getMode(state, dom);
        const amt = readGive(sym);
      }, 300);
      refreshPoolCache().then(() => { updateDisabledState(); computeTargetAmounts(state, dom); });
    }

    if (e.target.classList.contains('give')) {
      const bal = dom.balEl[sym];
      if (bal && bal.textContent !== '\u2014' && bal.textContent !== '0') {
        const dec = sym === 'lp' ? state.LP_DECIMALS : state.TOKEN_MAP[sym].dec;
        const rawBal = parseDisplayAmount(bal.textContent, dec);
        const giveAmt = readGive(sym) || 0n;
        const pct = rawBal > 0n ? Number(giveAmt * 100n / rawBal) : 0;
        setGiveSliderPct(sym, pct);
        setGivePctDisplay(sym, pct);
      }
      clearTimeout(giveInputTimer);
      giveInputTimer = setTimeout(() => {
        const mode = getMode(state, dom);
        const amt = readGive(sym);
        const dec = sym === 'lp' ? state.LP_DECIMALS : state.TOKEN_MAP[sym].dec;
      }, 400);
      refreshPoolCache().then(() => { updateDisabledState(); computeTargetAmounts(state, dom); });
    }
  });

  let requestInputTimer;
  document.getElementById('request-container').addEventListener('input', (e) => {
    const row = e.target.closest('.request-row');
    if (!row) return;
    const sym = row.dataset.token;

    if (e.target.classList.contains('slider')) {
      if (state.ratioLock) return;
      const pct = getSliderPct(sym);
      setPctVal(sym, pct);
      const m0 = getMode(state, dom);
      redistributeRatios(sym, pct, state, dom);
      const m1 = getMode(state, dom);
      console.log(`%c[ui.slider] %c${sym}=${pct}`, 'color:#888', 'color:#f59e0b', 'mode:', m0, '→', m1);
      computeTargetAmounts(state, dom);
    }

    if (e.target.classList.contains('pct')) {
      if (state.ratioLock) return;
      let pct = parseFloat(pctEl(sym).value);
      if (isNaN(pct) || pct < 0) pct = 0;
      setSliderPct(sym, pct);
      const m0 = getMode(state, dom);
      redistributeRatios(sym, pct, state, dom);
      const m1 = getMode(state, dom);
      console.log(`%c[ui.pct] %c${sym}=${pct}`, 'color:#888', 'color:#f59e0b', 'mode:', m0, '→', m1);
      computeTargetAmounts(state, dom);
    }

    if (e.target.classList.contains('recv')) {
      if (state.ratioLock || !state.poolCache.tvwapK) return;

      // Locked: update slider for display, but don't redistribute
      if (dom.isLocked(sym)) {
        const r = readRecv(sym);
        if (!r || r === 0n) {
          setSliderPct(sym, 0);
          setPctVal(sym, 0);
        } else {
          let totalGiveValue = 0n;
          for (const t of state.TOKENS) {
            const s = t.sym.toLowerCase();
            const g = readGive(s);
            if (g && g > 0n) {
              const price = _spotPrice(s, state);
              totalGiveValue += g * price / SCALE;
            }
          }
          const lpGive = readGiveLp();
          if (lpGive && lpGive > 0n) totalGiveValue += lpGive;
          if (totalGiveValue > 0n) {
            let impliedPct;
            if (sym === 'lp') {
              impliedPct = Number(r) / Number(totalGiveValue) * 100;
            } else {
              const price = _spotPrice(sym, state);
              impliedPct = Number(r * price / SCALE) / Number(totalGiveValue) * 100;
            }
            setSliderPct(sym, Math.max(0, Math.min(100, impliedPct)));
            setPctVal(sym, Math.max(0, Math.min(100, impliedPct)));
          }
        }
        clearTimeout(requestInputTimer);
        requestInputTimer = setTimeout(() => { computeTargetAmounts(state, dom); }, 400);
        return;
      }

      const r = readRecv(sym);
      if (!r || r === 0n) {
        console.log(`%c[ui.recv] %c${sym}=0 (clearing slider)`, 'color:#888', 'color:#f59e0b');
        setSliderPct(sym, 0);
        setPctVal(sym, 0);
        redistributeRatios(sym, 0, state, dom);
        computeTargetAmounts(state, dom);
        return;
      }
      let totalGiveValue = 0n;
      for (const t of state.TOKENS) {
        const s = t.sym.toLowerCase();
        const g = readGive(s);
        if (g && g > 0n) {
          const price = _spotPrice(s, state);
          totalGiveValue += g * price / SCALE;
        }
      }
      const lpGive = readGiveLp();
      if (lpGive && lpGive > 0n) totalGiveValue += lpGive;
      if (totalGiveValue === 0n) return;

      let impliedPct;
      if (sym === 'lp') {
        impliedPct = Number(r) / Number(totalGiveValue) * 100;
      } else {
        const price = _spotPrice(sym, state);
        const val = r * price / SCALE;
        impliedPct = Number(val) / Number(totalGiveValue) * 100;
      }
      impliedPct = Math.max(0, Math.min(100, impliedPct));
      clearTimeout(requestInputTimer);
      requestInputTimer = setTimeout(() => {
        computeTargetAmounts(state, dom);
      }, 400);
      setSliderPct(sym, impliedPct);
      setPctVal(sym, impliedPct);
      redistributeRatios(sym, impliedPct, state, dom);

      if (state.poolAddr && state.poolCache.tvwapK && !state.ratioLock) {
        const lpPct = getSliderPct('lp');
        for (const s of state.ALL_SYMS) {
          if (s === sym || dom.isLocked(s)) continue;
          const pct = getSliderPct(s);
          if (pct <= 0) { recvEl(s).value = ''; continue; }
          if (s === 'lp') {
            const targetValue = totalGiveValue * BigInt(Math.round(pct * 100)) / 10000n;
            recvEl(s).value = targetValue > 0n ? fmt(targetValue, state.LP_DECIMALS).replace(/,/g, '') : '';
          } else {
            const t = state.TOKEN_MAP[s];
            const price = _spotPrice(s, state);
            const targetValue = totalGiveValue * BigInt(Math.round(pct * 100)) / 10000n;
            const targetAmt = targetValue * SCALE / price;
            recvEl(s).value = targetAmt > 0n ? fmt(targetAmt, t.dec).replace(/,/g, '') : '';
          }
        }
      }
    }
  });

  document.getElementById('request-container').addEventListener('click', (e) => {
    const btn = e.target.closest('.lock-btn');
    if (btn) {
      const sym = btn.dataset.token;
      if (dom.isLocked(sym)) {
        dom.setLocked(sym, false);
        redistributeRatios(sym, 0, state, dom);
      } else {
        if (state.lockedRecv.size >= state.ALL_SYMS.length - 2) {
          log('At least two tokens must remain unlocked.', 'notice');
          computeTargetAmounts(state, dom);
          return;
        }
        dom.setLocked(sym, true);
        const rv = dom.readRecv(sym);
        if (rv && rv > 0n) {
          let totalGiveVal = 0n;
          for (const t of state.TOKENS) {
            const s = t.sym.toLowerCase();
            const g = dom.readGive(s);
            if (g && g > 0n) {
              const price = _spotPrice(s, state);
              totalGiveVal += g * price / SCALE;
            }
          }
          const lpGive = dom.readGiveLp();
          if (lpGive && lpGive > 0n) totalGiveVal += lpGive;
          if (totalGiveVal > 0n) {
            let impliedPct;
            if (sym === 'lp') {
              impliedPct = Number(rv) / Number(totalGiveVal) * 100;
            } else {
              const price = _spotPrice(sym, state);
              impliedPct = Number(rv * price / SCALE) / Number(totalGiveVal) * 100;
            }
            impliedPct = Math.max(0, Math.min(100, impliedPct));
            dom.setSliderPct(sym, impliedPct);
            dom.setPctVal(sym, impliedPct);
            redistributeRatios(sym, impliedPct, state, dom);
          }
        }
      }
      computeTargetAmounts(state, dom);
    }
  });

  document.getElementById('discover-btn').addEventListener('click', discoverPools);
  document.getElementById('connect-pool-btn').addEventListener('click', () => {
    const addr = document.getElementById('pool-addr').value.trim();
    if (addr) connectToPool(addr);
    else log('Enter a pool address.', 'warn');
  });

  document.getElementById('factory-addr').addEventListener('change', () => {
    const val = document.getElementById('factory-addr').value.trim();
    localStorage.setItem('reciprocity_factory_addr', val);
    updateUrlParams(document.getElementById('pool-addr').value.trim(), val);
    if (val && walletAccount) discoverPools();
  });
  document.getElementById('pool-addr').addEventListener('change', () => {
    const val = document.getElementById('pool-addr').value.trim();
    localStorage.setItem('reciprocity_pool_addr', val);
    updateUrlParams(val, document.getElementById('factory-addr').value.trim());
  });

  dom.executeBtn.addEventListener('click', async () => {
    if (!walletAccount) { log('Connect your wallet first.', 'warn'); return; }
    if (!state.poolAddr) { log('Connect to a pool first.', 'warn'); return; }
    clearLog();
    dom.previewCard.classList.remove('visible');
    const mode = getMode(state, dom);
    try {
      if (mode === 'deposit') await execAdd();
      else if (mode === 'withdraw') await execRemove();
      else await execSwap();
      await refreshPoolCache(true);
      await refreshAll();
    } catch (e) {
      const reason = parseRevertReason(e);
      showError('Transaction Failed', reason);
      log('TX failed: ' + reason, 'err');
    }
  });

  dom.detailsCheckbox.addEventListener('change', () => {
    if (dom.previewCard.classList.contains('visible') && getMode(state, dom) === 'swap') {
      clearTimeout(window._netTimer);
      window._netTimer = setTimeout(previewSwap, 100);
    }
  });

  var params = new URLSearchParams(window.location.search);
  var sel = document.getElementById('chain-select');
  sel.value = params.get('chain') || localStorage.getItem('reciprocity_chain') || 'evm';
  sel.style.backgroundImage = 'url(' + (_chainAPI.logo || sel.options[sel.selectedIndex].getAttribute('data-logo')) + ')';
  sel.addEventListener('change', function() {
    var opt = sel.options[sel.selectedIndex];
    const chain = sel.value;
    const net = document.getElementById('network-input').value.trim();
    localStorage.setItem('reciprocity_chain', chain);
    window.location.search = '?chain=' + chain + (net ? '&network=' + encodeURIComponent(net) : '');
  });

  var netInput = document.getElementById('network-input');
  netInput.addEventListener('change', function() {
    var val = netInput.value.trim();
    localStorage.setItem('reciprocity_network', val);
    window.location.search = '?chain=' + sel.value + (val ? '&network=' + encodeURIComponent(val) : '');
  });

  const savedView = localStorage.getItem('reciprocity_view_mode');
  if (savedView === 'single' || savedView === 'all') {
    state.viewMode = savedView;
  }
  document.querySelectorAll('.view-toggle .toggle-option').forEach(el => {
    if (el.dataset.view === state.viewMode) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
  document.querySelector('.view-toggle').addEventListener('click', (e) => {
    const opt = e.target.closest('.toggle-option');
    if (!opt || opt.classList.contains('active')) return;
    const view = opt.dataset.view;
    state.viewMode = view;
    localStorage.setItem('reciprocity_view_mode', view);
    document.querySelectorAll('.view-toggle .toggle-option').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
  });

  hideError();

  // Dashboard auto-show on saved/URL pool — needs chainAPI so stays inside initUI
  const autoPool = loadUrlParams();
  const savedPool = localStorage.getItem('reciprocity_pool_addr');
  if (autoPool || savedPool) {
    const empty = document.getElementById('empty-dashboard');
    const form = document.getElementById('connection-form');
    if (empty && form) { empty.style.display = 'none'; form.style.display = 'block'; }
  }

  // Progressive disclosure stepper
  function setStep(n) {
    state.step = n;
    document.querySelectorAll('#stepper .step').forEach(el => {
      const s = parseInt(el.dataset.step);
      el.classList.toggle('active', s === n);
      el.classList.toggle('done', s < n);
    });
    const headings = {
      1: 'Select a chain and connect your wallet',
      2: 'Enter a factory address or paste a pool address',
      3: 'Select a pool from the list',
      4: 'Configure your swap',
    };
    const headingEl = document.getElementById('step-heading');
    if (headingEl) headingEl.textContent = headings[n] || '';
    document.querySelectorAll('.step-section').forEach(el => {
      const req = parseInt(el.dataset.requires);
      el.classList.toggle('visible', req <= n);
    });
  }
  window.setStep = setStep;
  setStep(1);

  // Chart initialization
  document.querySelectorAll('.res-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.res-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (typeof updateChart === 'function') updateChart(btn.dataset.res);
    });
  });
  if (typeof initChart === 'function') initChart('chart-canvas');
}

// Connect button handler
const _connectBtn = document.getElementById('connect-btn');
if (_connectBtn) {
  _connectBtn.addEventListener('click', async () => {
    if (!_chainAPI) {
      log('Initializing SDK... please wait.', 'info');
      return;
    }
    try {
      log('🔌 Requesting wallet connection...', 'info');
      const wallet = await _chainAPI.connectWallet();
      document.getElementById('wallet-info').textContent = _chainAPI.shortenAddress(wallet.account) + ' | ' + wallet.networkName;
      _connectBtn.textContent = 'Connected';
      _connectBtn.disabled = true;
      clearLog();
      log('🔗 Connected: ' + _chainAPI.shortenAddress(wallet.account), 'ok');
      logDevGroup('Wallet Connected', '#3dcf8e', () => {
        console.log('  Account:', wallet.account);
        console.log('  Network:', wallet.networkName);
        console.log('  Chain:', _chainAPI.name, '| ID:', _chainAPI.chainId || '?');
        console.log('  RPC:', _chainAPI.defaultRpc || 'default');
        console.log('  Explorer:', _chainAPI.explorer || 'N/A');
      });
      walletAccount = wallet.account;
      if (typeof setStep === 'function') setStep(2);
      applyDefaults();
      const autoPool = loadUrlParams();
      if (autoPool) {
        await connectToPool(autoPool);
      }
      const factoryAddr = document.getElementById('factory-addr').value.trim();
      if (factoryAddr && _chainAPI.isValidAddress(factoryAddr)) {
        discoverPools();
      }
    } catch (e) {
      log('❗ Connect failed: ' + (e.message || e), 'err');
    }
  });
}
