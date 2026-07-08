// SPDX-License-Identifier: MIT
// preview.js — Preview card logic for add/remove/swap operations

async function previewAdd() {
  const tokens = [], amounts = [];
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const g = readGive(sym);
    if (g && g > 0n) { tokens.push(t.addr); amounts.push(g); }
  }
  if (!tokens.length) { log('Fill at least one Give amount.', 'notice'); return; }

  log('Give:', 'info');
  tokens.forEach((a, i) => {
    const ti = state.TOKENS.find(t => t.addr === a);
    if (ti) log(`  ${fmt(amounts[i], ti.dec)} ${ti.sym}`, 'info');
  });

  const bals = await _chainAPI.getBalances(state.poolAddr);
  const bt = bals.tokens || bals[0], ba = bals.amounts || bals[1];
  const st = await _chainAPI.getStatus(state.poolAddr);
  const supply = st.supply !== undefined ? st.supply : st[0];
  const pm = {}; bt.forEach((a, i) => { pm[a.toLowerCase()] = ba[i]; });
  let tv = 0n, pv = 0n;
  state.TOKENS.forEach(t => {
    const bal = pm[t.addr.toLowerCase()] || 0n;
    const price = getPrice(t.sym.toLowerCase(), state);
    pv += bal * price / SCALE;
  });
  state.TOKENS.forEach(t => {
    const a = readGive(t.sym.toLowerCase());
    if (a) {
      const price = getPrice(t.sym.toLowerCase(), state);
      tv += a * price / SCALE;
    }
  });
  let est = 0n;
  if (supply > 0n) {
    est = tv * BigInt(supply) / pv;
  } else {
    state.TOKENS.forEach(t => {
      const a = readGive(t.sym.toLowerCase());
      if (a) est += a * SCALE / (10n ** BigInt(t.dec));
    });
  }
  log(`LP shares: ~${fmt(est, state.LP_DECIMALS)} (estimate)`, 'ok');

  let html = '';
  html += `<div class="preview-section"><h4>You Give</h4>`;
  tokens.forEach((a, i) => {
    const ti = state.TOKENS.find(t => t.addr === a);
    if (ti) html += `<div class="preview-row"><span class="label">${ti.sym}</span><span class="value">${fmt(amounts[i], ti.dec)}</span></div>`;
  });
  html += `</div>`;
  html += `<div class="preview-section"><h4>You Receive</h4>`;
  html += `<div class="preview-row"><span class="label">${state.LP_SYMBOL}</span><span class="value">~${fmt(est, state.LP_DECIMALS)}</span></div>`;
  html += `</div>`;
  html += `<div class="preview-section"><h4>Fees</h4>`;
  html += `<div class="preview-row"><span class="label">Fee</span><span class="value ok">0 (zero fees to add liquidity)</span></div>`;
  html += `</div>`;
  html += `<hr class="preview-divider">`;
  dom.previewContent.innerHTML = html;
  dom.detailsToggle.classList.add('hidden');
}

