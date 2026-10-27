/**
 * Deposit + Milestone math — exact port of SM-QuotingTool v7
 * (calcDeposit/calcDepositFlat L7086-7104, msRecalc L7348-7363)
 */

const num = (v, fallback = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Deposit from a grand total. Flat amount wins over percent when provided.
 * @param {object} input
 * @param {number} input.grand Contract grand total
 * @param {number} [input.pct=30] Deposit percent
 * @param {number} [input.flat] Flat deposit amount (overrides pct)
 */
const computeDeposit = (input = {}) => {
  const grand = num(input.grand);
  const flat = num(input.flat);
  let pct;
  let deposit;
  if (flat > 0) {
    deposit = Math.round(flat);
    pct = grand > 0 ? Math.round((flat / grand) * 100) : 0;
  } else {
    pct = num(input.pct, 30) || 30;
    deposit = Math.round((grand * pct) / 100);
  }
  const balance = Math.round(grand - deposit);
  return { grand: Math.round(grand), pct, deposit, balance };
};

/**
 * Milestone schedule totals.
 * @param {object} input
 * @param {number} input.grand Contract grand total
 * @param {Array}  input.rows  [{ label, type, amount }]
 */
const computeMilestones = (input = {}) => {
  const grand = num(input.grand);
  const rows = (Array.isArray(input.rows) ? input.rows : []).map((r) => ({
    label: String(r.label || ""),
    type: r.type || "fixed",
    amount: Math.round(num(r.amount)),
  }));
  const scheduled = rows.reduce((a, r) => a + r.amount, 0);
  const remaining = Math.round(grand - scheduled);
  const pct = grand > 0 ? Math.min(100, Math.round((scheduled / grand) * 100)) : 0;
  return {
    grand: Math.round(grand),
    rows,
    scheduled: Math.round(scheduled),
    remaining,
    pct,
    fullyScheduled: remaining === 0,
  };
};

module.exports = { computeDeposit, computeMilestones };
