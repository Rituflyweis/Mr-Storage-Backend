/**
 * Custom Quote math — exact port of SM-QuotingTool v7
 * (updateCustomCalc / renderCustomQuote, attachment L8726-8770)
 */

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
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

  return {
    matCost: mat,
    freight,
    laborCost: labor,
    marginPct: mPct,
    sellOverride,
    totalCost: Math.round(totalCost),
    sell: Math.round(sell),
    profit: Math.round(profit),
    profPct,
  };
};

module.exports = { computeCustomQuote };
