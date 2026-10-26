/** PEMB manual line items — port of v6 pembAddOns / pembGetAddOnTotals */

const roundSell = (cost, markupPct) =>
  Math.round((Number(cost) || 0) * (1 + (Number(markupPct) || 0) / 100));

const normalizePembAddOns = (addOns = []) =>
  (Array.isArray(addOns) ? addOns : []).map((x) => {
    const cost = Number(x.cost) || 0;
    const markup = x.markup != null ? Number(x.markup) : 25;
    const sell =
      x.sell != null && x.sell !== ""
        ? Number(x.sell) || 0
        : roundSell(cost, markup);
    return {
      item: x.item || "",
      cost,
      markup,
      sell,
      note: x.note || "",
      inQuote: x.inQuote !== false,
      inSOW: x.inSOW !== false,
    };
  });

const sumPembAddOnTotals = (addOns = []) => {
  let sell = 0;
  let cost = 0;
  normalizePembAddOns(addOns).forEach((x) => {
    if (!x.inQuote) return;
    sell += x.sell || 0;
    cost += x.cost || 0;
  });
  return {
    sell: Math.round(sell),
    cost: Math.round(cost),
    profit: Math.round(sell - cost),
  };
};

module.exports = {
  normalizePembAddOns,
  sumPembAddOnTotals,
};
