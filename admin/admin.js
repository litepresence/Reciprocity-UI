// SPDX-License-Identifier: MIT
// Reciprocity Admin UI — Founder/Promoter Role System

const POOL_ABI_ADMIN = [
  // Views
  'function getStatus() view returns (uint256 supply, uint256 atrSpreadTarget, uint256 emaSpreadTarget, uint256 atrPeriod, uint256 emaPeriod, uint256 atrSpread, int256 spreadAdditive, uint256 avgSpread, uint256 spreadMultiplier, uint256[] lpRoyalties, uint256 txs)',
  'function getBalances() view returns (address[] tokens, uint256[] amounts)',
  'function getAdminState() view returns (address factory, address founder, address founderFund, address promoter, address promoterFund)',
  'function getFounderRoyalties() view returns (address[] tokens, uint256[] amounts)',
  'function getPromoterRoyalties() view returns (address[] tokens, uint256[] amounts)',
  'function getFounderRoyalty(address token) view returns (uint256)',
  'function getPromoterRoyalty(address token) view returns (uint256)',
  // Founder admin writes
  'function setFounder(address newFounder)',
  'function setFounderFund(address fund)',
  'function claimFounderRoyalty(address token)',
  // Promoter admin writes
  'function setPromoter(address newPromoter)',
  'function setPromoterFund(address fund)',
  'function claimPromoterRoyalty(address token)',
  // Events
  'event FounderRoyaltyClaimed(address indexed token, uint256 amount, address destination)',
  'event PromoterRoyaltyClaimed(address indexed token, uint256 amount, address destination)',
  'event FounderTransferred(address indexed newFounder)',
  'event PromoterTransferred(address indexed newPromoter)',
  'event FounderFundUpdated(address indexed newFund)',
  'event PromoterFundUpdated(address indexed newFund)',
  'event FounderRoyaltyUpdated(uint256 newRoyaltyBps)',
  'event PromoterRoyaltyUpdated(uint256 newRoyaltyBps)',
  'event FounderRoyaltyLocked()',
  'event PromoterRoyaltyLocked()',
];

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function status(msg, type='info') {
  const el = $('#status-bar');
  if (!el) return;
  el.className = type;
  el.textContent = msg;
  el.style.display = 'block';
  if (type === 'success' || type === 'error') setTimeout(() => el.style.display = 'none', 5000);
}
function fmt(v, dec=18) {
  if (!v || v === 0n) return '0';
  const s = v.toString();
  if (s.length <= dec) return '0.' + s.padStart(dec, '0');
  return s.slice(0, -dec) + '.' + s.slice(-dec);
}
function fmtAddr(a) { return a && a !== ethers.ZeroAddress ? a.slice(0,6) + '…' + a.slice(-4) : '—'; }

