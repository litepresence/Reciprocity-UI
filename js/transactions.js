// SPDX-License-Identifier: MIT
// transactions.js — Transaction execution for add/remove/swap with tx state machine

function setTxState(status, hash, error) {
  state.tx = { status, hash: hash || '', error: error || '' };
  if (status === 'pending') {
    dom.executeBtn.classList.add('btn-loading');
    dom.executeBtn.disabled = true;
  } else {
    dom.executeBtn.classList.remove('btn-loading');
    dom.executeBtn.disabled = false;
  }
  if (status === 'confirmed' && hash) {
    showToast('Confirmed', `TX: ${shortenAddr(hash)}`, 'success');
    const explorer = _chainAPI.explorer;
    if (explorer && hash) {
      const link = `${explorer}/tx/${hash}`;
      showToast('Explorer', `<a href="${link}" target="_blank" style="color:var(--accent)">${shortenAddr(hash)}</a>`, 'info');
    }
  }
  if (status === 'failed') {
    showToast('Failed', error || 'Transaction failed', 'error');
  }
}

function storeTxHash(hash) {
  if (!hash) return;
  try {
    const key = 'reciprocity_tx_history';
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    history.unshift({ hash, chain: _chainAPI.name, time: Date.now() });
    if (history.length > 20) history.length = 20;
    localStorage.setItem(key, JSON.stringify(history));
  } catch {}
}

async function execAdd() {
  const tokens = [], amounts = [];
  for (const t of state.TOKENS) {
    const sym = t.sym.toLowerCase();
    const amt = readGive(sym);
    if (amt && amt > 0n) { tokens.push(t.addr); amounts.push(amt); }
  }
  if (!tokens.length) { log('Fill a Give amount.', 'notice'); return; }
  const minShares = readRecvLp() || 0n;
  const depositStr = tokens.map((a, i) => fmt(amounts[i], state.TOKEN_MAP[state.TOKENS.find(t => t.addr === a)?.sym?.toLowerCase()]?.dec || 18) + ' ' + (state.TOKENS.find(t => t.addr === a)?.sym || '?')).join(', ');
  log(`Depositing ${depositStr} into the pool...`, 'info');
  logDev('Deposit', { tokens: tokens.map(a => state.TOKENS.find(t => t.addr === a)?.sym), amounts: amounts.map(a => a.toString()), minShares: minShares.toString() });
  setTxState('pending');
  try {
    for (let i = 0; i < tokens.length; i++) {
      await _chainAPI.approveIfNeeded(tokens[i], state.poolAddr, walletAccount, amounts[i]);
    }
    setTxState('confirming');
    log('⏳ Waiting for wallet confirmation...', 'info');
    const txStart = performance.now();
    const hash = await _chainAPI.addLiquidity(state.poolAddr, tokens, amounts, minShares, [], 0);
    const txMs = (performance.now() - txStart).toFixed(0);
    log(`✅ Deposited! ${txMs}ms — ${shortenAddr(hash)}`, 'ok');
    logDev('Deposit confirmed', { hash, timeMs: txMs });
    storeTxHash(hash);
    setTxState('confirmed', hash);
  } catch (e) {
    setTxState('failed', '', e.message || 'Deposit failed');
    throw e;
  } finally {
    dom.executeBtn.classList.remove('btn-loading');
  }
}

async function execRemove() {
  let lpAmt = readGiveLp();
  if (!lpAmt || lpAmt <= 0n) { log('Enter LP Give (shares to burn).', 'notice'); return; }
  if (!state.LP_ADDR) { log('LP token not available for this pool.', 'warn'); return; }
  if (state.poolCache.supply) {
    const maxLP = BigInt(state.poolCache.supply);
    if (lpAmt > maxLP) {
      lpAmt = maxLP;
      log(`Capped to ${fmt(lpAmt, state.LP_DECIMALS)} shares (pool limit).`, 'warn');
    }
  }
  const minOut = state.TOKENS.map(t => {
    const sym = t.sym.toLowerCase();
    const r = readRecv(sym);
    if (getSliderPct(sym) > 0) return r || 0n;
    const base = (r && r > 0n) ? r : 0n;
    return base > 0n ? base * 995n / 1000n : 0n;
  });
  log(`Burning ${fmt(lpAmt, state.LP_DECIMALS)} ${state.LP_SYMBOL} to withdraw liquidity...`, 'info');
  logDev('Withdraw', { lpAmount: lpAmt.toString(), minOut: minOut.map(m => m.toString()) });
  setTxState('pending');
  try {
    await _chainAPI.approveIfNeeded(state.LP_ADDR, state.poolAddr, walletAccount, lpAmt);
    setTxState('confirming');
    log('⏳ Waiting for wallet confirmation...', 'info');
    const txStart = performance.now();
    const hash = await _chainAPI.removeLiquidity(state.poolAddr, lpAmt, minOut);
    const txMs = (performance.now() - txStart).toFixed(0);
    log(`✅ Withdrew! ${txMs}ms — ${shortenAddr(hash)}`, 'ok');
    logDev('Withdraw confirmed', { hash, timeMs: txMs });
    storeTxHash(hash);
    setTxState('confirmed', hash);
  } catch (e) {
    setTxState('failed', '', e.message || 'Withdraw failed');
    throw e;
  } finally {
    dom.executeBtn.classList.remove('btn-loading');
  }
}

