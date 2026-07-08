// SPDX-License-Identifier: MIT
// notifications.js — Logging, error handling, and toast system

function logDev(label, data, color) {
  const c = color || '#3dcf8e';
  console.log(`%c[${label}]`, `color:${c};font-weight:bold`, ...(data !== undefined ? [data] : []));
}
function logDevGroup(title, color, fn) {
  console.groupCollapsed(`%c${title}`, `color:${color || '#3dcf8e'};font-weight:bold`);
  try { fn(); } finally { console.groupEnd(); }
}
function log(msg, cls) {
  dom.output.innerHTML += `<div class="${cls}">${msg}</div>`;
  dom.output.scrollTop = dom.output.scrollHeight;
  if (cls === 'ok') showToast('Success', msg, 'success');
  else if (cls === 'err') showToast('Error', msg, 'error');
  else if (cls === 'notice') showToast('Notice', msg, 'warning');
  else if (cls === 'warn') showToast('Warning', msg, 'warning');
}
function clearLog() { dom.output.innerHTML = ''; }
function showError(title, msg) {
  dom.errorTitle.textContent = title;
  dom.errorMessage.textContent = msg;
  dom.errorBanner.classList.add('visible');
  showToast(title, msg, 'error');
}
function hideError() { dom.errorBanner.classList.remove('visible'); }
function parseRevertReason(e) {
  if (!e) return 'Unknown error';
  const r = e.reason || (e.error && e.error.reason) || (e.info && e.info.error && e.info.error.reason) || (e.revert && e.revert.message) || e.message || '';
  const cleaned = r.replace(/^execution reverted: /, '');
  if (cleaned && !cleaned.startsWith('missing revert data')) return cleaned;
  if (e.code === 'CALL_EXCEPTION') return 'Contract call reverted — pool may not be initialized or address is wrong';
  return 'Transaction reverted';
}

function showToast(title, msg, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');
  toast.innerHTML = `<div class="toast-title">${title}</div><div class="toast-msg">${msg}</div>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 200);
  }, 8000);
}

