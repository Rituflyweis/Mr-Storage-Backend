/** Pricing engine — port of SM-QuotingTool v6 priceJob() */

const resolvePembInstallSell = (install, PR) => {
  const key = String(install || "medium").toLowerCase();
  if (key === "easy") return PR.pes;
  if (key === "hard") return PR.phs;
  if (key === "tall" || key === "tall-hard") return PR.pts;
  return PR.pms;
};

const rowKey = (row) =>
  row._rowId ||
  `${String(row.label || "").replace(/[^a-zA-Z0-9]/g, "_")}_${Math.round(row.price || 0)}`;

const priceJob = (cats, options = {}) => {
  const {
    jobType = "PEMB",
    scope = "both",
    roof = "screw-down",
    install = "medium",
    sf = 0,
    blendPct = 50,
    PR,
    installCostPerSf,
    sellPerSf,
    matMuOverride = null,
    steelFinish = "red-iron",
    freightOverride = null,
    pembDrawings = 0,
    pembIncludeErection = false,
    deletedRowKeys = [],
  } = options;

  const isPEMB = jobType === "PEMB";
  const isSS = roof === "standing-seam";
  const isNoRoof = roof === "no-roof";
  const mu =
    matMuOverride != null && Number.isFinite(Number(matMuOverride))
      ? Number(matMuOverride)
      : isPEMB
        ? PR.pembMu
        : PR.storMu;

  const deleted = new Set(
    (Array.isArray(deletedRowKeys) ? deletedRowKeys : []).map(String),
  );
  const rowIdMap = {};
  const rows = [];
  let matCost = 0;
  let totWt = 0;

  const add = (cat, label, wt, rate, price, tag, notes = "", extra = {}) => {
    const rKey = `${String(label)}__${cat}`.replace(/[^a-zA-Z0-9_]/g, "_");
    rowIdMap[rKey] = rowIdMap[rKey] || 0;
    const _rowId = `${rKey}__${rowIdMap[rKey]++}`;
    rows.push({ cat, label, wt, rate, price, tag, notes, ...extra, _rowId });
    matCost += price;
    if (wt) totWt += wt;
  };

  if (cats.primary?.weight > 0) {
    const p = cats.primary.weight * PR.primary;
    add(
      "primary",
      "Rigid Frames & Endwalls",
      cats.primary.weight,
      `$${PR.primary}/lb`,
      p,
      "cat-primary",
    );
  }
  if (cats.hss?.weight > 0) {
    const p = cats.hss.weight * PR.hss;
    add("hss", "HSS Beams", cats.hss.weight, `$${PR.hss}/lb`, p, "cat-primary");
  }
  if (cats.secondary?.weight > 0) {
    const p = cats.secondary.weight * PR.secondary;
    add(
      "secondary",
      "Purlins, Girts & Eave Struts",
      cats.secondary.weight,
      `$${PR.secondary}/lb`,
      p,
      "cat-secondary",
    );
  }
  if (cats.opening?.weight > 0) {
    const p = cats.opening.weight * PR.opening;
    add(
      "opening",
      "Door Jambs & Headers",
      cats.opening.weight,
      `$${PR.opening}/lb`,
      p,
      "cat-opening",
    );
  }

  const shWt = cats.sheeting?.weight || 0;
  if (isNoRoof) {
    if (shWt > 0) {
      const wallWt = Math.round(shWt * 0.45);
      const wallPrice = wallWt * PR.sheet;
      add(
        "sheeting",
        "Wall Panels Only (no roof in scope)",
        wallWt,
        `$${PR.sheet}/lb`,
        wallPrice,
        "cat-sheeting",
        "Roof excluded from scope",
      );
    } else if (sf > 0) {
      const wallSF = sf * 0.8;
      const wallPrice = wallSF * PR.sheet;
      add(
        "sheeting",
        "Wall Panels Only (no roof in scope)",
        null,
        `$${PR.sheet}/SF`,
        wallPrice,
        "cat-sheeting",
        `~${Math.round(wallSF).toLocaleString()} SF est. walls only`,
      );
    }
  } else if (shWt > 0) {
    let shPrice;
    let shRate;
    if (isSS) {
      const roofWt = Math.round(shWt * 0.55);
      const wallWt = shWt - roofWt;
      shPrice = roofWt * PR.ss + wallWt * PR.sheet;
      shRate = `SS $${PR.ss}/lb + Wall $${PR.sheet}/lb`;
    } else {
      shPrice = shWt * PR.sheet;
      shRate = `$${PR.sheet}/lb`;
    }
    add("sheeting", "Roof & Wall Sheeting", shWt, shRate, shPrice, "cat-sheeting");
  } else if (sf > 0 && !shWt) {
    const estSF = sf * 1.8;
    const shPrice = isSS
      ? Math.round(estSF * 0.55) * PR.ss + (estSF - Math.round(estSF * 0.55)) * PR.sheet
      : estSF * PR.sheet;
    const shRate = isSS
      ? `SS $${PR.ss}+Wall $${PR.sheet}/SF`
      : `$${PR.sheet}/SF`;
    add(
      "sheeting",
      "Roof & Wall Sheeting",
      null,
      shRate,
      shPrice,
      "cat-sheeting",
      `~${Math.round(estSF).toLocaleString()} SF est.`,
    );
  }

  const addDeck = (key, label, sellRate, costRate) => {
    const deck = cats[key];
    if (!deck?.sqft || deck.sqft <= 0) return;
    const p = deck.sqft * sellRate;
    add(
      key,
      `${label} (${deck.sqft.toLocaleString()} SF)`,
      deck.weight,
      `$${sellRate}/SF`,
      p,
      "cat-sheeting",
      `Cost $${costRate}/SF · ${deck.sqft.toLocaleString()} SF`,
    );
  };
  addDeck("bdeck", "B-Deck", PR.bdSell, PR.bdCost);
  addDeck("ndeck", "N-Deck", PR.ndSell, PR.ndCost);
  addDeck("cfdeck", "2.0CF Composite Deck", PR.cfSell, PR.cfCost);

  if (cats.angle?.weight > 0) {
    const p = cats.angle.weight * PR.angle;
    add("angle", "Angles", cats.angle.weight, `$${PR.angle}/lb`, p, "cat-angle");
  }
  if (cats.plate?.weight > 0) {
    const p = cats.plate.weight * PR.plate;
    add(
      "plate",
      "Connection Plates & Clips",
      cats.plate.weight,
      `$${PR.plate}/lb`,
      p,
      "cat-angle",
    );
  }

  const trimP =
    cats.trim?.weight > 0
      ? Math.max(cats.trim.weight * (PR.trimLb || 2.8), sf * (PR.trimSf || 0.65))
      : sf * (PR.trimSf || 0.65);
  add("trim", "Trim", cats.trim?.weight || null, "bucket", trimP, "cat-trim");
  const miscP =
    cats.misc?.weight > 0
      ? Math.max(cats.misc.weight * (PR.miscLb || 3.5), sf * (PR.miscSf || 0.22))
      : sf * (PR.miscSf || 0.22);
  add("misc", "Cables, Bracing & Sealant", cats.misc?.weight || null, "bucket", miscP, "cat-misc");
  const accP =
    cats.accessories?.weight > 0
      ? Math.max(
          cats.accessories.weight * (PR.accessoriesLb || 1.5),
          sf * (PR.accessoriesSf || 1.0),
        )
      : sf * (PR.accessoriesSf || 1.0);
  add(
    "accessories",
    "Accessories",
    cats.accessories?.weight || null,
    "bucket",
    accP,
    "cat-misc",
  );

  const fastFromRows = (cats.customItems || [])
    .filter((ci) => ci.cat === "fasteners")
    .reduce((a, ci) => a + (ci.price || 0), 0);
  if (fastFromRows === 0) {
    const fastP = sf * (PR.fastenersSf || 0.48);
    add(
      "fasteners",
      "Fasteners (estimated)",
      null,
      `~$${PR.fastenersSf || 0.48}/SF estimate`,
      fastP,
      "cat-fastener",
      "No fastener rows in shipper — SF estimate used",
    );
  }

  if (cats.customItems?.length) {
    const tagMap = {
      primary: "cat-primary",
      secondary: "cat-secondary",
      sheeting: "cat-sheeting",
      trim: "cat-trim",
      misc: "cat-misc",
      accessories: "cat-misc",
      fasteners: "cat-fastener",
      angle: "cat-angle",
      plate: "cat-angle",
      opening: "cat-opening",
      hss: "cat-primary",
    };
    cats.customItems.forEach((ci) => {
      if (ci.isStructuralFinish && ci.weight) {
        const useGalv =
          steelFinish === "galvanized"
            ? true
            : steelFinish === "red-iron"
              ? false
              : ci.detectedGalv;
        const fRate = useGalv ? PR.galvSteel : PR.redIron;
        const fLabel = useGalv ? "Galvanized" : "Red Iron";
        ci.price = ci.weight * fRate;
        ci.rateStr = `$${Number(fRate).toFixed(3)}/lb (${fLabel})`;
        ci.label = `${String(ci.label || "")
          .replace(/ \((Red Iron|Galvanized)\)$/, "")
          .trim()} (${fLabel})`;
        ci.detail = `${ci.qty || ""} pcs · ${ci.weight.toFixed(0)} lbs · ${fLabel}`;
      }
      if (ci.price > 0) {
        const extra = ci.isStructuralFinish ? { isStructuralFinish: true } : {};
        add(
          ci.cat || "trim",
          ci.label || "Custom item",
          ci.weight || null,
          ci.rateStr || "custom",
          ci.price,
          tagMap[ci.cat || "trim"] || "cat-trim",
          ci.detail || "",
          extra,
        );
      }
    });
  }

  matCost = rows.reduce((a, r) => a + r.price, 0);
  const rowSubtotalBeforeBlend = matCost;

  const freightHasOverride =
    freightOverride !== null && freightOverride !== undefined && freightOverride !== "";
  const freight =
    isPEMB && freightHasOverride
      ? Number(freightOverride) || 0
      : totWt * PR.freight;
  const trucks = PR.truck > 0 ? Math.ceil(totWt / PR.truck) : 0;

  const blend = Math.min(1, Math.max(0, Number(blendPct) / 100));
  const quickenSavings = totWt * PR.delta;
  const blendedMatCost = matCost - quickenSavings * blend;
  const vendorBlendAdjustment = blendedMatCost - rowSubtotalBeforeBlend;
  const vendorBlendSavingsExact = rowSubtotalBeforeBlend - blendedMatCost;
  const blendedFreight = freight;
  const blendLabel =
    blend === 0
      ? "100% Central"
      : blend === 1
        ? "100% Quicken"
        : `${Math.round(blend * 100)}% Quicken blend`;

  let instCost = 0;
  let instSell = 0;
  const scopeKey = String(scope || "both").toLowerCase();
  const includeInstall =
    scopeKey === "install" ||
    scopeKey === "both" ||
    (isPEMB && pembIncludeErection);

  if (includeInstall) {
    if (isPEMB) {
      const sell = sellPerSf ?? resolvePembInstallSell(install, PR);
      const cost = installCostPerSf ?? sell * 0.65;
      instCost = sf * cost;
      instSell = sf * sell;
    } else {
      const sell = sellPerSf ?? PR.ses;
      const cost = installCostPerSf ?? sell * 0.68;
      instCost = sf * cost;
      instSell = sf * sell;
    }
  }

  const drawings = Number(pembDrawings) || 0;
  let matSell = (blendedMatCost + blendedFreight) * mu;
  let totCost;
  let totSell;

  if (scopeKey === "install") {
    totCost = instCost;
    totSell = instSell;
  } else if (scopeKey === "supply") {
    totCost = blendedMatCost + blendedFreight + drawings;
    totSell = matSell + drawings;
    if (isPEMB && pembIncludeErection) {
      totSell += instSell;
      totCost += instCost;
    }
  } else {
    totCost = blendedMatCost + blendedFreight + instCost + drawings;
    totSell = matSell + instSell + drawings;
  }

  let finalMatCost = blendedMatCost;
  if (deleted.size > 0) {
    const removedRows = rows.filter((r) => deleted.has(rowKey(r)));
    const removedSell = removedRows.reduce((s, r) => s + (r.price || 0), 0);
    const mu2 = mu || 1.25;
    const removedCost = removedRows.reduce(
      (s, r) => s + (r.price ? r.price / mu2 : 0),
      0,
    );
    const keptRows = rows.filter((r) => !deleted.has(rowKey(r)));
    rows.length = 0;
    rows.push(...keptRows);
    matSell = Math.max(0, matSell - removedSell);
    totSell = Math.max(0, totSell - removedSell);
    finalMatCost = Math.max(0, blendedMatCost - removedCost);
  }
  matCost = finalMatCost;

  const profit = totSell - totCost;
  const profPct = totSell > 0 ? ((profit / totSell) * 100).toFixed(1) : "0";
  const sfPrice = sf > 0 ? (totSell / sf).toFixed(2) : "0";
  const quicken = quickenSavings * mu;

  return {
    rows,
    matCost,
    rowSubtotalBeforeBlend,
    vendorBlendAdjustment,
    vendorBlendSavingsExact,
    totWt,
    freight: blendedFreight,
    trucks,
    instCost,
    instSell,
    totCost,
    matSell,
    totSell,
    profit,
    profPct,
    sfPrice,
    sf,
    quicken,
    jobType,
    scope,
    roof,
    install,
    isSS,
    blendPct: blend,
    blendLabel,
    vendorBlendSavings: Math.round(quickenSavings * blend),
    pembDrawings: drawings,
    steelFinish,
    matMuApplied: mu,
  };
};

