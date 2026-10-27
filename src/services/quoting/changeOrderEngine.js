/**
 * Change Order math — exact port of SM-QuotingTool v7
 * (coCalcAll / coCalcFromMarkup / saveAndPrintCO, attachment L6471-6560)
 */

const round = (n) => Math.round(Number(n) || 0);

/**
 * Compute a change order's totals.
 * @param {object} input
 * @param {number} input.origVal  Original (or running) contract value
 * @param {number} [input.amount] CO sell amount (+/-). If omitted but cost+markup
 *                                are supplied, it is derived: sell = cost/(1-markup/100)
 * @param {number} [input.cost]   CO cost (COGS)
 * @param {number} [input.markup] Markup % (used only to derive amount when amount is blank)
 * @returns {{origVal:number, amount:number, cost:(number|null), newTotal:number,
 *            profit:(number|null), margin:(number|null)}}
 */
const computeChangeOrder = (input = {}) => {
  const origVal = round(input.origVal);
  const hasCost =
    input.cost !== undefined && input.cost !== null && input.cost !== "" && Number(input.cost) > 0;
  const cost = hasCost ? Number(input.cost) : null;

  let amount;
  const amountProvided =
    input.amount !== undefined && input.amount !== null && input.amount !== "";
  if (amountProvided) {
    amount = Number(input.amount) || 0;
  } else if (hasCost && input.markup != null && input.markup !== "" && Number(input.markup) < 100) {
    // coCalcFromMarkup: sell = cost / (1 - markup/100)
    amount = Math.round(cost / (1 - Number(input.markup) / 100));
  } else {
    amount = 0;
  }
  amount = round(amount);

  const newTotal = origVal + amount;
  const profit = hasCost ? round(amount - cost) : null;
  const margin =
    hasCost && amount !== 0
      ? Number(((amount - cost) / Math.abs(amount) * 100).toFixed(1))
      : null;

  return {
    origVal,
    amount,
    cost: hasCost ? round(cost) : null,
    newTotal: round(newTotal),
    profit,
    margin,
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

module.exports = { computeChangeOrder, nextChangeOrderContext };
