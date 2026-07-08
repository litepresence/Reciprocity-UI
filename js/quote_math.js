// SPDX-License-Identifier: MIT
window.reciprocity_math = (function () {
  var BASIS = 10000n;

  function safeMul(a, b) {
    if (a === 0n || b === 0n) return 0n;
    return a * b;
  }

  function ceilDiv(a, b) {
    if (b === 0n) return 0n;
    if (a === 0n) return 0n;
    return (a - 1n) / b + 1n;
  }

  function computeKonstant(bals, genesis, n, scale, weights) {
    if (n === 0 || scale === 0n) return 0n;
    if (!weights || weights.length === 0) return scale;
    var hasNonZero = false;
    for (var ci = 0; ci < weights.length; ci++) {
      if (weights[ci] !== 0n) { hasNonZero = true; break; }
    }
    if (!hasNonZero) return scale;
    var sumLn = 0n;
    var sumWeights = 0n;
    var count = 0;
    for (var i = 0; i < n && i < weights.length; i++) {
      var b = bals[i];
      var g = genesis[i];
      if (g === 0n) continue;
      var w = weights[i];
      if (w === 0n) continue;
      var r = safeMul(b, BASIS) / g;
      if (r === 0n) continue;
      var ln = (2n * BASIS * (r - BASIS)) / (r + BASIS);
      sumLn += w * ln;
      sumWeights += w;
      count++;
    }
    if (count === 0 || sumWeights === 0n) return scale;
    var avg = sumLn / sumWeights;
    var padeNum = 2n * BASIS + avg;
    var padeDen = 2n * BASIS - avg;
    if (padeDen <= 0n) return 0n;
    if (padeNum <= 0n) return 0n;
    return safeMul(scale, padeNum) / padeDen;
  }

  function computeAequitas(pre, post, preK, postK, n, weights) {
    if (!weights || weights.length === 0) return BASIS;
    var hasNonZero = false;
    for (var ci = 0; ci < weights.length; ci++) {
      if (weights[ci] !== 0n) { hasNonZero = true; break; }
    }
    if (!hasNonZero) return BASIS;
    var smaller = postK < preK ? post : pre;
    var larger = postK < preK ? pre : post;
    var ratios = new Array(n);
    var sumWeights = 0n;
    for (var i = 0; i < n && i < weights.length; i++) {
      var w = weights[i];
      if (w > 0n) sumWeights += w;
    }
    if (sumWeights === 0n) sumWeights = BigInt(n);
    for (var i = 0; i < n; i++) {
      ratios[i] = larger[i] > 0n ? smaller[i] * BASIS / larger[i] : 0n;
    }
    var total = 0n;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var wj = (j < weights.length) ? weights[j] : 0n;
        var absDiff = ratios[i] > ratios[j] ? ratios[i] - ratios[j] : ratios[j] - ratios[i];
        total += absDiff * wj;
      }
    }
    var avgErr = total / (sumWeights * BigInt(n) * BigInt(n));
    var deviation = avgErr > BASIS ? 0n : BASIS - avgErr;
    return 1n + BASIS - (deviation * deviation / BASIS);
  }

  function computeFees(amountsOut, finalSpread) {
    var feeRate = finalSpread;
    return amountsOut.map(function (a) {
      if (a <= 3n) return a;
      var fee = a > 0n ? ceilDiv(safeMul(a, feeRate), BASIS) : 0n;
      if (fee < 3n) fee = 3n;
      return fee > a ? a : fee;
    });
  }

  function royaltySplit(rawFee, founderRoyalty, promoterRoyalty) {
    if (rawFee >= 3n) {
      var fg = 1n, pg = 1n, lg = 1n;
    } else if (rawFee >= 2n) {
      var fg = 1n, pg = 1n, lg = 0n;
    } else if (rawFee >= 1n) {
      var fg = 1n, pg = 0n, lg = 0n;
    } else {
      var fg = 0n, pg = 0n, lg = 0n;
    }
    var remaining = rawFee - fg - pg - lg;
    var fe = remaining * founderRoyalty / BASIS;
    var pe = remaining * promoterRoyalty / BASIS;
    // ponytail: proportional safety cap when royalty rates sum > BASIS
    // (e.g. test configurations with both at 100%). The spec assumes
    // founder+promoter <= BASIS so this path is never hit in production.
    if (fe + pe > remaining) {
      var scale = remaining * BASIS / (fe + pe);
      fe = fe * scale / BASIS;
      pe = pe * scale / BASIS;
    }
    var le = remaining - fe - pe;
    return { founderShare: fg + fe, promoterShare: pg + pe, lpShare: lg + le };
  }

  function quoteSwap(poolData, order) {
    var n = Number(poolData.factors);
    var preBals = poolData.balances.map(function (v) { return typeof v === 'bigint' ? v : BigInt(v); });
    var genesis = poolData.genesis.map(function (v) { return typeof v === 'bigint' ? v : BigInt(v); });
    var scale = typeof poolData.scale === 'bigint' ? poolData.scale : BigInt(poolData.scale || 0);
    var spreadMultiplier = typeof poolData.spread_multiplier === 'bigint' ? poolData.spread_multiplier : BigInt(poolData.spread_multiplier || BASIS);
    var spreadAdditive = typeof poolData.spread_additive === 'bigint' ? poolData.spread_additive : BigInt(poolData.spread_additive || 0);
    var founderRoyalty = typeof poolData.founder_royalty === 'bigint' ? poolData.founder_royalty : BigInt(poolData.founder_royalty || 500);
    var promoterRoyalty = typeof poolData.promoter_royalty === 'bigint' ? poolData.promoter_royalty : BigInt(poolData.promoter_royalty || 0);
    var tokenAddrs = poolData.tokens;
    var weights = (poolData.weights || []).map(function (v) { return v != null && v !== false ? (typeof v === 'bigint' ? v : BigInt(v)) : 1n; });

    var amountsIn = (order.amountsIn || []).map(function (a) { return typeof a === 'bigint' ? a : BigInt(a || 0); });
    var amountsOut = (order.amountsOut || []).map(function (a) { return typeof a === 'bigint' ? a : BigInt(a || 0); });
    var sharesIn = typeof order.sharesIn === 'bigint' ? order.sharesIn : BigInt(order.sharesIn || 0);

    var inByAddr = {};
    var outByAddr = {};
    for (var i = 0; i < (order.tokensIn || []).length; i++) {
      inByAddr[order.tokensIn[i].toLowerCase()] = amountsIn[i];
    }
    for (var i = 0; i < (order.tokensOut || []).length; i++) {
      outByAddr[order.tokensOut[i].toLowerCase()] = amountsOut[i];
    }

    var preK = computeKonstant(preBals, genesis, n, scale, weights);

    var postBals = preBals.slice();
    for (var i = 0; i < n; i++) {
      var addr = tokenAddrs[i].toLowerCase();
      if (inByAddr[addr]) postBals[i] += inByAddr[addr];
      if (outByAddr[addr]) {
        if (outByAddr[addr] > postBals[i]) {
          return { tokensOut: tokenAddrs, amountsOut: preBals.map(function () { return 0n; }), reciprocity: -1n, feeAmounts: preBals.map(function () { return 0n; }) };
        }
        postBals[i] -= outByAddr[addr];
      }
    }

    var postK = computeKonstant(postBals, genesis, n, scale, weights);

    var spread = computeAequitas(preBals, postBals, preK, postK, n, weights);
    spread = spread * spreadMultiplier / BASIS + spreadAdditive;
    if (spread < 1n) spread = 1n;

    // ponytail: no warmup override — matches contract's quote_swap (read-only), not swap
    // Contract's state-changing swap() applies warmup (spread_count<=2 → emaSpreadTarget),
    // but quote_swap() does not. Local math mirrors quote_swap() for correct on-chain matching.

    // Build factors-length amountsOutFull for fee computation
    var amountsOutFull = new Array(n).fill(0n);
    for (var i = 0; i < (order.tokensOut || []).length; i++) {
      var idx = tokenAddrs.map(function(a) { return a.toLowerCase(); }).indexOf(order.tokensOut[i].toLowerCase());
      if (idx >= 0) amountsOutFull[idx] = amountsOut[i];
    }
    var fees = computeFees(amountsOutFull, spread);

    var tBals = postBals.slice();
    var feeAmounts = new Array(n).fill(0n);
    var tOutAmounts = new Array(n).fill(0n);
    for (var i = 0; i < n; i++) {
      var addr = tokenAddrs[i].toLowerCase();
      var outIdx = -1;
      for (var j = 0; j < (order.tokensOut || []).length; j++) {
        if (order.tokensOut[j].toLowerCase() === addr) { outIdx = j; break; }
      }
      if (outIdx >= 0) {
        var rawFee = fees[i];  // fees is factors-length, indexed by token position
        var split = royaltySplit(rawFee, founderRoyalty, promoterRoyalty);
        tOutAmounts[i] = amountsOut[outIdx] - split.lpShare;
        feeAmounts[i] = rawFee;
        tBals[i] += split.lpShare - split.founderShare - split.promoterShare;
      }
    }
    var tithedK = computeKonstant(tBals, genesis, n, scale, weights);

    var sharesDelta = sharesIn + tithedK - preK;

    var outToks = (order.tokensOut||[]).length ? order.tokensOut : tokenAddrs;
    var idxOf = {};
    for (var i=0;i<tokenAddrs.length;i++) idxOf[tokenAddrs[i].toLowerCase()]=i;
    return {
      tokensOut: outToks,
      amountsOut: outToks.map(function(t){var i=idxOf[t.toLowerCase()];return i!==undefined?(tOutAmounts[i]>0n?tOutAmounts[i]:0n):0n;}),
      reciprocity: sharesDelta,
      feeAmounts: outToks.map(function(t){var i=idxOf[t.toLowerCase()];return i!==undefined?(feeAmounts[i]>0n?feeAmounts[i]:0n):0n;}),
    };
  }

  function getTvwapPrices(tvwapK, balances, tokens) {
    var n = tokens.length;
    var prices = new Array(n);
    for (var i = 0; i < n; i++) {
      prices[i] = balances[i] > 0n ? tvwapK * BASIS / balances[i] : 0n;
    }
    return { tokens: tokens, prices: prices };
  }

  function quotesEqual(a, b, tolerance) {
    if (tolerance === undefined) tolerance = 1n;
    if (!a || !b) return false;
    var aOut = a.amountsOut || a;
    var bOut = b.amountsOut || b;
    if (aOut.length !== bOut.length) return false;
    for (var i = 0; i < aOut.length; i++) {
      var diff = aOut[i] > bOut[i] ? aOut[i] - bOut[i] : bOut[i] - aOut[i];
      if (diff > tolerance) return false;
    }
    var aSd = typeof a.reciprocity === 'bigint' ? a.reciprocity : BigInt(a.reciprocity || 0);
    var bSd = typeof b.reciprocity === 'bigint' ? b.reciprocity : BigInt(b.reciprocity || 0);
    var sdDiff = aSd > bSd ? aSd - bSd : bSd - aSd;
    if (sdDiff > tolerance) return false;
    return true;
  }

  return {
    safeMul: safeMul,
    computeKonstant: computeKonstant,
    computeAequitas: computeAequitas,
    computeFees: computeFees,
    quoteSwap: quoteSwap,
    quotesEqual: quotesEqual,
    getTvwapPrices: getTvwapPrices,
    BASIS: BASIS,
  };
})();
