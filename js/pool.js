// SPDX-License-Identifier: MIT
// pool.js — Pool discovery, connection, cache refresh, balance display

function setActionLabel() {
  const mode = getMode(state, dom);
  dom.executeBtn.textContent = mode === 'deposit' ? 'Deposit' : mode === 'withdraw' ? 'Withdraw' : 'Swap';
}

function buildTokenRows() {
  const giveContainer = document.getElementById('give-container');
  const requestContainer = document.getElementById('request-container');
  const walletBalances = document.getElementById('wallet-balances');
  const poolBalances = document.getElementById('pool-balances');

  dom.balEl = {};
  dom.poolEl = {};
  state.ALL_SYMS = [];

  let wHtml = '', pHtml = '', gHtml = '', rHtml = '';

  wHtml += `<div class="section-label">Pool Tokens</div>`;
  pHtml += `<div class="section-label">Pool Tokens</div>`;

  rHtml += `<div class="request-header">
      <span></span>
      <span class="header-label">AMOUNTS</span>
      <span class="header-label allocation">APPROXIMATE ALLOCATION</span>
      <span></span>
      <span></span>
    </div>`;

  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    state.ALL_SYMS.push(sym);
    wHtml += `<div class="row"><span class="sym">${t.sym}</span><span class="val" id="bal-${sym}">\u2014</span></div>`;
    pHtml += `<div class="row"><span class="sym">${t.sym}</span><span class="val" id="pool-${sym}">\u2014</span></div>`;
    gHtml += `<div class="give-row" data-token="${sym}">
        <span class="sym">${t.sym}</span>
        <input type="number" class="give" placeholder="0">
        <div class="slider-wrap"><input type="range" class="give-slider" min="0" max="100" value="0" step="1"></div>
        <div class="pct-display"><span class="give-pct">0%</span></div>
      </div>`;
    rHtml += `<div class="request-row" data-token="${sym}">
        <span class="sym">${t.sym}</span>
        <input type="number" class="recv" placeholder="0" data-linked>
        <div class="slider-wrap"><input type="range" class="slider" min="0" max="1000" value="0" step="1"></div>
        <div class="pct-wrap"><input type="number" class="pct" min="0" max="100" value="0" step="1"></div>
        <!-- LOCK BTN DISABLED for launch: <button class="lock-btn" data-token="${sym}" title="Lock amount">${state.lockedRecv?.has(sym) ? LOCK_SVG : UNLOCK_SVG}</button> -->
      </div>`;
  }

  gHtml += `<hr class="sep">`;
  rHtml += `<hr class="sep">`;

  state.ALL_SYMS.push('lp');

  wHtml += `<div class="section-label">Konstant Shares</div>`;
  pHtml += `<div class="section-label">Total Supply</div>`;

  wHtml += `<div class="row"><span class="sym" style="color:var(--accent)">${state.LP_SYMBOL}</span><span class="val" id="bal-lp">\u2014</span></div>`;
  pHtml += `<div class="row"><span class="sym">${state.LP_SYMBOL}</span><span class="val" id="pool-k">\u2014</span></div>`;

  gHtml += `<div class="give-row" data-token="lp">
      <span class="sym lp-sym">${state.LP_SYMBOL}</span>
      <input type="number" class="give" placeholder="0">
      <div class="slider-wrap"><input type="range" class="give-slider" min="0" max="100" value="0" step="1"></div>
      <div class="pct-display"><span class="give-pct">0%</span></div>
    </div>`;

  rHtml += `<div class="request-row" data-token="lp">
      <span class="sym lp-sym">${state.LP_SYMBOL}</span>
      <input type="number" class="recv" placeholder="0" data-linked>
      <div class="slider-wrap"><input type="range" class="slider" min="0" max="1000" value="1000" step="1"></div>
      <div class="pct-wrap"><input type="number" class="pct" min="0" max="100" value="100" step="0.1"></div>
      <!-- LOCK BTN DISABLED for launch: <button class="lock-btn" data-token="lp" title="Lock amount">${state.lockedRecv?.has('lp') ? LOCK_SVG : UNLOCK_SVG}</button> -->
    </div>`;

  walletBalances.innerHTML = wHtml;
  poolBalances.innerHTML = pHtml;
  giveContainer.innerHTML = gHtml;
  requestContainer.innerHTML = rHtml;

  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    dom.balEl[sym] = document.getElementById(`bal-${sym}`);
    dom.poolEl[sym] = document.getElementById(`pool-${sym}`);
  }
  dom.balEl['lp'] = document.getElementById('bal-lp');
  dom.poolEl['k'] = document.getElementById('pool-k');

  state.TOKEN_MAP = Object.fromEntries(state.TOKENS.map(t => [t.sym.toLowerCase(), t]));
}