const categoriesToWeightByCategory = (cats, PR) => {
  const map = [
    ["primary", "Rigid Frames & Endwalls", PR.primary],
    ["hss", "HSS Beams", PR.hss],
    ["secondary", "Purlins, Girts & Eave Struts", PR.secondary],
    ["opening", "Door Jambs & Headers", PR.opening],
    ["sheeting", "Roof & Wall Sheeting", PR.sheet],
    ["bdeck", "B-Deck", PR.bdSell],
    ["ndeck", "N-Deck", PR.ndSell],
    ["cfdeck", "2.0CF Composite Deck", PR.cfSell],
    ["angle", "Angles", PR.angle],
    ["plate", "Connection Plates & Clips", PR.plate],
    ["trim", "Trim", null],
    ["misc", "Cables, Bracing & Sealant", null],
    ["accessories", "Accessories", null],
    ["fasteners", "Fasteners", null],
  ];

  return map
    .filter(([key]) => {
      const v = cats[key];
      if (!v) return false;
      if (v.sqft > 0) return true;
      return (v.weight || 0) > 0;
    })
    .map(([key, label, rate]) => {
      const v = cats[key];
      if (v.sqft > 0) {
        return {
          category: label,
          weightLbs: Math.round((v.weight || 0) * 100) / 100,
          rate: rate || 0,
          price: Math.round(v.sqft * (rate || 0) * 100) / 100,
          notes: `${v.sqft.toLocaleString()} SF`,
        };
      }
      return {
        category: label,
        weightLbs: Math.round((v.weight || 0) * 100) / 100,
        rate: rate || 0,
        price: rate ? Math.round(v.weight * rate * 100) / 100 : 0,
        notes: "",
      };
    });
};

module.exports = {
  priceJob,
  categoriesToWeightByCategory,
  resolvePembInstallSell,
};
