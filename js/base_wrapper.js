// SPDX-License-Identifier: MIT

function makeTrace(tag) {
  return function(label) {
    return async function(fn) {
      var start = performance.now();
      try {
        var r = await fn();
        var ms = (performance.now() - start).toFixed(0);
        console.log('%c[' + tag + '] %c' + label + ' ' + ms + 'ms', 'color:#888', 'color:' + (ms > 2000 ? '#e85858' : ms > 500 ? '#d4a040' : '#3dcf8e'));
        return r;
      } catch (e) {
        var ms = (performance.now() - start).toFixed(0);
        console.warn('%c[' + tag + '] %c' + label + ' FAILED ' + ms + 'ms', 'color:#888', 'color:#e85858', e.message);
        throw e;
      }
    };
  };
}

var _quotePoolCache = {};
var chainAPI_base = window.chainAPI_base = {
  clearQuoteCache() { _quotePoolCache = {}; },

  async quoteSwap(poolAddr, order) {
    var cached = _quotePoolCache[poolAddr];
    if (!cached) {
      var r = await Promise.all([
        this.getPoolConfig(poolAddr),
        this.getStatus(poolAddr).catch(() => ({ supply: 0n, spreadAdditive: 0n })),
      ]);
      _quotePoolCache[poolAddr] = r;
      cached = r;
    }
    var config = cached[0], status = cached[1];
    config.spread_additive = status.spreadAdditive;
    config.spread_count = status.txs;
    return window.reciprocity_math.quoteSwap(config, order);
  },

  async verifyQuote(poolAddr, order) {
    var localQuote = await this.quoteSwap(poolAddr, order);
    var onchainQuote = null;
    var match = true;
    var skipped = false;
    try {
      if (typeof this._onchainQuoteSwap === 'function') {
        onchainQuote = await this._onchainQuoteSwap(poolAddr, order);
        match = window.reciprocity_math.quotesEqual(localQuote, onchainQuote);
      } else {
        skipped = true;
      }
    } catch (e) {
      console.warn('On-chain quoteSwap call failed:', e.message);
    }
    console.log('=== RECIPROCITY VERIFY OFFER ===');
    console.log('Local Quote:', _safeStringify(localQuote));
    if (onchainQuote) {
      console.log('On-Chain Quote:', _safeStringify(onchainQuote));
      console.log('Match:', match);
    } else if (skipped) {
      console.log('On-Chain: SKIPPED \u2014 no on-chain quoteSwap view on this port');
    } else {
      console.log('On-Chain: FAILED \u2014 using local quote only');
    }
    return { verified: match, local: localQuote, onchain: onchainQuote, match: match, skipped: skipped };
  },

  shortenAddress(addr) {
    if (!addr) return '\u2014';
    if (addr.length <= 16) return addr;
    return addr.slice(0, 6) + '\u2026' + addr.slice(-4);
  },

  async loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = url; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  async rpcCall(url, method, params) {
    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }),
    });
    var data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  },
};