function initRatioDefaults() {
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    setSliderPct(sym, 0); setPctVal(sym, 0);
    setGiveSliderPct(sym, 0); setGivePctDisplay(sym, 0);
  }
  setSliderPct('lp', 100); setPctVal('lp', 100);
  setGiveSliderPct('lp', 0); setGivePctDisplay('lp', 0);
}

async function refreshPoolCache(force) {
  if (!state.poolAddr || state.poolCache.fetching) return;
  if (!force && state.poolCache.timestamp && (Date.now() - state.poolCache.timestamp) < CACHE_TTL_MS) return;
  state.poolCache.fetching = true;
  const cacheStart = performance.now();
  try {
    const [bals, st] = await Promise.all([
      _chainAPI.getBalances(state.poolAddr),
      _chainAPI.getStatus(state.poolAddr),
    ]);
    const bt = bals.tokens || bals[0], ba = bals.amounts || bals[1];
    state.poolCache.balances = {};
    bt.forEach((addr, i) => { state.poolCache.balances[addr.toLowerCase()] = BigInt(ba[i]); });
    state.poolCache.supply = st.supply !== undefined ? BigInt(st.supply) : BigInt(st[0]);
    state.poolCache.tvwapK = await _chainAPI.getKonstant(state.poolAddr).catch(() => null);

    const tvwapResult = await _chainAPI.getTvwapPrices(state.poolAddr, TVWAP_WINDOWS[state.tvwapWindowIdx]).catch(() => null);
    state.poolCache.prices = {};
    if (tvwapResult) {
      const tvwapTokens = tvwapResult.tokens || tvwapResult[0];
      const tvwapPrices = tvwapResult.prices || tvwapResult[1];
      const rawPrices = {};
      tvwapTokens.forEach((addr, i) => { rawPrices[addr.toLowerCase()] = BigInt(tvwapPrices[i]); });
      const baseAddr = state.TOKENS.length > 0 ? state.TOKENS[0].addr.toLowerCase() : null;
      const baseRaw = baseAddr ? rawPrices[baseAddr] : null;
      if (baseRaw && baseRaw > 0n) {
        for (const addr of Object.keys(rawPrices)) {
          state.poolCache.prices[addr] = rawPrices[addr] * SCALE / baseRaw;
        }
      } else {
        for (const addr of Object.keys(rawPrices)) {
          state.poolCache.prices[addr] = rawPrices[addr];
        }
      }
    }

    state.poolCache.timestamp = Date.now();

    const cacheMs = (performance.now() - cacheStart).toFixed(0);
    logDev(`Cache · ${cacheMs}ms`, '#2d7cf0');

    const poolEntry = state.pools.find(p => p.poolAddr.toLowerCase() === state.poolAddr.toLowerCase());
    if (poolEntry) {
      poolEntry.TOKENS = state.TOKENS;
      poolEntry.LP_ADDR = state.LP_ADDR;
      poolEntry.LP_SYMBOL = state.LP_SYMBOL;
      poolEntry.LP_DECIMALS = state.LP_DECIMALS;
      poolEntry.poolCache = state.poolCache;
    }
  } catch (e) {
    console.warn('Cache refresh failed:', e);
  }
  state.poolCache.fetching = false;
}

function scaleSlidersToBalances() {
  if (state.ratioLock) return;
  if (!state.poolCache.balances) return;
  let totalValue = 0n;
  const values = {};
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const bal = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
    const price = _spotPrice(sym, state);
    const val = bal * price / SCALE;
    values[sym] = val;
    totalValue += val;
  }
  if (totalValue === 0n) return;
  const props = {};
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const frac = Number(values[sym] * 10000n / totalValue) / 10000;
    props[sym] = frac;
    sliderEl(sym).max = 1000;
    const pct = frac * 100;
    setSliderPct(sym, pct);
    setPctVal(sym, pct);
  }
  props['lp'] = 0;
  sliderEl('lp').max = 1000;
  state.poolCache.balanceProportions = props;
  setSliderPct('lp', 0);
  setPctVal('lp', 0);
  redistributeRatios('lp', 0, state, dom);
  computeTargetAmounts(state, dom);
}

