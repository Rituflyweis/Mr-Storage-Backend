const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const resolveEstimateGrandTotal = (estimate = {}) => {
  if (estimate.storagePricingResult?.grandTotal != null) {
    return Math.round(toNumber(estimate.storagePricingResult.grandTotal));
  }
  if (estimate.fullQuoteResult?.grandTotal != null) {
    return Math.round(toNumber(estimate.fullQuoteResult.grandTotal));
  }
  if (estimate.totalSell != null) {
    return Math.round(toNumber(estimate.totalSell));
  }
  return Math.round(toNumber(estimate.pricingResult?.totSell));
};

const collectQuotationDraftNotes = (quotation = {}) => {
  const lines = [];
  const clientNotes = String(quotation.clientNotes || "").trim();
  const specialNote = String(quotation.specialNote || "").trim();
  if (clientNotes) lines.push(clientNotes);
  if (specialNote && specialNote !== clientNotes) lines.push(specialNote);

  const materials = (quotation.includedMaterials || [])
    .map((item) => [item?.name, item?.description].filter(Boolean).join(" — "))
    .filter(Boolean);
  if (materials.length) {
    lines.push(`Included materials:\n${materials.map((item) => `- ${item}`).join("\n")}`);
  }

  const components = (quotation.includedComponents || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (components.length) {
    lines.push(`Included components:\n${components.map((item) => `- ${item}`).join("\n")}`);
  }

  const exclusions = (quotation.exclusions || []).map((item) => String(item || "").trim()).filter(Boolean);
  if (exclusions.length) {
    lines.push(`Exclusions:\n${exclusions.map((item) => `- ${item}`).join("\n")}`);
  }

  const addOns = (quotation.optionalAddOns || [])
    .map((item) => {
      const label = String(item?.name || item?.description || "").trim();
      if (!label) return "";
      return item?.price != null && item.price !== "" ? `${label} (${item.price})` : label;
    })
    .filter(Boolean);
  if (addOns.length) {
    lines.push(`Optional add-ons:\n${addOns.map((item) => `- ${item}`).join("\n")}`);
  }

  return lines.join("\n\n");
};

const mergeDraftNotes = (...parts) =>
  parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");

const mapEstimateToDocumentPayload = (estimate = {}) => {
  const grandTotal = resolveEstimateGrandTotal(estimate);
  return {
    jobType: estimate.jobType,
    leadCompanyName: estimate.leadCompanyName,
    customerEmail: estimate.customerEmail,
    streetAddress: estimate.streetAddress,
    cityStateZip: estimate.cityStateZip,
    buildingSize: estimate.buildingSize,
    squareFootage: estimate.squareFootage,
    quoteDate: estimate.quoteDate,
    additionalInfo: estimate.additionalInfo,
    pricingResult: estimate.pricingResult,
    storageData: estimate.storageData,
    storagePricingResult: estimate.storagePricingResult,
    grandTotal,
    fullQuote: estimate.fullQuoteResult || {
      pricing: estimate.pricingResult,
      concrete: estimate.concreteAddon,
      insulation: estimate.insulationAddon,
      salesTax: estimate.salesTax,
      grandTotal,
      pricePerSf: estimate.pricePerSf,
    },
    concrete: estimate.concreteAddon,
    insulation: estimate.insulationAddon,
    salesTax: estimate.salesTax,
    contract: estimate.contractDetails,
    drawingAttachments: estimate.drawingAttachments,
    customer: {
      name: estimate.leadCompanyName,
      address: estimate.streetAddress,
      location: estimate.cityStateZip,
      email: estimate.customerEmail,
    },
  };
};

const mapQuotationToDocumentPayload = (quotation = {}, customer = {}, estimate = null) => {
  const draftNotes = collectQuotationDraftNotes(quotation);

  if (estimate) {
    const payload = mapEstimateToDocumentPayload(estimate);
    payload.additionalInfo = mergeDraftNotes(payload.additionalInfo, draftNotes);
    if (quotation.companyName) payload.leadCompanyName = quotation.companyName;
    if (quotation.location) payload.cityStateZip = quotation.location;
    if (quotation.proposalDate) payload.quoteDate = quotation.proposalDate;
    payload.customer = {
      ...(payload.customer || {}),
      name: quotation.companyName || payload.customer?.name || customer.firstName || "Customer",
      location: quotation.location || payload.customer?.location || "",
      email: customer.email || payload.customer?.email || "",
    };
    if (customer.email) payload.customerEmail = customer.email;
    return payload;
  }

  const sf = toNumber(quotation.totalArea || quotation.sqft, 0);
  const materialSell = toNumber(quotation.materialCost, 0) + toNumber(quotation.freightCost, 0);
  const finalPrice = toNumber(quotation.finalPrice || quotation.basePrice, 0);
  const installSell = Math.max(0, finalPrice - materialSell);

  return {
    jobType: quotation.buildingType || "PEMB",
    leadCompanyName: quotation.companyName || customer.firstName || "Customer",
    customerEmail: customer.email || "",
    cityStateZip: quotation.location || "",
    buildingSize: sf > 0 ? `${Number(sf).toLocaleString()} SF` : "",
    squareFootage: sf,
    quoteDate: quotation.proposalDate || quotation.createdAt || new Date(),
    additionalInfo: draftNotes,
    grandTotal: finalPrice,
    fullQuote: {
      pricing: {
        jobType: quotation.buildingType || "PEMB",
        sf,
        scope: "both",
        isSS: false,
        matSell: materialSell,
        instSell: installSell,
        totSell: finalPrice,
        totWt: 0,
        trucks: 0,
      },
      concrete: { include: false, appliedSell: 0 },
      insulation: { include: false, appliedSell: 0 },
      salesTax: { amount: 0, rate: 0 },
      grandTotal: finalPrice,
      pricePerSf: sf > 0 ? Number((finalPrice / sf).toFixed(2)) : 0,
    },
    customer: {
      name: quotation.companyName || customer.firstName || "Customer",
      location: quotation.location || "",
      email: customer.email || "",
    },
  };
};

module.exports = {
  toNumber,
  resolveEstimateGrandTotal,
  collectQuotationDraftNotes,
  mergeDraftNotes,
  mapEstimateToDocumentPayload,
  mapQuotationToDocumentPayload,
};
