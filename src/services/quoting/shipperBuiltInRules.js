/** Built-in row matchers from SM-QuotingTool v6 applyBuiltInItemRules */

const parseLengthFt = (str) => {
  str = String(str || "").trim();
  const ftIn = str.match(/(\d+)['\u2019][- ]*(\d+)["\u201d]/);
  if (ftIn) return parseFloat(ftIn[1]) + parseFloat(ftIn[2]) / 12;
  const ftOnly = str.match(/(\d+(?:\.\d+)?)['\u2019]/);
  if (ftOnly) return parseFloat(ftOnly[1]);
  const inOnly = str.match(/(\d+(?:\.\d+)?)\s*["\u201d]/);
  if (inOnly) return parseFloat(inOnly[1]) / 12;
  return 0;
};

const findHeaderCols = (data) => {
  let hRow = -1;
  const cols = {};
  for (let r = 0; r < Math.min(data.length, 8); r++) {
    const row = data[r];
    for (let c = 0; c < row.length; c++) {
      const h = String(row[c] || "")
        .toLowerCase()
        .trim();
      if (h === "qty" || h === "quantity") {
        cols.qty = c;
        hRow = r;
      }
      if (h === "part" || h === "part no" || h === "part number" || h === "part#")
        cols.part = c;
      if (h === "description" || h === "desc") cols.desc = c;
      if (h === "length" || h === "len") cols.len = c;
      if (h === "weight" || h === "wt" || h === "total weight") cols.wt = c;
      if (h === "mark") cols.mark = c;
      if (h === "squares" || h === "sq" || h === "square") cols.sq = c;
      if (h === "square feet" || h === "sq ft" || h === "sf") cols.sqft = c;
    }
    if (hRow >= 0) break;
  }
  return { hRow, cols };
};

/**
 * @param {object} opts
 * @param {object} opts.PR pricing rates object
 * @param {'red-iron'|'galvanized'} [opts.steelFinish]
 */
const applyBuiltInItemRules = (data, _sheetName, sf, opts = {}) => {
  const PR = opts.PR || {};
  const steelFinish = opts.steelFinish || "red-iron";
  const matched = [];
  const { hRow, cols } = findHeaderCols(data);
  if (hRow < 0 || cols.qty === undefined) return matched;

  for (let r = hRow + 1; r < data.length; r++) {
    const row = data[r];
    const qty = parseFloat(row[cols.qty]) || 0;
    if (!qty) continue;

    const desc = String(row[cols.desc] || "")
      .trim()
      .toLowerCase();
    const part = String(row[cols.part] || "")
      .trim()
      .toLowerCase();
    const markVal =
      cols.mark !== undefined
        ? String(row[cols.mark] || "")
            .trim()
            .toLowerCase()
        : "";
    const combined = `${desc} ${part} ${markVal}`;
    const lenStr = cols.len !== undefined ? String(row[cols.len] || "") : "";
    const wt =
      cols.wt !== undefined
        ? parseFloat(String(row[cols.wt] || "").replace(/,/g, "")) || 0
        : 0;
    const lf = parseLengthFt(lenStr) * qty;

    if (/\bw\d+\s*x\s*\d+/.test(combined) || /\bw-\d+/.test(combined)) {
      if (wt > 0) {
        matched.push({
          label: `W-Beam (${desc})`,
          cat: "hss",
          method: "per_lb",
          qty,
          lf,
          weight: wt,
          price: wt * (PR.hss || 0),
          rateStr: `$${PR.hss}/lb`,
          detail: `${qty} pcs · ${wt.toFixed(0)} lbs`,
        });
        continue;
      }
    }

    if (/\bhss\b/.test(combined)) {
      if (wt > 0) {
        matched.push({
          label: `HSS Steel (${desc})`,
          cat: "hss",
          method: "per_lb",
          qty,
          lf,
          weight: wt,
          price: wt * (PR.hss || 0),
          rateStr: `$${PR.hss}/lb`,
          detail: `${qty} pcs · ${wt.toFixed(0)} lbs`,
        });
        continue;
      }
    }

    if (combined.includes("gutter")) {
      const linFt = lf > 0 ? lf : qty;
      if (linFt > 0) {
        matched.push({
          label: "Gutters",
          cat: "trim",
          method: "per_lf",
          qty,
          lf: linFt,
          weight: wt,
          price: linFt * (PR.gutterLF || 0),
          rateStr: `$${PR.gutterLF}/LF`,
          detail: `${linFt.toFixed(0)} LF`,
        });
        continue;
      }
    }

    if (combined.includes("downspout") || combined.includes("down spout")) {
      const linFt = lf > 0 ? lf : qty;
      if (linFt > 0) {
        matched.push({
          label: "Downspouts",
          cat: "trim",
          method: "per_lf",
          qty,
          lf: linFt,
          weight: wt,
          price: linFt * (PR.downspoutLF || 0),
          rateStr: `$${PR.downspoutLF}/LF`,
          detail: `${linFt.toFixed(0)} LF`,
        });
        continue;
      }
    }

    if (
      (combined.includes("8x7") ||
        combined.includes("8'x7'") ||
        combined.includes("8 x 7") ||
        combined.includes("8' x 7'")) &&
      (combined.includes("garage") ||
        combined.includes("door") ||
        combined.includes("o/h") ||
        combined.includes("overhead"))
    ) {
      matched.push({
        label: "8x7 Garage Door",
        cat: "opening",
        method: "flat_each",
        qty,
        lf: 0,
        weight: wt,
        price: qty * (PR.door8x7 || 0),
        rateStr: `$${PR.door8x7}/door`,
        detail: `${qty} door(s)`,
      });
      continue;
    }

    if (
      (combined.includes("3x7") ||
        combined.includes("3'x7'") ||
        combined.includes("3 x 7") ||
        combined.includes("3' x 7'")) &&
      (combined.includes("garage") ||
        combined.includes("door") ||
        combined.includes("man door") ||
        combined.includes("walk"))
    ) {
      matched.push({
        label: "3x7 Door",
        cat: "opening",
        method: "flat_each",
        qty,
        lf: 0,
        weight: wt,
        price: qty * (PR.door3x7 || 0),
        rateStr: `$${PR.door3x7}/door`,
        detail: `${qty} door(s)`,
      });
      continue;
    }

    const isFlushType =
      combined.includes("flush header") ||
      combined.includes("flush beam") ||
      combined.includes("double header") ||
      combined.includes("dbl header") ||
      combined.includes("mullion") ||
      (combined.includes("flush") && combined.includes("header"));

    if (isFlushType && wt > 0) {
      const flushLabel = combined.includes("double header") || combined.includes("dbl header")
        ? "Double Header"
        : combined.includes("mullion")
          ? "Mullion"
          : "Flush Header";
      matched.push({
        label: flushLabel,
        cat: "opening",
        method: "per_lb",
        qty,
        lf,
        weight: wt,
        price: wt * (PR.flushHeader || 0),
        rateStr: `$${PR.flushHeader}/lb`,
        detail: `${qty} pcs · ${wt.toFixed(0)} lbs`,
      });
      continue;
    }

    const partTrimmed = part.trim();
    const isColdFormedSKU = /^\d{3,4}[scz]\d{3}-\d{2,3}[rz]?$/i.test(partTrimmed);
    const endsR = /[rR]$/.test(partTrimmed);
    const endsZ = /[zZ]$/.test(partTrimmed);

    const isStructuralItem =
      isColdFormedSKU ||
      combined.includes("support post") ||
      combined.includes("support angle") ||
      combined.includes("support col") ||
      combined.includes("support beam") ||
      combined.includes("red iron") ||
      combined.includes("red oxide") ||
      (combined.includes("purlin") && (endsR || endsZ)) ||
      (combined.includes("girt") && (endsR || endsZ)) ||
      (combined.includes("cee") && (endsR || endsZ)) ||
      (combined.includes("zee") && (endsR || endsZ));

    if (isStructuralItem && !isFlushType && wt > 0) {
      const detectedGalv =
        endsZ ||
        combined.includes("galvanized") ||
        combined.includes("galv") ||
        combined.includes(" z ") ||
        desc.includes(",galv,");
      const isGalv =
        steelFinish === "galvanized"
          ? true
          : steelFinish === "red-iron"
            ? false
            : detectedGalv;
      const finishRate = isGalv ? PR.galvSteel : PR.redIron;
      const finishLabel = isGalv ? "Galvanized" : "Red Iron";
      const rxLabel = combined.includes("support post")
        ? `Support Post (${finishLabel})`
        : combined.includes("support angle")
          ? `Support Angle (${finishLabel})`
          : combined.includes("purlin")
            ? `Purlin (${finishLabel})`
            : combined.includes("girt")
              ? `Girt (${finishLabel})`
              : isColdFormedSKU
                ? `Structural Member ${partTrimmed.toUpperCase()} (${finishLabel})`
                : `Structural Steel (${finishLabel})`;
      matched.push({
        label: rxLabel,
        cat: "secondary",
        method: "per_lb",
        qty,
        lf,
        weight: wt,
        price: wt * finishRate,
        rateStr: `$${Number(finishRate).toFixed(3)}/lb (${finishLabel})`,
        detail: `${qty} pcs · ${wt.toFixed(0)} lbs · ${finishLabel}`,
        isStructuralFinish: true,
        detectedGalv,
      });
      continue;
    }

    const isMandoor =
      combined.includes("man door") ||
      combined.includes("mandoor") ||
      combined.includes("hollow metal") ||
      combined.includes("hollow steel") ||
      (combined.includes("exterior") && combined.includes("door")) ||
      combined.includes("hm door") ||
      combined.includes("h.m. door") ||
      combined.includes("exterior mandoor");
    if (isMandoor) {
      matched.push({
        label: "Man Door / Hollow Metal Door",
        cat: "opening",
        method: "flat_each",
        qty,
        lf: 0,
        weight: wt,
        price: qty * (PR.mandoor || 0),
        rateStr: `$${PR.mandoor}/door`,
        detail: `${qty} door(s) @ $${Number(PR.mandoor || 0).toLocaleString()} ea`,
      });
      continue;
    }

    if (
      combined.includes("insulation") ||
      combined.includes("insul ") ||
      combined.includes("vapor barrier") ||
      combined.includes("batt insul") ||
      combined.includes("blanket insul") ||
      combined.includes("spray foam")
    ) {
      continue;
    }

    const isFastenerRow =
      combined.includes("screw") ||
      combined.includes("fastener") ||
      combined.includes("hex bolt") ||
      combined.includes("tek screw") ||
      combined.includes("self-drill") ||
      combined.includes("zip screw") ||
      combined.includes("washer hd") ||
      combined.includes("pancake") ||
      combined.includes("#10-") ||
      combined.includes("#12-") ||
      combined.includes("#14-");
    if (isFastenerRow && qty > 0) {
      const screwPrice = qty * (PR.screwEach || 0);
      matched.push({
        label: "Fasteners / Screws",
        cat: "fasteners",
        method: "flat_each",
        qty,
        lf: 0,
        weight: 0,
        price: screwPrice,
        rateStr: `$${PR.screwEach}/screw`,
        detail: `${qty.toLocaleString()} screws @ $${PR.screwEach} ea`,
      });
      continue;
    }

    if (
      combined.includes("wedge bolt") ||
      combined.includes("wedgebolt") ||
      combined.includes("wedge anchor") ||
      (combined.includes("wedge") && combined.includes("bolt"))
    ) {
      if (qty > 0) {
        matched.push({
          label: "Wedge Bolts",
          cat: "fasteners",
          method: "flat_each",
          qty,
          lf: 0,
          weight: wt,
          price: qty * (PR.wedgeBolt || 0),
          rateStr: `$${PR.wedgeBolt}/ea`,
          detail: `${qty.toLocaleString()} bolts @ $${PR.wedgeBolt} ea`,
        });
        continue;
      }
    }

    const isMloc =
      part.includes("mloc") ||
      combined.includes("m-loc") ||
      combined.includes("mloc") ||
      combined.includes("partition panel") ||
      combined.includes("interior partition") ||
      combined.includes("non load bearing") ||
      (combined.includes("load bearing") && combined.includes("panel"));
    if (isMloc) {
      const panelLF = lf > 0 ? lf : qty;
      if (panelLF > 0) {
        matched.push({
          label: "M-Loc Partition Panels",
          cat: "sheeting",
          method: "per_lf",
          qty,
          lf: panelLF,
          weight: wt,
          price: panelLF * (PR.mlocLF || 0),
          rateStr: `$${PR.mlocLF}/LF`,
          detail: `${panelLF.toFixed(0)} LF @ $${PR.mlocLF}/LF (26ga M-Loc)`,
        });
        continue;
      }
    }

    const isDeck =
      combined.includes("b-deck") ||
      combined.includes("b deck") ||
      combined.includes("n-deck") ||
      combined.includes("n deck") ||
      combined.includes("2.0cf") ||
      combined.includes("cf deck") ||
      combined.includes("cf-deck") ||
      combined.includes("composite deck") ||
      combined.includes("decking") ||
      combined.includes("metal deck panel") ||
      combined.includes("deck panel");
    if (isDeck) {
      let deckRate;
      let deckCostRate;
      let deckLabel;
      if (combined.includes("n-deck") || combined.includes("n deck")) {
        deckRate = PR.ndSell;
        deckCostRate = PR.ndCost;
        deckLabel = "N-Deck";
      } else if (
        combined.includes("2.0cf") ||
        combined.includes("cf") ||
        combined.includes("composite")
      ) {
        deckRate = PR.cfSell;
        deckCostRate = PR.cfCost;
        deckLabel = "2.0CF Composite Deck";
      } else if (combined.includes("b-deck") || combined.includes("b deck")) {
        deckRate = PR.bdSell;
        deckCostRate = PR.bdCost;
        deckLabel = "B-Deck";
      } else {
        deckRate = PR.cfSell;
        deckCostRate = PR.cfCost;
        deckLabel = "Metal Deck (CF rate — type unspecified)";
      }
      let deckSF = 0;
      if (cols.sq !== undefined) {
        const sq = parseFloat(String(row[cols.sq] || "").replace(/,/g, ""));
        if (!isNaN(sq) && sq > 0) deckSF = sq * 100;
      }
      if (!deckSF && cols.sqft !== undefined) {
        const sqv = parseFloat(String(row[cols.sqft] || "").replace(/,/g, ""));
        if (!isNaN(sqv) && sqv > 0) deckSF = sqv;
      }
      if (!deckSF && wt > 0) {
        const lbsSF =
          deckLabel === "N-Deck" ? 2.45 : deckLabel === "2.0CF Composite Deck" ? 2.5 : 1.95;
        deckSF = Math.round(wt / lbsSF);
      }
      if (deckSF > 0) {
        matched.push({
          label: `${deckLabel} (${deckSF.toLocaleString()} SF)`,
          cat: "sheeting",
          method: "per_sf_deck",
          qty,
          lf: 0,
          weight:
            wt ||
            Math.round(
              deckSF *
                (deckLabel === "N-Deck" ? 2.45 : deckLabel === "2.0CF Composite Deck" ? 2.5 : 1.95),
            ),
          price: deckSF * deckRate,
          rateStr: `$${deckRate}/SF`,
          detail: `${deckSF.toLocaleString()} SF · cost $${deckCostRate}/SF`,
        });
      }
    }
  }

  return matched;
};

module.exports = {
  applyBuiltInItemRules,
};