function renderLpAnalytics() {
  const el = document.getElementById('lp-analytics');
  const valueEl = document.getElementById('lp-value');
  const shareEl = document.getElementById('lp-share');
  if (!el || !walletAccount) { if (el) el.style.display = 'none'; return; }

  const lpBal = dom.balEl.lp;
  if (!lpBal || lpBal.textContent === '\u2014' || lpBal.textContent === '0' || lpBal.textContent === '?') {
    el.style.display = 'none'; return;
  }

  const lpAmount = readGiveLp() || 0n;
  if (lpAmount <= 0n && (!dom.balEl.lp || dom.balEl.lp.textContent === '\u2014')) {
    el.style.display = 'none'; return;
  }

  el.style.display = 'block';
  const supply = state.poolCache.supply || 1n;

  let poolValue = 0n;
  for (const t of state.TOKENS) {
    const bal = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
    const price = getPrice(t.sym.toLowerCase(), state);
    poolValue += bal * price / SCALE;
  }

  const userLpRaw = dom.balEl.lp ? parseDisplayAmount(dom.balEl.lp.textContent, state.LP_DECIMALS) : 0n;
  const myValue = supply > 0n ? userLpRaw * poolValue / supply : 0n;
  const sharePct = supply > 0n ? Number(userLpRaw * 10000n / supply) / 100 : 0;

  if (valueEl) valueEl.textContent = myValue > 0n ? fmt(myValue, 18) + ' (est)' : '—';
  if (shareEl) shareEl.textContent = sharePct > 0 ? sharePct.toFixed(4) + '%' : '—';
}

async function refreshAll() {
  if (!state.poolAddr) return;
  const refreshStart = performance.now();
  try {
    if (walletAccount) {
      for (const t of state.TOKENS) {
        const sym = t.sym.toLowerCase();
        const el = dom.balEl[sym];
        if (!el) continue;
        try {
          const bal = await _chainAPI.getTokenBalance(t.addr, walletAccount);
          el.textContent = fmt(bal, t.dec);
        } catch {
          el.textContent = '?';
        }
      }
      if (state.LP_ADDR && dom.balEl.lp) {
        try {
          const bal = await _chainAPI.getTokenBalance(state.LP_ADDR, walletAccount);
          dom.balEl.lp.textContent = fmt(bal, state.LP_DECIMALS);
        } catch { }
      }
    }
    for (const t of state.TOKENS) {
      const sym = t.sym.toLowerCase();
      const el = dom.poolEl[sym];
      if (!el) continue;
      try {
        const bal = await _chainAPI.getPoolTokenBalance(t.addr, state.poolAddr);
        el.textContent = fmt(bal, t.dec);
      } catch {
        el.textContent = '?';
      }
    }
    if (state.poolAddr) {
      try {
        const totalSupply = await _chainAPI.getSupply(state.poolAddr);
        if (dom.poolEl.k) dom.poolEl.k.textContent = fmt(totalSupply, state.LP_DECIMALS);
      } catch {}
    }
    for (const sym of state.ALL_SYMS) {
      const bal = dom.balEl[sym];
      if (bal && bal.textContent !== '\u2014' && bal.textContent !== '0') {
        const dec = sym === 'lp' ? state.LP_DECIMALS : state.TOKEN_MAP[sym].dec;
        const rawBal = parseDisplayAmount(bal.textContent, dec);
        const giveAmt = readGive(sym) || 0n;
        const pct = rawBal > 0n ? Number(giveAmt * 100n / rawBal) : 0;
        setGiveSliderPct(sym, pct);
        setGivePctDisplay(sym, pct);
      }
    }
    const refreshMs = (performance.now() - refreshStart).toFixed(0);
    logDev('UI refresh', { timeMs: refreshMs });
    renderLpAnalytics();
  } catch (e) { log('Refresh: ' + e.message, 'err'); }
}

