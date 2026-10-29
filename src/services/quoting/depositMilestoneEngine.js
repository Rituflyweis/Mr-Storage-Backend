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
 * Normalize a milestone row. Supports:
 * - type "pct" | "percent" | "%" with `pct` (or amount used as pct)
 * - type "fixed" | "$" | "amount" with `amount`
 * UI "Deposit / 30%" → { label: "Deposit", type: "pct", pct: 30 }
 */
const normalizeMilestoneRow = (r = {}, grand = 0) => {
  const label = String(r.label || r.desc || r.description || "").trim();
  const typeRaw = String(r.type || "").toLowerCase();
  const isPct =
    typeRaw === "pct" ||
    typeRaw === "percent" ||
    typeRaw === "%" ||
    typeRaw === "percentage" ||
    (r.pct != null && r.pct !== "" && typeRaw !== "fixed" && typeRaw !== "$" && typeRaw !== "amount");

  let pct = null;
  let amount;
  if (isPct) {
    pct = num(r.pct != null ? r.pct : r.percent != null ? r.percent : r.amount);
    amount = Math.round((grand * pct) / 100);
  } else {
    amount = Math.round(num(r.amount));
    pct = grand > 0 ? Math.round((amount / grand) * 1000) / 10 : null;
  }

  return {
    label: label || "Milestone",
    type: isPct ? "pct" : "fixed",
    pct: pct != null ? pct : undefined,
    amount,
  };
};

/**
 * Milestone schedule totals.
 * @param {object} input
 * @param {number} input.grand Contract grand total
 * @param {Array}  input.rows  [{ label, type, amount, pct }]
 */
const computeMilestones = (input = {}) => {
  const grand = num(input.grand);
  const rows = (Array.isArray(input.rows) ? input.rows : []).map((r) =>
    normalizeMilestoneRow(r, grand),
  );
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

const isDepositLabel = (label) => /^deposit\b/i.test(String(label || "").trim());
const isBalanceLabel = (label) =>
  /remaining|balance\s*due|balance$/i.test(String(label || "").trim());

/**
 * Build / upsert milestone rows from Request Deposit terms so quote preview
 * and payment milestones stay in sync when only a deposit is saved.
 *
 * - Empty or deposit-only schedules → Deposit + Remaining Balance Due
 * - Existing custom milestones → Deposit row upserted first; other rows kept
 */
const syncDepositIntoMilestoneRows = (existingRows = [], depositResult = {}, opts = {}) => {
  const grand = num(depositResult.grand);
  const deposit = Math.round(num(depositResult.deposit));
  const balance = Math.round(
    depositResult.balance != null ? num(depositResult.balance) : grand - deposit,
  );
  const pct = num(depositResult.pct);
  const useFlat = opts.flat != null && num(opts.flat) > 0;

  const depositRow = useFlat
    ? { label: "Deposit", type: "fixed", amount: deposit, pct: pct || undefined }
    : { label: "Deposit", type: "pct", pct: pct || 0, amount: deposit };

  const balanceRow = {
    label: "Remaining Balance Due",
    type: "fixed",
    amount: balance,
    pct: grand > 0 ? Math.round((balance / grand) * 1000) / 10 : undefined,
  };

  const rows = Array.isArray(existingRows) ? existingRows : [];
  const others = rows.filter(
    (r) => !isDepositLabel(r?.label) && !isBalanceLabel(r?.label),
  );

  if (!others.length) {
    return [depositRow, balanceRow];
  }
  return [depositRow, ...others];
};

/**
 * Milestone rows derived from saved depositTerms (for preview when schedule empty).
 */
const depositTermsToMilestoneRows = (depositTerms = null, grand = 0) => {
  if (!depositTerms || (depositTerms.deposit == null && depositTerms.pct == null && !depositTerms.flat)) {
    return [];
  }
  const d = computeDeposit({
    grand: grand || depositTerms.grand,
    pct: depositTerms.pct,
    flat: depositTerms.flat,
  });
  return syncDepositIntoMilestoneRows([], d, { flat: depositTerms.flat });
};

module.exports = {
  computeDeposit,
  computeMilestones,
  normalizeMilestoneRow,
  syncDepositIntoMilestoneRows,
  depositTermsToMilestoneRows,
  isDepositLabel,
  isBalanceLabel,
};
