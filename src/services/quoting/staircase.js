/**
 * Multi-story staircase costing — exact port of SM-QuotingTool v7
 * (updateStaircaseCost L8333-8341; default unit = PR.staircaseCost = 35000)
 */

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * @param {object} input
 * @param {number} input.count    Number of fabricated staircases
 * @param {number} [input.unitCost=35000] Sell per staircase
 * @param {number} [input.stories] Building story count (metadata for multi-story SOW)
 */
const computeStaircase = (input = {}) => {
  const count = Math.max(0, Math.round(num(input.count)));
  const unitCost = num(input.unitCost, 35000) || 35000;
  const staircaseSell = count * unitCost;
  return {
    count,
    unitCost,
    staircaseSell,
    stories: input.stories != null ? Math.max(0, Math.round(num(input.stories))) : null,
    include: count > 0 && staircaseSell > 0,
  };
};

module.exports = { computeStaircase };
