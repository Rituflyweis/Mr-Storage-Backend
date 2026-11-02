/**
 * Custom Quote math — exact port of SM-QuotingTool v7
 * (updateCustomCalc / renderCustomQuote, attachment L8726-8770)
 */

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Pro-rate sell price across cost buckets so pricing lines sum to total sell. */
const allocateSellBreakdown = (mat, freight, labor, sell) => {
  const totalCost = mat + freight + labor;
  const sellR = Math.round(sell);
  if (totalCost <= 0 || sellR <= 0) {
    return { matSell: 0, freightSell: 0, laborSell: 0 };
  }
  if (Math.abs(sellR - Math.round(totalCost)) < 1) {
    return {
      matSell: Math.round(mat),
      freightSell: Math.round(freight),
      laborSell: Math.round(labor),
    };
  }
  const matSell = Math.round((mat / totalCost) * sellR);
  const freightSell = Math.round((freight / totalCost) * sellR);
  const laborSell = sellR - matSell - freightSell;
  return { matSell, freightSell, laborSell };
};

/**
 * @param {object} input
 * @param {number} input.matCost   Material cost
 * @param {number} input.freight   Freight cost
 * @param {number} input.laborCost Labor cost
 * @param {number} [input.marginPct=20] Target margin %
 * @param {number} [input.sellOverride] Fixed sell price (wins over margin)
 */
const computeCustomQuote = (input = {}) => {
  const mat = num(input.matCost);
  const freight = num(input.freight);
  const labor = num(input.laborCost);
  const mPct = num(input.marginPct, 20);
  const sellOverrideRaw = num(input.sellOverride, 0);
  const sellOverride = sellOverrideRaw > 0 ? sellOverrideRaw : null;

  const totalCost = mat + freight + labor;
  const sell = sellOverride || totalCost / (1 - mPct / 100);
  const profit = sell - totalCost;
  const profPct = sell > 0 ? Number(((profit / sell) * 100).toFixed(1)) : 0;
  const sellR = Math.round(sell);
  const breakdown = allocateSellBreakdown(mat, freight, labor, sellR);

  return {
    matCost: mat,
    freight,
    laborCost: labor,
    marginPct: mPct,
    sellOverride,
    totalCost: Math.round(totalCost),
    sell: sellR,
    profit: Math.round(profit),
    profPct,
    matSell: breakdown.matSell,
    freightSell: breakdown.freightSell,
    laborSell: breakdown.laborSell,
  };
};

module.exports = { computeCustomQuote, allocateSellBreakdown };