async function setActivePool(poolAddr) {
  const pool = state.pools.find(p => p.poolAddr.toLowerCase() === poolAddr.toLowerCase());
  if (!pool) { connectToPool(poolAddr); return; }
  state.poolAddr = pool.poolAddr;
  state.TOKENS = pool.TOKENS;
  state.LP_ADDR = pool.LP_ADDR;
  state.LP_SYMBOL = pool.LP_SYMBOL;
  state.LP_DECIMALS = pool.LP_DECIMALS;
  state.weights = pool.weights || [];
  state.poolCache = pool.poolCache;
  state.activePoolAddr = poolAddr;
  state.giveDefaultsApplied = false;
  state.lockedRecv = new Set();

  buildTokenRows();
  initRatioDefaults();
  updateDisabledState();

  document.getElementById('status-lp').textContent = state.LP_ADDR || 'N/A';
  document.getElementById('status-assets').textContent = state.TOKENS.map(t => t.sym).join(', ') + ` (${state.TOKENS.length} assets)`;

  const weightEl = document.getElementById('status-weights');
  if (weightEl) {
    if (state.weights && state.weights.length > 0 && state.weights.some(w => w > 0n)) {
      const weightHtml = state.TOKENS.map((t, i) => {
        const w = state.weights[i];
        const cls = w === 1n ? 'weight-equal' : 'weight-unequal';
        return `<span class="${cls}">${t.sym}: ${w}</span>`;
      }).join(', ');
      weightEl.innerHTML = weightHtml;
    } else {
      weightEl.textContent = 'N/A';
    }
  }

  updateUrlParams(poolAddr, document.getElementById('factory-addr').value.trim());
  computeTargetAmounts(state, dom);
  updateUI();
  if (typeof setStep === 'function') setStep(4);
}

async function loadFullPoolData(addr) {
  try {
    const [bals, tvwapResult, lpAddr, status, konstant] = await Promise.all([
      _chainAPI.getBalances(addr).catch(() => null),
      _chainAPI.getTvwapPrices(addr, TVWAP_WINDOWS[state.tvwapWindowIdx]).catch(() => null),
      _chainAPI.getLPToken(addr).catch(() => ''),
      _chainAPI.getStatus(addr).catch(() => null),
      _chainAPI.getKonstant(addr).catch(() => null),
    ]);
    if (!bals) return null;
    const bt = bals.tokens || bals[0];
    const ba = bals.amounts || bals[1];
    if (!bt || bt.length === 0) return null;

    const tokenInfo = await Promise.all(bt.map(async (a) => {
      const [sym, dec] = await Promise.all([
        _chainAPI.getTokenSymbol(a),
        _chainAPI.getTokenDecimals(a),
      ]);
      return { sym, addr: a, dec };
    }));

    const prices = {};
    if (tvwapResult) {
      const tvwapTokens = tvwapResult.tokens || tvwapResult[0];
      const tvwapPrices = tvwapResult.prices || tvwapResult[1];
      const rawPrices = {};
      tvwapTokens.forEach((a, i) => { rawPrices[a.toLowerCase()] = BigInt(tvwapPrices[i]); });
      const baseAddr = tokenInfo.length > 0 ? tokenInfo[0].addr.toLowerCase() : null;
      const baseRaw = baseAddr ? rawPrices[baseAddr] : null;
      if (baseRaw && baseRaw > 0n) {
        for (const a of Object.keys(rawPrices)) {
          prices[a] = rawPrices[a] * SCALE / baseRaw;
        }
      } else {
        for (const a of Object.keys(rawPrices)) {
          prices[a] = rawPrices[a];
        }
      }
    }

    const balances = {};
    bt.forEach((a, i) => { balances[a.toLowerCase()] = BigInt(ba[i]); });

    let supply = null;
    if (status) {
      supply = status.supply !== undefined ? BigInt(status.supply) : (status[0] ? BigInt(status[0]) : null);
    }

    let lpSym = 'LP', lpDec = 18;
    if (lpAddr) {
      try { lpSym = await _chainAPI.getTokenSymbol(lpAddr); } catch {}
      try { lpDec = await _chainAPI.getTokenDecimals(lpAddr); } catch {}
    }

    let weights = [];
    try {
      const poolConfig = await _chainAPI.getPoolConfig(addr);
      weights = (poolConfig.weights || []).map(w => typeof w === 'bigint' ? w : BigInt(w || 0));
    } catch {}

    return {
      poolAddr: addr,
      TOKENS: tokenInfo,
      LP_ADDR: lpAddr,
      LP_SYMBOL: lpSym,
      LP_DECIMALS: lpDec,
      weights: weights,
      poolCache: {
        balances, prices, supply,
        tvwapK: konstant,
        timestamp: Date.now(), fetching: false, balanceProportions: null,
      },
    };
  } catch {
    return null;
  }
}