async function previewRemove() {
  const BASIS = 10000n;
  let lpAmt = readGiveLp();
  if (!lpAmt || lpAmt <= 0n) { log('Enter LP Give (shares to burn).', 'notice'); return; }
  if (state.poolCache.supply) {
    const maxLP = BigInt(state.poolCache.supply);
    if (lpAmt > maxLP) {
      lpAmt = maxLP;
      log(`Capped to ${fmt(lpAmt, state.LP_DECIMALS)} shares (pool limit).`, 'warn');
    }
  }

  log(`Burn LP: ${fmt(lpAmt, state.LP_DECIMALS)}`, 'info');
  const bals = await _chainAPI.getBalances(state.poolAddr);
  const bt = bals.tokens || bals[0], ba = bals.amounts || bals[1];
  let totalLP, totalLPSrc = '?';
  try {
    totalLP = await _chainAPI.getSupply(state.poolAddr); totalLPSrc = 'getSupply';
  } catch {}
  if (!totalLP || totalLP <= 0n) {
    const st = await _chainAPI.getStatus(state.poolAddr);
    totalLP = st.supply !== undefined ? st.supply : st[0]; totalLPSrc = 'getStatus(supply)';
  }
  if (totalLP <= 0n) { log('LP total supply is zero.', 'warn'); return; }
  console.group('[previewRemove]');
  console.log('lpAmt (raw):', lpAmt.toString());
  console.log('totalLP (raw):', totalLP.toString(), '(source:', totalLPSrc + ')');
  console.log('cached supply:', state.poolCache.supply ? BigInt(state.poolCache.supply).toString() : 'N/A');
  console.log('pool balances (getBalances):', bt.map((a,i)=>{const t=state.TOKENS.find(x=>x.addr.toLowerCase()===a.toLowerCase());return t?t.sym+':'+BigInt(ba[i]).toString():'?'+i+':'+BigInt(ba[i]).toString()}));
  const expectedRecv = {};
  bt.forEach((addr, i) => {
    const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
    if (ti) {
      const bal = BigInt(ba[i]);
      const ratio = lpAmt * BASIS / totalLP;
      const amt = bal * ratio / BASIS;
      console.log(`${ti.sym}: bal=${bal.toString()} ratio=${ratio.toString()} amt=${amt.toString()} ui=${fmt(amt, ti.dec)}`);
      expectedRecv[ti.sym.toLowerCase()] = { raw: amt.toString(), ui: fmt(amt, ti.dec) + ' ' + ti.sym };
    }
  });
  console.groupEnd('[previewRemove]');

  log('You receive:', 'info');
  bt.forEach((addr, i) => {
    const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
    if (ti) {
      const bal = BigInt(ba[i]);
      const ratio = lpAmt * BASIS / totalLP;
      const amt = bal * ratio / BASIS;
      log(`  ~${fmt(amt, ti.dec)} ${ti.sym}`, 'ok');
    }
  });

  let html = '';
  html += `<div class="preview-section"><h4>You Give</h4>`;
  html += `<div class="preview-row"><span class="label">${state.LP_SYMBOL}</span><span class="value">${fmt(lpAmt, state.LP_DECIMALS)}</span></div>`;
  html += `</div>`;
  html += `<div class="preview-section"><h4>You Receive</h4>`;
  html += `<table class="preview-table"><tr><th>Token</th><th>Amount</th><th>Value %</th></tr>`;
  let totalOutValue = 0n;
  const outValues = [];
  bt.forEach((addr, i) => {
    const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
    if (!ti) return;
    const bal = BigInt(ba[i]);
    const ratio = lpAmt * BASIS / totalLP;
    const amt = bal * ratio / BASIS;
    const price = getPrice(ti.sym.toLowerCase(), state);
    const val = amt * price / SCALE;
    outValues.push(val); totalOutValue += val;
  });
  bt.forEach((addr, i) => {
    const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
    if (!ti) return;
    const bal = BigInt(ba[i]);
    const ratio = lpAmt * BASIS / totalLP;
    const amt = bal * ratio / BASIS;
    const pct = totalOutValue > 0n ? (Number(outValues[i]) / Number(totalOutValue) * 100).toFixed(1) : '0.0';
    html += `<tr><td>${ti.sym}</td><td>${fmt(amt, ti.dec)}</td><td>${pct}%</td></tr>`;
  });
  html += `</table></div>`;
  html += `<div class="preview-section"><h4>Fees</h4>`;
  html += `<div class="preview-row"><span class="label">Fee</span><span class="value ok">0 (zero fees to remove liquidity)</span></div>`;
  html += `</div>`;
  html += `<hr class="preview-divider">`;
  dom.previewContent.innerHTML = html;
}