async function execSwap() {
  await refreshPoolCache(true);

  const order = buildOrderFromRatios(state, dom);
  if (!order.tokensIn.length && !order.sharesIn) { log('Fill a Give amount.', 'notice'); return; }

  const legalErr = validateOrderLegal(order, state.poolCache.balances);
  if (legalErr) { log('Invalid order: ' + legalErr, 'err'); return; }

  const giveDesc = order.tokensIn.map((a, i) => fmt(order.amountsIn[i], state.TOKEN_MAP[state.TOKENS.find(t => t.addr === a)?.sym?.toLowerCase()]?.dec || 18) + ' ' + (state.TOKENS.find(t => t.addr === a)?.sym || '?')).join(', ');
  log(`🔍 Optimizing swap: giving ${giveDesc}...`, 'info');
  const quoteFn = async (o) => await _chainAPI.quoteSwap(state.poolAddr, o);
  const optStart = performance.now();
  const { order: optOrder, wouldRevert, reason, alphaPct, iterations } = await optimizeSwap(order, quoteFn, state, dom);
  const optMs = (performance.now() - optStart).toFixed(0);
  if (wouldRevert) { showError('Swap Not Available', reason); return; }

  if (alphaPct !== undefined && alphaPct < 10000) {
    log(`📐 Scaled to ${(alphaPct / 100).toFixed(2)}× to maintain positive LP shares`, 'info');
  }
  logDev('Optimization', { iterations: iterations?.length || 0, timeMs: optMs, alphaPct: (alphaPct / 100).toFixed(2) + '%' });

  if (state._lastVerify && state._lastVerify.match === false && (!dom.verifyToggle || dom.verifyToggle.checked)) {
    const msg = 'A prior on-chain quote verification showed a mismatch between local and on-chain math. Proceed with caution.';
    log(msg, 'warn');
  }

  let simResult = null;
  try {
    simResult = await _chainAPI.simulateSwap(state.poolAddr, optOrder);
    if (simResult.reciprocity < 0n) {
      log(`Simulated swap rejected: negative reciprocity (reciprocity=${simResult.reciprocity.toString()}). Refreshing state...`, 'warn');
      simResult = null;
    }
  } catch (e) {
    log(`Swap simulation reverted: ${e.message}. Refreshing state for retry...`, 'warn');
    simResult = null;
  }
  if (!simResult) {
    if (!window._execSwapRetry) {
      window._execSwapRetry = true;
      await refreshPoolCache(true);
      return execSwap();
    }
    window._execSwapRetry = false;
    showError('Swap Unavailable', 'On-chain simulation failed even after retry. The pool state may have changed significantly.');
    return;
  }
  window._execSwapRetry = false;

  const recvDesc = optOrder.tokensOut.map((a, i) => fmt(optOrder.amountsOut[i], state.TOKEN_MAP[state.TOKENS.find(t => t.addr === a)?.sym?.toLowerCase()]?.dec || 18) + ' ' + (state.TOKENS.find(t => t.addr === a)?.sym || '?')).join(', ');
  log(`💱 Swapping: ${giveDesc} → ${recvDesc || (optOrder.minSharesOut ? fmt(optOrder.minSharesOut, state.LP_DECIMALS) + ' ' + state.LP_SYMBOL : '?')}`, 'info');

  dom.executeBtn.classList.add('btn-loading');
  setTxState('pending');
  try {
    for (const addr of optOrder.tokensIn) {
      const idx = optOrder.tokensIn.indexOf(addr);
      await _chainAPI.approveIfNeeded(addr, state.poolAddr, walletAccount, optOrder.amountsIn[idx]);
    }
    setTxState('confirming');
    log(`⏳ Waiting for wallet confirmation...`, 'info');
    const txStart = performance.now();
    const swapResult = await _chainAPI.executeSwap(state.poolAddr, optOrder);
    const hash = (swapResult && typeof swapResult === 'object') ? swapResult.hash : swapResult;
    const onchainRecv = (swapResult && typeof swapResult === 'object' && swapResult.tokensOut) ? swapResult.tokensOut : null;
    const onchainReciprocity = (swapResult && typeof swapResult === 'object' && swapResult.reciprocity !== undefined) ? swapResult.reciprocity : null;
    const txMs = (performance.now() - txStart).toFixed(0);
    log(`✅ Swapped! ${txMs}ms — ${shortenAddr(hash)}`, 'ok');
    logDev('Swap confirmed', { hash, timeMs: txMs, optTimeMs: optMs });
    storeTxHash(hash);
    setTxState('confirmed', hash);
    const actualRecv = {};
    if (onchainRecv) {
      for (const addr of Object.keys(onchainRecv)) {
        const ti = state.TOKENS.find(t => t.addr.toLowerCase() === addr.toLowerCase());
        if (ti) actualRecv[ti.sym.toLowerCase()] = { raw: onchainRecv[addr].toString(), ui: fmt(BigInt(onchainRecv[addr]), ti.dec) + ' ' + ti.sym };
      }
    }
  } catch (e) {
    setTxState('failed', '', e.message || 'Swap failed');
    throw e;
  } finally {
    dom.executeBtn.classList.remove('btn-loading');
  }
}