async function discoverPools() {
  if (!walletAccount) { log('Connect your wallet first.', 'warn'); return; }
  const factoryAddr = document.getElementById('factory-addr').value.trim();
  if (!factoryAddr) { log('Enter a factory address first.', 'warn'); return; }
  if (!_chainAPI.isValidAddress(factoryAddr)) { log('Invalid factory address.', 'notice'); return; }

  const discoverStart = performance.now();
  log(`🔍 Discovering pools from factory ${shortenAddr(factoryAddr)}...`, 'info');
  logDev('Factory discovery', { factory: factoryAddr });

  try {
    state.factoryAddr = factoryAddr;
    state.provenanceChain = null;
    localStorage.setItem('reciprocity_factory_addr', factoryAddr);

    const poolCount = await _chainAPI.getPoolCount(factoryAddr);
    log(`Factory verified: ${poolCount} pool(s) registered.`, 'info');
    logDev('Pool count', { count: poolCount });

    const pools = await _chainAPI.getPools(factoryAddr);
    const poolListEl = document.getElementById('pool-list');
    poolListEl.innerHTML = '';

    if (pools.length === 0) {
      poolListEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;">No pools found via this factory.</div>';
      return;
    }

    log(`Loading full data for ${pools.length} pool(s)...`, 'info');
    state.pools = [];
    for (let i = 0; i < pools.length; i += 3) {
      const batch = pools.slice(i, i + 3);
      const results = await Promise.all(batch.map(loadFullPoolData));
      state.pools.push(...results.filter(Boolean));
    }
    if (typeof setStep === 'function') setStep(state.activePoolAddr ? 4 : 3);

    const poolSummaries = state.pools.map(p => {
      const tokenMeta = p.TOKENS.map((t, i) => {
        const bal = p.poolCache.balances[t.addr.toLowerCase()] || 0n;
        const weight = p.weights && p.weights[i] ? p.weights[i] : 0n;
        return { sym: t.sym, addr: t.addr, balance: fmt(bal, t.dec), weight };
      });
      const symSummary = tokenMeta.map(t => t.sym).join(', ');
      const weights = p.weights || [];
      const allEqual = weights.length > 0 && weights.every(w => w === weights[0]);
      const hasWeights = weights.length > 0 && weights.some(w => w > 0n);
      return { addr: p.poolAddr, symSummary, tokenMeta, count: p.TOKENS.length, weights, allEqual, hasWeights };
    });

    poolSummaries.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'pool-item';
      const balLine = p.tokenMeta.length
        ? `<div class="pool-balances">${p.tokenMeta.map(t => t.sym + ' ' + t.balance).join(' | ')}</div>`
        : '';
      let weightHtml = '';
      if (p.hasWeights) {
        const warnBanner = !p.allEqual
          ? `<div class="weight-warning">⚠ Non-equal weights — pool uses weighted math</div>`
          : '';
        const weightRows = p.tokenMeta.map(t =>
          `<tr><td>${t.sym}</td><td class="mono">${shortenAddr(t.addr)}</td><td class="mono">${t.weight.toString()}</td></tr>`
        ).join('');
        weightHtml = `${warnBanner}<table class="weight-table"><thead><tr><th>Token</th><th>Contract</th><th>Weight</th></tr></thead><tbody>${weightRows}</tbody></table>`;
      }
      div.innerHTML = `
        <div>
          <div class="pool-addr">${shortenAddr(p.addr)}</div>
          <div class="pool-tokens">${p.symSummary} (${p.count} assets)</div>
          ${balLine}
          ${weightHtml}
        </div>
        <span class="pool-badge">${p.count}</span>`;
      div.addEventListener('click', () => {
        document.getElementById('pool-addr').value = p.addr;
        document.querySelectorAll('.pool-item').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        setActivePool(p.addr);
      });
      poolListEl.appendChild(div);
    });

    if (state.pools.length > 0 && !state.activePoolAddr) {
      setActivePool(state.pools[0].poolAddr);
    }

    const discoverMs = (performance.now() - discoverStart).toFixed(0);
    log(`✅ Found ${pools.length} pool(s) via factory (${discoverMs}ms).`, 'ok');
    logDev('Factory discovery complete', { poolsFound: pools.length, timeMs: discoverMs });
  } catch (e) {
    log('Factory discovery failed: ' + e.message, 'err');
  }
}

