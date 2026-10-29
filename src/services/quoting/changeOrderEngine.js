/**
 * Change Order math — exact port of SM-QuotingTool
 * (coCalcAll / coCalcFromMarkup / saveAndPrintCO)
 *
 * Markup % on the CO form is a **target margin on sell**, not markup-on-cost:
 *   sell = round(cost / (1 - markup/100))
 * e.g. cost 50000 + markup 10 → sell 55556, profit 5556, margin 10.0%
 * (NOT cost * 1.10 = 55000, which yields only 9.1% margin)
 */

const round = (n) => Math.round(Number(n) || 0);

/** Client coCalcFromMarkup: sell from cost + target margin %. */
const sellFromMarkup = (cost, markup) => {
  const c = Number(cost);
  const m = Number(markup);
  if (!(c > 0) || !Number.isFinite(m) || m >= 100) return null;
  return Math.round(c / (1 - m / 100));
};

/** Wrong FE formula often used by mistake: sell = cost * (1 + markup/100). */
const sellFromMarkupOnCost = (cost, markup) => {
  const c = Number(cost);
  const m = Number(markup);
  if (!(c > 0) || !Number.isFinite(m)) return null;
  return Math.round(c * (1 + m / 100));
};

/**
 * Compute a change order's totals.
 * @param {object} input
 * @param {number} input.origVal  Original (or running) contract value
 * @param {number} [input.amount] CO sell amount (+/-)
 * @param {number} [input.cost]   CO cost (COGS)
 * @param {number} [input.markup] Target margin % — drives sell when amount omitted,
 *                                fromMarkup=true, or amount matches the wrong
 *                                cost*(1+markup/100) formula
 * @param {boolean} [input.fromMarkup] Force derive sell from cost + markup
 * @returns {{origVal:number, amount:number, cost:(number|null), newTotal:number,
 *            profit:(number|null), margin:(number|null), markup:(number|null)}}
 */
const computeChangeOrder = (input = {}) => {
  const origVal = round(input.origVal);
  const hasCost =
    input.cost !== undefined && input.cost !== null && input.cost !== "" && Number(input.cost) > 0;
  const cost = hasCost ? Number(input.cost) : null;

  const markupRaw = input.markup;
  const hasMarkup =
    markupRaw !== undefined && markupRaw !== null && markupRaw !== "" && Number.isFinite(Number(markupRaw));
  const markup = hasMarkup ? Number(markupRaw) : null;

  const amountProvided =
    input.amount !== undefined && input.amount !== null && input.amount !== "";
  const amountIn = amountProvided ? Number(input.amount) || 0 : null;

  const derivedSell =
    hasCost && hasMarkup && markup < 100 ? sellFromMarkup(cost, markup) : null;
  const wrongSell =
    hasCost && hasMarkup ? sellFromMarkupOnCost(cost, markup) : null;

  const forceFromMarkup =
    input.fromMarkup === true ||
    input.recalcFromMarkup === true ||
    input.deriveFromMarkup === true;

  // Prefer client coCalcFromMarkup when markup drives the calc, or when FE
  // sent the common wrong markup-on-cost sell (cost * 1.10 at 10% → 55000).
  const amountLooksLikeMarkupOnCost =
    amountIn != null &&
    wrongSell != null &&
    derivedSell != null &&
    round(amountIn) === wrongSell &&
    wrongSell !== derivedSell;

  let amount;
  if (forceFromMarkup && derivedSell != null) {
    amount = derivedSell;
  } else if ((!amountProvided || amountLooksLikeMarkupOnCost) && derivedSell != null) {
    amount = derivedSell;
  } else if (amountProvided) {
    amount = round(amountIn);
  } else {
    amount = 0;
  }
  amount = round(amount);

  const newTotal = origVal + amount;
  const profit = hasCost ? round(amount - cost) : null;
  const margin =
    hasCost && amount !== 0
      ? Number((((amount - cost) / Math.abs(amount)) * 100).toFixed(1))
      : null;

  // Mirror coCalcAll: when sell+cost known, exposed markup % = computed margin.
  const markupOut = margin != null ? margin : hasMarkup ? Number(markup.toFixed(1)) : null;

  return {
    origVal,
    amount,
    cost: hasCost ? round(cost) : null,
    newTotal: round(newTotal),
    profit,
    margin,
    markup: markupOut,
  };
};

/**
 * Next CO number + running original value for a parent quote.
 * Mirrors startChangeOrder (L6383-6388).
 * @param {Array} existingCOs COs already on the parent (each has coNum, newTotal)
 * @param {number} baseQuoteTotal grandTotal/sell of the base quote
 */
const nextChangeOrderContext = (existingCOs = [], baseQuoteTotal = 0) => {
  const list = Array.isArray(existingCOs) ? existingCOs : [];
  const coNum = list.length + 1;
  const lastCO = list.length
    ? list.reduce((a, b) => (Number(b.coNum) > Number(a.coNum) ? b : a))
    : null;
  const origVal = lastCO ? round(lastCO.newTotal) : round(baseQuoteTotal);
  return { coNum, origVal };
};

module.exports = {
  computeChangeOrder,
  nextChangeOrderContext,
  sellFromMarkup,
  sellFromMarkupOnCost,
};