async function previewSwap() {
  _chainAPI.clearQuoteCache();
  await refreshPoolCache(false);

  const order = buildOrderFromRatios(state, dom);
  if (!order.tokensIn.length && !order.sharesIn) { log('Fill at least one Give amount.', 'notice'); return; }

  const legalErr = validateOrderLegal(order, state.poolCache.balances);
  if (legalErr) { log('Invalid order: ' + legalErr, 'err'); return; }

  const showDetails = dom.detailsCheckbox && dom.detailsCheckbox.checked;

  const quoteFn = async (o) => await _chainAPI.quoteSwap(state.poolAddr, o);
  const optResult = await optimizeSwap(order, quoteFn, state, dom);
  const { order: optOrder, quote, reciprocity: sharesDelta, converged, iterations, alpha, alphaPct, fanRounds } = optResult;

  if (optResult.wouldRevert) {
    showError('Swap Not Available', optResult.reason);
    return;
  }

  let efficiencyBps = null;

  if (quote) {
    const qo = quote.tokensOut || quote[0], qa = quote.amountsOut || quote[1];
    // Save overlapping receive amounts before clearing (they won't be in the quote)
    const overlapRecv = {};
    for (const t of state.TOKENS) {
      const s = t.sym.toLowerCase();
      if (dom.getSliderPct(s) > 0 && order.tokensIn.some(a => a.toLowerCase() === t.addr.toLowerCase()))
        overlapRecv[s] = dom.readRecv(s) || 0n;
    }
    for (const s of state.ALL_SYMS) { if (!dom.isLocked(s)) recvEl(s).value = ''; }
    // Restore overlapping receive values
    for (const [s, v] of Object.entries(overlapRecv)) { if (v > 0n) recvEl(s).value = fmt(v, state.TOKEN_MAP[s].dec); }
    qo.forEach((addr, i) => {
      const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
      if (!ti || dom.isLocked(ti.sym.toLowerCase())) return;
      recvEl(ti.sym.toLowerCase()).value = fmt(qa[i], ti.dec).replace(/,/g, '');
    });
    if (sharesDelta && sharesDelta > 0n && dom.getSliderPct('lp') > 0 && !dom.isLocked('lp')) recvEl('lp').value = fmt(sharesDelta, state.LP_DECIMALS).replace(/,/g, '');
    const expectedRecv = {};
    qo.forEach((addr, i) => {
      const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
      if (ti) expectedRecv[ti.sym.toLowerCase()] = { raw: qa[i].toString(), ui: fmt(qa[i], ti.dec) + ' ' + ti.sym };
    });

    logDev(`Preview Quote · ${converged ? 'converged' : 'max iter'} · α=${(alphaPct/100).toFixed(1)}× · sd=${sharesDelta?.toString()} · ${fanRounds} rounds`, converged ? '#3dcf8e' : '#d4a040');
    if (!converged) log('Warning: optimizer did not converge — output may be suboptimal.', 'warn');
  }

  let html = '';
  html += `<div class="preview-section"><h4>You Give</h4>`;
  if (showDetails) {
    // Breakdown view: show net amounts with info on what was removed
    optOrder.tokensIn.forEach((a) => {
      const idx = optOrder.tokensIn.indexOf(a);
      const ti = state.TOKENS.find(t => t.addr === a);
      if (!ti) return;
      const rawGive = order.amountsIn[order.tokensIn.findIndex(t => t.toLowerCase() === a.toLowerCase())] || 0n;
      const recvAmt = dom.readRecv(ti.sym.toLowerCase()) || 0n;
      html += `<div class="preview-row"><span class="label">${ti.sym}</span><span class="value">${fmt(optOrder.amountsIn[idx], ti.dec)}</span></div>`;
      if (recvAmt > 0n && recvAmt < rawGive) {
        html += `<div class="preview-row"><span class="label warn">\u26a0\ufe0f ${ti.sym} info</span><span class="value warn">${fmt(recvAmt, ti.dec)} returned — you asked to receive some back</span></div>`;
      }
    });
  } else {
    // Default: show gross give, no info
    order.tokensIn.forEach((a, idx) => {
      const ti = state.TOKENS.find(t => t.addr === a);
      if (ti) html += `<div class="preview-row"><span class="label">${ti.sym}</span><span class="value">${fmt(order.amountsIn[idx], ti.dec)}</span></div>`;
    });
  }
  if (optOrder.sharesIn > 0n) {
    html += `<div class="preview-row"><span class="label">${state.LP_SYMBOL}</span><span class="value">${fmt(optOrder.sharesIn, state.LP_DECIMALS)}</span></div>`;
  }
  html += `</div>`;

  if (quote) {
    const qo = quote.tokensOut || quote[0], qa = quote.amountsOut || quote[1];
    html += `<div class="preview-section"><h4>You Receive</h4>`;
    html += `<table class="preview-table"><tr><th>Token</th><th>Amount</th><th>Value %</th></tr>`;
    const recvBySym = {};
    let totalOutValue = 0n;
    qo.forEach((addr, i) => {
      const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
      if (!ti) return;
      const price = _spotPrice(ti.sym.toLowerCase(), state);
      const val = BigInt(qa[i]) * price / SCALE;
      recvBySym[ti.sym.toLowerCase()] = { sym: ti.sym, addr, amt: BigInt(qa[i]), dec: ti.dec, val };
      totalOutValue += val;
    });
    if (!showDetails) {
      for (const t of state.TOKENS) {
        const sym = t.sym.toLowerCase();
        if (dom.getSliderPct(sym) > 0 && order.tokensIn.some(a => a.toLowerCase() === t.addr.toLowerCase())) {
          const rAmt = dom.readRecv(sym) || 0n;
          if (rAmt > 0n) {
            const price = _spotPrice(sym, state);
            const val = rAmt * price / SCALE;
            // If already in recvBySym from quote loop, remove old value to avoid double-count
            if (recvBySym[sym]) {
              totalOutValue -= recvBySym[sym].val;
            }
            recvBySym[sym] = { sym: t.sym, addr: t.addr, amt: rAmt, dec: t.dec, val, tag: true };
            totalOutValue += val;
          }
        }
      }
    }
    const recvRows = state.ALL_SYMS.filter(s => s !== 'lp' && recvBySym[s]).map(s => recvBySym[s]);
    const outValues = recvRows.map(r => r.val);
    let sdValue = 0n;
    if (sharesDelta > 0n) {
      let poolValue = 0n;
      for (const t of state.TOKENS) {
        const bal = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
        const p = _spotPrice(t.sym.toLowerCase(), state);
        poolValue += bal * p / SCALE;
      }
      const totalSupply = state.poolCache.supply || 1n;
      sdValue = totalSupply > 0n ? sharesDelta * poolValue / totalSupply : 0n;
      totalOutValue += sdValue; outValues.push(sdValue);
    }
    let inputValue = 0n;
    optOrder.tokensIn.forEach((addr, i) => {
      const price = state.poolCache.prices[addr.toLowerCase()] || 1n;
      inputValue += optOrder.amountsIn[i] * price / SCALE;
    });
    if (optOrder.sharesIn > 0n) {
      let pv = 0n;
      for (const t of state.TOKENS) {
        const b = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
        const p = getPrice(t.sym.toLowerCase(), state);
        pv += b * p / SCALE;
      }
      const ts = state.poolCache.supply || 1n;
      inputValue += optOrder.sharesIn * pv / ts;
    }
    if (inputValue > 0n) {
      efficiencyBps = totalOutValue * 10000n / inputValue;
      if (efficiencyBps > 10000n) efficiencyBps = 10000n;
    }
    recvRows.forEach((row, i) => {
      const pct = totalOutValue > 0n ? (Number(outValues[i]) / Number(totalOutValue) * 100).toFixed(1) : '0.0';
      html += `<tr><td>${row.sym}${row.tag ? ' *' : ''}</td><td>${fmt(row.amt, row.dec)}</td><td>${pct}%</td></tr>`;
    });
    if (sharesDelta > 0n && dom.getSliderPct('lp') > 0) {
      const pct = totalOutValue > 0n ? (Number(sdValue) / Number(totalOutValue) * 100).toFixed(1) : '0.0';
      html += `<tr><td>${state.LP_SYMBOL}</td><td>${fmt(sharesDelta, state.LP_DECIMALS)}</td><td>${pct}%</td></tr>`;
    }
    html += `</table></div>`;
  }

  if (quote && quote.feeAmounts) {
    const fees = quote.feeAmounts;
    let hasFee = false;
    let feeHtml = '';
    fees.forEach((f, i) => {
      if (f && f > 0n) {
        const ti = state.TOKENS[i];
        if (ti) { hasFee = true; feeHtml += `<div class="preview-row"><span class="label">${ti.sym} fee</span><span class="value warn">${fmt(f, ti.dec)}</span></div>`; }
      }
    });
    if (hasFee) html += `<div class="preview-section"><h4>Fees</h4>${feeHtml}</div>`;
  }

  html += `<hr class="preview-divider">`;
  html += `<div class="preview-section">`;
    const displaySD = sharesDelta > 0n && dom.getSliderPct('lp') > 0 ? sharesDelta : 0n;
    html += `<div class="preview-row"><span class="label">LP shares minted</span><span class="value ${displaySD > 10n ** BigInt(Math.max(0, state.LP_DECIMALS - 2)) ? 'warn' : 'ok'}">${fmt(displaySD, state.LP_DECIMALS)}</span></div>`;
  if (efficiencyBps !== null) {
    const effPct = (Number(efficiencyBps) / 100).toFixed(2);
    const effClass = efficiencyBps >= 9000n ? 'ok' : efficiencyBps >= 8000n ? 'warn' : 'err';
    html += `<div class="preview-row"><span class="label">TVWAP Efficiency</span><span class="value ${effClass}">${effPct}%</span></div>`;
  }
  html += `</div>`;

  dom.previewContent.innerHTML = html;

  state._lastVerify = null;
  if (dom.verifyToggle && dom.verifyToggle.checked) {
    try {
      const vResult = await _chainAPI.verifyQuote(state.poolAddr, optOrder);
      state._lastVerify = vResult;
      if (vResult.onchain) {
        const oc = vResult.onchain;
        const ocTokens = oc.tokensOut || oc[0] || [];
        const ocAmounts = oc.amountsOut || oc[1] || [];
        const ocFees = oc.feeAmounts || [];
        const receiveSection = dom.previewContent.querySelector('.preview-section h4 + table.preview-table');
        if (receiveSection) {
          let rows = '';
          let totalOutValue = 0n;
          const vBySym = {};
          ocTokens.forEach((addr, i) => {
            const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
            if (!ti) return;
            const price = _spotPrice(ti.sym.toLowerCase(), state);
            const val = BigInt(ocAmounts[i]) * price / SCALE;
            vBySym[ti.sym.toLowerCase()] = { sym: ti.sym, amt: BigInt(ocAmounts[i]), dec: ti.dec, val };
            totalOutValue += val;
          });
          if (!showDetails) {
            for (const t of state.TOKENS) {
              const s = t.sym.toLowerCase();
              if (dom.getSliderPct(s) > 0 && order.tokensIn.some(a => a.toLowerCase() === t.addr.toLowerCase())) {
                const rAmt = dom.readRecv(s) || 0n;
                if (rAmt > 0n) {
                  const price = _spotPrice(s, state);
                  const val = rAmt * price / SCALE;
                  if (vBySym[s]) {
                    totalOutValue -= vBySym[s].val;
                  }
                  vBySym[s] = { sym: t.sym, amt: rAmt, dec: t.dec, val, tag: true };
                  totalOutValue += val;
                }
              }
            }
          }
          const vRows = state.ALL_SYMS.filter(s => s !== 'lp' && vBySym[s]).map(s => vBySym[s]);
          const outValues = vRows.map(r => r.val);
          if (sharesDelta > 0n && dom.getSliderPct('lp') > 0) {
            let poolValue = 0n;
            for (const t of state.TOKENS) {
              const bal = state.poolCache.balances[t.addr.toLowerCase()] || 0n;
              const p = _spotPrice(t.sym.toLowerCase(), state);
              poolValue += bal * p / SCALE;
            }
            const totalSupply = state.poolCache.supply || 1n;
            const sdValue = totalSupply > 0n ? sharesDelta * poolValue / totalSupply : 0n;
            totalOutValue += sdValue; outValues.push(sdValue);
          }
          vRows.forEach((row, i) => {
            const pct = totalOutValue > 0n ? (Number(outValues[i]) / Number(totalOutValue) * 100).toFixed(1) : '0.0';
            rows += `<tr><td>${row.sym}${row.tag ? ' *' : ''}</td><td>${fmt(row.amt, row.dec)}</td><td>${pct}%</td></tr>`;
          });
          if (sharesDelta > 0n && dom.getSliderPct('lp') > 0) {
            const pct = totalOutValue > 0n ? (Number(outValues[vRows.length]) / Number(totalOutValue) * 100).toFixed(1) : '0.0';
            rows += `<tr><td>${state.LP_SYMBOL}</td><td>${fmt(sharesDelta, state.LP_DECIMALS)}</td><td>${pct}%</td></tr>`;
          }
          receiveSection.innerHTML = rows;
        }
      }
      const badge = document.createElement('div');
      badge.className = 'preview-section';
      const status = vResult.onchain ? 'verified' : (vResult.skipped ? 'skipped' : 'mismatch');
      const label = vResult.onchain ? '✓ Verified' : (vResult.skipped ? 'Offline' : '✗ Mismatch');
      badge.innerHTML = `<div class="preview-row"><span class="label">On-Chain Verification</span><span class="verify-badge ${status}">${label}</span></div>`;
      dom.previewContent.appendChild(badge);
    } catch (e) {
      logDev('Verify: skipped', e.message, '#d4a040');
    }
  }

  dom.previewCard.classList.add('visible');
  dom.detailsToggle.classList.remove('hidden');

  const totalRounds = 1 + (fanRounds || 0);
  log(`Offer optimized in ${totalRounds} rounds.`, 'ok');
}