async function connectToPool(poolAddr) {
  if (!walletAccount) { log('Connect your wallet first.', 'warn'); return; }
  if (!poolAddr || !_chainAPI.isValidAddress(poolAddr)) {
    showError('Invalid Pool Address', 'Please enter a valid address.');
    return;
  }

  hideError();
  clearLog();
  const connectStart = performance.now();
  log(`Connecting to pool ${shortenAddr(poolAddr)} on ${_chainAPI.network || _chainAPI.name}...`, 'info');

  try {
    state.poolAddr = poolAddr;
    state.giveDefaultsApplied = false;
    state.lockedRecv = new Set();

    let bals;
    try {
      bals = await _chainAPI.getBalances(poolAddr);
    } catch {
      showError('Connection Failed', 'Could not read pool data. The address may not be a Reciprocity pool.');
      return;
    }

    const bt = bals.tokens || bals[0];
    const ba = bals.amounts || bals[1];

    if (!bt || bt.length === 0) {
      showError('Pool Not Initialized', 'This pool contract exists but has not been initialized with assets yet.');
      return;
    }

    const tokenInfo = [];
    for (let i = 0; i < bt.length; i += 10) {
      const batch = bt.slice(i, i + 10);
      const results = await Promise.all(batch.map(async (addr) => {
        const [sym, dec] = await Promise.all([
          _chainAPI.getTokenSymbol(addr),
          _chainAPI.getTokenDecimals(addr),
        ]);
        return { sym, addr, dec };
      }));
      tokenInfo.push(...results);
    }

    try {
      state.LP_ADDR = await _chainAPI.getLPToken(poolAddr);
      try { state.LP_SYMBOL = await _chainAPI.getTokenSymbol(state.LP_ADDR); } catch {}
      try { state.LP_DECIMALS = await _chainAPI.getTokenDecimals(state.LP_ADDR); } catch {}
    } catch {
      state.LP_ADDR = '';
      state.LP_SYMBOL = 'LP';
      state.LP_DECIMALS = 18;
      log('LP token address not exposed by this pool. LP functions may not work.', 'warn');
    }

    state.TOKENS = tokenInfo;
    updateUrlParams(poolAddr, document.getElementById('factory-addr').value.trim());

    try {
      const poolConfig = await _chainAPI.getPoolConfig(poolAddr);
      state.weights = (poolConfig.weights || []).map(w => typeof w === 'bigint' ? w : BigInt(w || 0));
    } catch { state.weights = []; }

    buildTokenRows();
    initRatioDefaults();
    updateDisabledState();

    document.getElementById('status-lp').textContent = state.LP_ADDR || 'N/A';
    document.getElementById('status-assets').textContent = state.TOKENS.map(t => t.sym).join(', ') + ` (${state.TOKENS.length} assets)`;

    const weightEl = document.getElementById('status-weights');
    if (weightEl) {
      if (state.weights && state.weights.length > 0 && state.weights.some(w => w > 0n)) {
        const weightHtml = state.TOKENS.map((t, i) => {
          const w = state.weights[i];
          const cls = w === 1n ? 'weight-equal' : 'weight-unequal';
          return `<span class="${cls}">${t.sym}: ${w}</span>`;
        }).join(', ');
        weightEl.innerHTML = weightHtml;
      } else {
        weightEl.textContent = 'N/A';
      }
    }

    await refreshPoolCache(true);
    await refreshAll();
    scaleSlidersToBalances();

    for (const t of state.TOKENS) {
      try {
        const onChainDec = await _chainAPI.getTokenDecimals(t.addr);
        if (onChainDec !== t.dec) {
          log(`${t.sym} decimals: ${t.dec} \u2192 ${onChainDec} (on-chain)`, 'warn');
          t.dec = onChainDec;
        }
      } catch {}
    }

    const connectMs = (performance.now() - connectStart).toFixed(0);
    const tokenStr = state.TOKENS.map(t => `${t.sym} (${t.dec} dec)`).join(', ');
    logDevGroup(`Pool Connected · ${connectMs}ms · ${shortenAddr(poolAddr)}`, '#3dcf8e', () => {
      console.log('  Pool:', poolAddr);
      console.log('  LP Token:', state.LP_ADDR || 'N/A');
      console.log(`  Assets (${state.TOKENS.length}):`, tokenStr);
      console.log('  Chain:', _chainAPI.name, '| Network:', _chainAPI.network || 'default');
      console.log('  Cache TTL:', CACHE_TTL_MS + 'ms', '| TVWAP windows:', TVWAP_WINDOWS.map(w => w + 's').join(', '));
      console.log('  Connect time:', connectMs + 'ms');
    });
    const poolEntry = state.pools.findIndex(p => p.poolAddr.toLowerCase() === poolAddr.toLowerCase());
    const poolData = {
      poolAddr,
      TOKENS: state.TOKENS,
      LP_ADDR: state.LP_ADDR,
      LP_SYMBOL: state.LP_SYMBOL,
      LP_DECIMALS: state.LP_DECIMALS,
      poolCache: state.poolCache,
    };
    if (poolEntry >= 0) {
      state.pools[poolEntry] = poolData;
    } else {
      state.pools.push(poolData);
    }
    state.activePoolAddr = poolAddr;

    log(`✅ Connected to ${shortenAddr(poolAddr)} — ${state.TOKENS.length} assets ready`, 'ok');
    if (typeof setStep === 'function') setStep(4);
    computeTargetAmounts(state, dom);
    updateUI();
    startPoolPolling();

  } catch (e) {
    showError('Connection Error', e.message || 'Unknown error connecting to pool.');
    log('❗ Connect failed: ' + (e.message || e), 'err');
  }
}