export class AdminUI {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.account = null;
    this.pool = null;
    this.poolAddr = '';
    this.poolState = {};
  }

  async init() {
    $('#btn-connect').onclick = () => this.connect();
    $('#btn-load').onclick = () => this.loadPool();
    // Founder buttons
    const btnClaimFound = $('#btn-claim-found');
    if (btnClaimFound) btnClaimFound.onclick = () => this.claimFounderRoyalty();
    const btnSetFound = $('#btn-set-founder');
    if (btnSetFound) btnSetFound.onclick = () => this.setFounder();
    const btnSetFoundFund = $('#btn-set-found-fund');
    if (btnSetFoundFund) btnSetFoundFund.onclick = () => this.setFounderFund();
    // Promoter buttons
    const btnClaimPromo = $('#btn-claim-promo');
    if (btnClaimPromo) btnClaimPromo.onclick = () => this.claimPromoterRoyalty();
    const btnSetPromo = $('#btn-set-promoter');
    if (btnSetPromo) btnSetPromo.onclick = () => this.setPromoter();
    const btnSetPromoFund = $('#btn-set-promo-fund');
    if (btnSetPromoFund) btnSetPromoFund.onclick = () => this.setPromoterFund();
  }

  async loadEthers() {
    if (window.ethers) return;
    throw new Error('ethers.js not loaded. Check network/refresh.');
  }

  async connect() {
    try {
      status('Connecting wallet…');
      await this.loadEthers();
      if (!window.ethereum) throw new Error('No wallet found. Install MetaMask.');
      this.provider = new ethers.BrowserProvider(window.ethereum);
      await this.provider.send('eth_requestAccounts', []);
      this.signer = await this.provider.getSigner();
      this.account = await this.signer.getAddress();
      const el = $('#connected-addr');
      if (el) el.textContent = fmtAddr(this.account);
      const btn = $('#btn-connect');
      if (btn) { btn.textContent = 'Connected'; btn.disabled = true; }
      const sec = $('#sec-pool');
      if (sec) sec.style.display = 'block';
      status('Connected: ' + this.account, 'success');
    } catch (e) {
      status('Error: ' + e.message, 'error');
    }
  }

  async loadPool() {
    try {
      this.poolAddr = $('#pool-addr').value.trim();
      if (!this.poolAddr) throw new Error('Enter a pool address');
      this.pool = new ethers.Contract(this.poolAddr, POOL_ABI_ADMIN, this.signer);

      await this.loadPoolState();
      status('Pool loaded: ' + this.poolAddr, 'success');
    } catch (e) {
      status('Error: ' + e.message, 'error');
    }
  }

  async loadPoolState() {
    try {
      const [supply, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, atrSpread, spreadAdditive, avgSpread, spreadMultiplier, lpRoyalties, txs] = await this.pool.getStatus();
      const [factory, founder, founderFund, promoter, promoterFund] = await this.pool.getAdminState();
      const founderRoyalties = await this.pool.getFounderRoyalties();
      const promoterRoyalties = await this.pool.getPromoterRoyalties();

      const isFounder = founder.toLowerCase() === this.account.toLowerCase();
      const isPromoter = promoter.toLowerCase() === this.account.toLowerCase();

      this.poolState = { supply, atrSpreadTarget, emaSpreadTarget, atrPeriod, emaPeriod, atrSpread, spreadAdditive, avgSpread, spreadMultiplier, lpRoyalties, txs, factory, founder, founderFund, promoter, promoterFund, founderRoyalties, promoterRoyalties, isFounder, isPromoter };

      // Update status displays
      const el = (id) => document.getElementById(id);
      if (el('st-supply')) el('st-supply').textContent = fmt(supply);
      if (el('st-atr-target')) el('st-atr-target').textContent = atrSpreadTarget.toString();
      if (el('st-ema-target')) el('st-ema-target').textContent = emaSpreadTarget.toString();
      if (el('st-atr-spread')) el('st-atr-spread').textContent = atrSpread.toString();
      if (el('st-spread-add')) el('st-spread-add').textContent = spreadAdditive.toString();
      if (el('st-avg-spread')) el('st-avg-spread').textContent = avgSpread.toString();
      if (el('st-multiplier')) el('st-multiplier').textContent = spreadMultiplier.toString();
      if (el('st-factory')) el('st-factory').textContent = fmtAddr(factory);
      if (el('st-founder')) el('st-founder').textContent = fmtAddr(founder);
      if (el('st-found-fund')) el('st-found-fund').textContent = fmtAddr(founderFund);
      if (el('st-promoter')) el('st-promoter').textContent = fmtAddr(promoter);
      if (el('st-promo-fund')) el('st-promo-fund').textContent = fmtAddr(promoterFund);

      // Role badges
      if (el('badge-founder')) el('badge-founder').innerHTML = isFounder
        ? '<span class="badge badge-green">YOU ARE FOUNDER</span>'
        : '<span class="badge badge-red">NOT FOUNDER</span>';
      if (el('badge-promoter')) el('badge-promoter').innerHTML = isPromoter
        ? '<span class="badge badge-green">YOU ARE PROMOTER</span>'
        : '<span class="badge badge-red">NOT PROMOTER</span>';

      // Fee balances
      const founderFeeList = el('found-fee-list');
      if (founderFeeList) {
        founderFeeList.innerHTML = '';
        for (let i = 0; i < founderRoyalties[0].length; i++) {
          const amt = founderRoyalties[1][i];
          if (amt > 0n) {
            founderFeeList.innerHTML += `<div>${fmtAddr(founderRoyalties[0][i])}: ${fmt(amt)}</div>`;
          }
        }
        if (founderFeeList.innerHTML === '') founderFeeList.innerHTML = '<div>No accumulated fees</div>';
      }
      const promoterFeeList = el('promo-fee-list');
      if (promoterFeeList) {
        promoterFeeList.innerHTML = '';
        for (let i = 0; i < promoterRoyalties[0].length; i++) {
          const amt = promoterRoyalties[1][i];
          if (amt > 0n) {
            promoterFeeList.innerHTML += `<div>${fmtAddr(promoterRoyalties[0][i])}: ${fmt(amt)}</div>`;
          }
        }
        if (promoterFeeList.innerHTML === '') promoterFeeList.innerHTML = '<div>No accumulated fees</div>';
      }

      const poolState = $('#pool-state');
      if (poolState) poolState.style.display = 'block';
    } catch (e) {
      status('Error loading pool: ' + e.message, 'error');
    }
  }

  // ═══════════════ Founder Functions ═══════════════

  async claimFounderRoyalty() {
    const token = $('#claim-found-token')?.value;
    if (!token) { status('Enter token address', 'error'); return; }
    try {
      status('Claiming founder royalty…');
      const tx = await this.pool.claimFounderRoyalty(token);
      status('Pending: ' + tx.hash);
      await tx.wait();
      status('Founder royalty claimed!', 'success');
      await this.loadPoolState();
    } catch (e) {
      status('Error: ' + (e.reason || e.message), 'error');
    }
  }

  async setFounder() {
    const addr = $('#new-founder')?.value;
    if (!addr) { status('Enter founder address', 'error'); return; }
    try {
      status('Transferring founder role…');
      const tx = await this.pool.setFounder(addr);
      await tx.wait();
      status('Founder role transferred', 'success');
      await this.loadPoolState();
    } catch (e) {
      status('Error: ' + (e.reason || e.message), 'error');
    }
  }

  async setFounderFund() {
    const addr = $('#new-found-fund')?.value;
    if (!addr) { status('Enter fund address', 'error'); return; }
    try {
      status('Setting founder fund…');
      const tx = await this.pool.setFounderFund(addr);
      await tx.wait();
      status('Founder fund updated', 'success');
      await this.loadPoolState();
    } catch (e) {
      status('Error: ' + (e.reason || e.message), 'error');
    }
  }

  // ═══════════════ Promoter Functions ═══════════════

  async claimPromoterRoyalty() {
    const token = $('#claim-promo-token')?.value;
    if (!token) { status('Enter token address', 'error'); return; }
    try {
      status('Claiming promoter royalty…');
      const tx = await this.pool.claimPromoterRoyalty(token);
      status('Pending: ' + tx.hash);
      await tx.wait();
      status('Promoter royalty claimed!', 'success');
      await this.loadPoolState();
    } catch (e) {
      status('Error: ' + (e.reason || e.message), 'error');
    }
  }

  async setPromoter() {
    const addr = $('#new-promoter')?.value;
    if (!addr) { status('Enter promoter address', 'error'); return; }
    try {
      status('Transferring promoter role…');
      const tx = await this.pool.setPromoter(addr);
      await tx.wait();
      status('Promoter role transferred', 'success');
      await this.loadPoolState();
    } catch (e) {
      status('Error: ' + (e.reason || e.message), 'error');
    }
  }

  async setPromoterFund() {
    const addr = $('#new-promo-fund')?.value;
    if (!addr) { status('Enter fund address', 'error'); return; }
    try {
      status('Setting promoter fund…');
      const tx = await this.pool.setPromoterFund(addr);
      await tx.wait();
      status('Promoter fund updated', 'success');
      await this.loadPoolState();
    } catch (e) {
      status('Error: ' + (e.reason || e.message), 'error');
    }
  }

}
