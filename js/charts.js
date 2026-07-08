// SPDX-License-Identifier: MIT
// charts.js — Historical charting with TradingView Lightweight Charts

let chart = null;
let candleSeries = null;
const TRADE_CACHE_KEY = 'reciprocity_trade_cache';
const TRADE_CACHE_MAX = 10000;

function getTradeCache() {
  try {
    return JSON.parse(localStorage.getItem(TRADE_CACHE_KEY) || '[]');
  } catch { return []; }
}

function storeTrade(trade) {
  try {
    const cache = getTradeCache();
    cache.push(trade);
    if (cache.length > TRADE_CACHE_MAX) cache.splice(0, cache.length - TRADE_CACHE_MAX);
    localStorage.setItem(TRADE_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function getOHLCV(trades, resolution) {
  const buckets = {};
  const resMs = { '1': 60000, '5': 300000, '15': 900000, '60': 3600000, '240': 14400000, '1D': 86400000 };
  const ms = resMs[resolution] || 300000;

  for (const t of trades) {
    const bucket = Math.floor(t.time / ms) * ms;
    if (!buckets[bucket]) {
      buckets[bucket] = { time: bucket / 1000, open: t.price, high: t.price, low: t.price, close: t.price, volume: t.amount || 0 };
    } else {
      const b = buckets[bucket];
      b.high = Math.max(b.high, t.price);
      b.low = Math.min(b.low, t.price);
      b.close = t.price;
      b.volume += t.amount || 0;
    }
  }
  return Object.values(buckets).sort((a, b) => a.time - b.time);
}

function initChart(containerId) {
  const container = document.getElementById(containerId);
  if (!container || !window.LightweightCharts) return;

  if (chart) { chart.remove(); chart = null; }

  chart = LightweightCharts.createChart(container, {
    layout: { background: { color: '#111822' }, textColor: '#7888a0' },
    grid: { vertLines: { color: '#1e2838' }, horzLines: { color: '#1e2838' } },
    width: container.clientWidth,
    height: 300,
    timeScale: { timeVisible: true, secondsVisible: false },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#3dcf8e', downColor: '#e85858',
    borderUpColor: '#3dcf8e', borderDownColor: '#e85858',
    wickUpColor: '#3dcf8e', wickDownColor: '#e85858',
  });

  new ResizeObserver(() => {
    if (chart) chart.applyOptions({ width: container.clientWidth });
  }).observe(container);
}

function updateChart(resolution) {
  if (!candleSeries) return;
  const trades = getTradeCache();
  const ohlcv = getOHLCV(trades, resolution || '15');
  if (ohlcv.length > 0) {
    candleSeries.setData(ohlcv);
  }
}

function recordSwapPrice(tokensOut, amountsOut) {
  if (!tokensOut || !amountsOut) return;
  const now = Date.now();
  for (let i = 0; i < tokensOut.length; i++) {
    const price = Number(amountsOut[i]) / 1e18;
    if (price > 0) {
      storeTrade({ time: now, price, token: tokensOut[i], amount: Number(amountsOut[i]) });
    }
  }
}

window.initChart = initChart;
window.updateChart = updateChart;
window.recordSwapPrice = recordSwapPrice;