function createNonceDisplay() {
  let el = document.getElementById('state-nonce');
  if (!el) {
    el = document.createElement('span');
    el.id = 'state-nonce';
    el.style.cssText = 'margin-left:12px;font-size:11px;color:var(--text-muted);';
    el.textContent = 'Nonce: 0';
    const header = document.querySelector('header .header-content');
    if (header) header.appendChild(el);
  }
  return el;
}

function createBlockDisplay() {
  let el = document.getElementById('block-info');
  if (!el) {
    el = document.createElement('span');
    el.id = 'block-info';
    el.style.cssText = 'margin-left:12px;font-size:11px;color:var(--text-muted);';
    el.textContent = 'Block: —';
    const header = document.querySelector('header .header-content');
    if (header) header.appendChild(el);
  }
  return el;
}

function startPoolPolling() {
  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }
  const nonceEl = createNonceDisplay();
  const blockEl = createBlockDisplay();
  state.lastNonce = -1;
  state.lastTxBlock = '\u2014';
  state.currentBlock = '\u2014';
  state.pollingTimer = setInterval(async () => {
    // Block number polling — streams continuously to show connectivity
    if (_chainAPI.getBlock) {
      try {
        const blockInfo = await _chainAPI.getBlock(state.poolAddr);
        if (blockInfo.currentBlock !== undefined) {
          state.currentBlock = blockInfo.currentBlock;
          blockEl.textContent = 'Block: ' + state.currentBlock + ' | Last Tx: ' + state.lastTxBlock;
        }
      } catch (e) {
        // block polling failure is non-fatal
      }
    }

    // Nonce polling — detects when any operation occurs on the pool
    if (_chainAPI.getNonce) {
      try {
        const nonce = await _chainAPI.getNonce(state.poolAddr);
        nonceEl.textContent = 'Nonce: ' + nonce;
        if (nonce !== state.lastNonce) {
          const delta = nonce - state.lastNonce;
          state.lastNonce = nonce;
          if (state.lastNonce >= 0 && state.lastTxBlock === '\u2014') {
            // first sync — record nonce but keep lastTxBlock as em dash
          } else if (delta > 0) {
            state.lastTxBlock = state.currentBlock;
            blockEl.textContent = 'Block: ' + state.currentBlock + ' | Last Tx: ' + state.lastTxBlock;
          }
          await refreshPoolCache(true);
          await refreshAll();
        }
      } catch (e) {
        // nonce polling failure is non-fatal
      }
    }
  }, 2000);

  // One-time fetch of last tx block on connect
  if (_chainAPI.getLastTxBlock) {
    _chainAPI.getLastTxBlock(state.poolAddr).then(block => {
      if (block !== null && block !== undefined && block !== '\u2014') {
        state.lastTxBlock = block;
        if (state.currentBlock !== '\u2014') {
          const blockEl = document.getElementById('block-info');
          if (blockEl) blockEl.textContent = 'Block: ' + state.currentBlock + ' | Last Tx: ' + state.lastTxBlock;
        }
      }
    }).catch(() => {});
  }
}
