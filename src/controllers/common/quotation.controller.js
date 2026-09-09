const Quotation = require("../../models/Quotation");
const EstimateQuote = require("../../models/EstimateQuote");
const QuoteSummary = require("../../models/QuoteSummary");
const Lead = require("../../models/Lead");
const Customer = require("../../models/Customer");
const mailer = require("../../services/email/mailer");
const quoteSummaryService = require("../../services/ai/quoteSummary.service");
const auditService = require("../../services/audit.service");
const generateQuoteNumber = require("../../utils/generateQuoteNumber");
const {
  generateAssembledHtml,
  generateQuotePdf: generateAssembledQuotePdf,
} = require("../../services/quoting/quoteDocumentGenerator");
const {
  success,
  created,
  notFound,
  badRequest,
  forbidden,
  error,
} = require("../../utils/apiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { buildDateFilter } = require("../../utils/dateRange");
const { AUDIT_ACTIONS, LIFECYCLE_STAGES } = require("../../config/constants");
const { resolveOutboundRecipients } = require("../../utils/outboundEmail");
const QUOTATION_APPROVAL_STATUSES = ["not_submitted", "pending_approval", "approved", "rejected"];
const QUOTATION_STATUS_FILTERS = ["draft", "pending", "pending_approval", "approved", "rejected", "sent", "accepted"];
const QUOTATION_SORT_VALUES = ["latest", "oldest"];
const QUOTATION_DOCUMENT_SECTIONS = ["quote", "sow", "contract", "drawings"];
const QUOTATION_USER_FIELDS = "name email role";
const QUOTATION_STATUS_LABELS = {
  draft: "Draft",
  sent: "Pending Approval",
  accepted: "Approved",
  rejected: "Rejected",
};

const QUOTATION_CUSTOMER_FIELDS = "firstName lastName email company phone";
const QUOTATION_LEAD_FIELDS = "jobId projectName buildingType customerId";

const populateQuotationUsers = (query) =>
  query
    .populate("createdBy", QUOTATION_USER_FIELDS)
    .populate("customerId", QUOTATION_CUSTOMER_FIELDS)
    .populate("leadId", QUOTATION_LEAD_FIELDS)
    .populate("approval.submittedBy", QUOTATION_USER_FIELDS)
    .populate("approval.reviewedBy", QUOTATION_USER_FIELDS)
    .populate("approval.history.by", QUOTATION_USER_FIELDS);

// Server-side auto-calculations per spec (admin_panel_sales_panel_v2.md lines 604-609).
// Never trust client values for these fields.
const computeQuotePricing = (src) => {
  const width = Number(src.width) || 0;
  const length = Number(src.length) || 0;
  const materialCost = Number(src.materialCost) || 0;
  const freightCost = Number(src.freightCost) || 0;
  const markupPercent = Number(src.markupPercent) || 0;

  const totalArea = width * length;
  const totalCOGS = materialCost + freightCost;
  const markupValue = (totalCOGS * markupPercent) / 100;
  const finalPrice = totalCOGS + markupValue;
  const psf = totalArea > 0 ? finalPrice / totalArea : null;

  return {
    totalArea: totalArea || null,
    totalCOGS,
    markupValue,
    finalPrice,
    psf,
  };
};

const extractRefId = (raw) => {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    if (raw._id) return String(raw._id);
    if (typeof raw.toHexString === "function") return raw.toHexString();
  }
  return String(raw);
};

// Sales can only act on their assigned leads
const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(extractRefId(leadId) || leadId);
  if (!lead) return { error: "Lead not found", code: 404 };
  if (
    user.role === "sales" &&
    String(lead.assignedSales) !== String(user._id)
  ) {
    return { error: "Access denied", code: 403 };
  }
  return { lead };
};

const ensureApprovalState = (quotation) => {
  if (!quotation.approval) quotation.approval = {};
  if (!quotation.approval.status) quotation.approval.status = "not_submitted";
  if (!Array.isArray(quotation.approval.history)) quotation.approval.history = [];
};

const pushApprovalHistory = (quotation, { status, note = "", by = null, at = new Date() }) => {
  ensureApprovalState(quotation);
  quotation.approval.history.push({ status, note, by, at });
};

const assertQuotationReadyToSend = (quotation) => {
  ensureApprovalState(quotation);
  if (quotation.approval.status !== "approved") {
    return "Quotation must be approved by admin before sending";
  }
  if (
    quotation.approval.approvedVersionNumber != null &&
    Number(quotation.approval.approvedVersionNumber) !== Number(quotation.versionNumber || 1)
  ) {
    return "Quotation was edited after approval. Please resubmit for admin approval.";
  }
  return null;
};

const applyQuotationSentFields = (quotation, {
  sendMethod,
  sentTo = "",
  sentCc = [],
  sentMessage = "",
  sentAt = new Date(),
} = {}) => {
  quotation.status = "sent";
  quotation.sentAt = sentAt;
  quotation.sendMethod = sendMethod;
  quotation.sentTo = sentTo || "";
  quotation.sentCc = Array.isArray(sentCc) ? sentCc : [];
  quotation.sentMessage = sentMessage || "";
};

const advanceLeadToProposalSent = async (leadId, userId) => {
  const leadForStage = await Lead.findById(leadId).lean();
  if (!leadForStage) return;
  const targetIdx = LIFECYCLE_STAGES.indexOf("proposal_sent");
  const currentIdx = LIFECYCLE_STAGES.indexOf(leadForStage.lifecycleStatus);
  if (targetIdx > currentIdx) {
    await Lead.findByIdAndUpdate(leadId, {
      lifecycleStatus: "proposal_sent",
      $push: {
        lifecycleHistory: {
          stage: "proposal_sent",
          changedAt: new Date(),
          changedBy: userId,
        },
      },
    });
  }
};

const getWorkflowStatus = (quotation) => {
  if (quotation.status === "sent") return "sent";
  const approvalStatus = quotation.approval?.status || "not_submitted";
  if (approvalStatus === "pending_approval") return "pending_approval";
  if (approvalStatus === "approved") return "approved";
  if (approvalStatus === "rejected") return "rejected";
  return "draft";
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
};

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

const mapEstimateSummary = (estimate) => {
  if (!estimate) return null;
  return {
    _id: estimate._id,
    leadId: estimate.leadId || null,
    status: estimate.status || "draft",
    jobType: estimate.jobType || "",
    squareFootage: toNumber(estimate.squareFootage, 0),
    grandTotal: resolveEstimateGrandTotal(estimate),
    updatedAt: estimate.updatedAt || estimate.createdAt || null,
  };
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

const buildQuotationDocumentMeta = (quotation = {}, estimate = null) => {
  const quotationId = quotation?._id || null;
  const estimateId = quotation.sourceEstimateId || estimate?._id || null;
  const previewEndpoint = quotationId
    ? `/api/quotations/${quotationId}/pdf?format=html`
    : null;
  const pdfEndpoint = quotationId ? `/api/quotations/${quotationId}/pdf` : null;
  const hasPricingData = Boolean(
    estimate?.pricingResult ||
      estimate?.fullQuoteResult?.pricing ||
      estimate?.storagePricingResult
  );
  return {
    source: estimateId ? "estimate" : "quotation",
    sourceEstimateId: estimateId || null,
    hasPricingData,
    previewEndpoint,
    pdfEndpoint,
    defaultSections: ["quote", "sow", "contract", "drawings"],
  };
};

const buildQuotationPdfLink = (quotation = {}, estimate = null) => {
  if (!quotation?._id) return null;
  return `/api/quotations/${quotation._id}/pdf`;
};

const buildQuotationHtmlPreviewLink = (quotation = {}) => {
  if (!quotation?._id) return null;
  return `/api/quotations/${quotation._id}/pdf?format=html`;
};

const parsePdfSections = (sectionsRaw) => {
  if (!sectionsRaw) return QUOTATION_DOCUMENT_SECTIONS;
  const values = String(sectionsRaw)
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(values)].filter((s) => QUOTATION_DOCUMENT_SECTIONS.includes(s));
  return unique.length ? unique : QUOTATION_DOCUMENT_SECTIONS;
};

const customerIdOf = (quotation = {}) => extractRefId(quotation.customerId);

const leadIdOf = (quotation = {}) => extractRefId(quotation.leadId);

const customerDisplayName = (customer = {}) =>
  [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim()
  || String(customer.company || "").trim();

const isPopulatedRef = (raw) =>
  Boolean(
    raw &&
      typeof raw === "object" &&
      typeof raw.toHexString !== "function" &&
      (raw._id || raw.firstName || raw.email || raw.jobId || raw.projectName)
  );

const attachCustomerEmails = async (quotations) => {
  const rows = Array.isArray(quotations) ? quotations : [quotations];
  const customerIds = [
    ...new Set(rows.map(customerIdOf).filter(Boolean)),
  ];
  const leadIds = [
    ...new Set(rows.map(leadIdOf).filter(Boolean)),
  ];

  const needsCustomerLookup = rows.some((row) => row && customerIdOf(row) && !isPopulatedRef(row.customerId));
  const needsLeadLookup = rows.some((row) => row && leadIdOf(row) && !isPopulatedRef(row.leadId));

  const [customers, leads] = await Promise.all([
    needsCustomerLookup && customerIds.length
      ? Customer.find({ _id: { $in: customerIds } }).select(QUOTATION_CUSTOMER_FIELDS).lean()
      : Promise.resolve([]),
    needsLeadLookup && leadIds.length
      ? Lead.find({ _id: { $in: leadIds } }).select(QUOTATION_LEAD_FIELDS).lean()
      : Promise.resolve([]),
  ]);
  const customerById = new Map(customers.map((customer) => [String(customer._id), customer]));
  const leadById = new Map(leads.map((lead) => [String(lead._id), lead]));

  rows.forEach((row) => {
    if (!row) return;
    const populatedCustomer = isPopulatedRef(row.customerId) ? row.customerId : null;
    const populatedLead = isPopulatedRef(row.leadId) ? row.leadId : null;
    const customer = populatedCustomer || customerById.get(customerIdOf(row)) || {};
    const lead = populatedLead || leadById.get(leadIdOf(row)) || {};
    const customerEmail = String(customer.email || row.customerEmail || "").trim();
    const customerName = customerDisplayName(customer) || String(row.companyName || "").trim();
    const projectName = String(lead.projectName || row.companyName || "").trim();
    const jobId = String(lead.jobId || "").trim();

    row.customerName = customerName;
    row.customerEmail = customerEmail;
    row.defaultToEmail = customerEmail;
    row.projectName = projectName;
    row.jobId = jobId;
    row.projectId = jobId;
    if (!row.buildingType && lead.buildingType) row.buildingType = lead.buildingType;
    if (customer._id) {
      row.customer = {
        _id: customer._id,
        firstName: customer.firstName || "",
        lastName: customer.lastName || "",
        email: customerEmail,
        company: customer.company || "",
        phone: customer.phone || null,
      };
    }
  });
  return quotations;
};

const decorateQuotationResponse = async (
  quotationLike,
  { includeEstimate = false, includeDocuments = false } = {}
) => {
  if (!quotationLike) return null;
  const quotation =
    typeof quotationLike.toObject === "function"
      ? quotationLike.toObject()
      : { ...quotationLike };

  quotation.approvalStatus = quotation.approval?.status || "not_submitted";
  quotation.workflowStatus = getWorkflowStatus(quotation);

  let estimate = null;
  if (includeEstimate && quotation.sourceEstimateId) {
    estimate = await EstimateQuote.findById(quotation.sourceEstimateId)
      .select(
        "_id leadId status jobType squareFootage totalSell pricingResult fullQuoteResult storagePricingResult updatedAt createdAt"
      )
      .lean();
  }

  if (includeEstimate) {
    quotation.sourceEstimate = mapEstimateSummary(estimate);
  }

  if (includeDocuments) {
    quotation.documentMeta = buildQuotationDocumentMeta(quotation, estimate);
  }
  quotation.pdfLink = buildQuotationPdfLink(quotation, estimate);
  quotation.htmlPreviewLink = buildQuotationHtmlPreviewLink(quotation);
  await attachCustomerEmails(quotation);

  return quotation;
};

const mapEstimateToQuotationPayload = (estimate = {}, lead, reqUser) => {
  const sqft = toNumber(estimate.squareFootage, 0);
  const materialCost = toNumber(estimate.materialCost, 0);
  const freightCost = toNumber(estimate.freightCost, 0);
  const totalCOGS = toNumber(estimate.totalCOGS, materialCost + freightCost);
  const finalPrice = resolveEstimateGrandTotal(estimate);
  const markupValue = Math.max(0, finalPrice - totalCOGS);
  const markupPercent = totalCOGS > 0 ? Number(((markupValue / totalCOGS) * 100).toFixed(2)) : 0;

  const includedMaterials = Array.isArray(estimate.weightByCategory)
    ? estimate.weightByCategory.map((row = {}) => ({
        name: row.category || "",
        description: row.notes || "",
        quantity: toNumber(row.weightLbs, 0),
      }))
    : [];

  const optionalAddOns = [];
  const concreteSell = toNumber(estimate.concreteAddon?.totSell, 0);
  if (concreteSell > 0) {
    optionalAddOns.push({
      name: "Concrete Add-on",
      description: "Imported from estimate concrete add-on",
      price: concreteSell,
    });
  }
  const insulationSell = toNumber(estimate.insulationAddon?.totSell, 0);
  if (insulationSell > 0) {
    optionalAddOns.push({
      name: "Insulation Add-on",
      description: "Imported from estimate insulation add-on",
      price: insulationSell,
    });
  }

  return {
    sourceEstimateId: estimate._id,
    leadId: lead._id,
    customerId: lead.customerId,
    createdBy: reqUser._id,
    proposalDate: estimate.quoteDate || new Date(),
    preparedBy: reqUser.name || "",
    companyName: estimate.leadCompanyName || "",
    location: estimate.cityStateZip || "",
    buildingType: estimate.jobType || "",
    sqft: sqft > 0 ? String(sqft) : "",
    totalArea: sqft > 0 ? sqft : null,
    specialNote: estimate.additionalInfo || "",
    clientNotes: estimate.additionalInfo || "",
    exclusions: Array.isArray(estimate.exclusions) ? estimate.exclusions : [],
    includedMaterials,
    optionalAddOns,
    materialCost,
    freightCost,
    totalCOGS,
    markupPercent,
    markupValue,
    basePrice: finalPrice,
    maxPrice: finalPrice,
    finalPrice,
    psf: sqft > 0 ? Number((finalPrice / sqft).toFixed(2)) : null,
    approval:
      reqUser.role === "sales"
        ? {
            status: "pending_approval",
            submittedBy: reqUser._id,
            submittedAt: new Date(),
            history: [
              {
                status: "pending_approval",
                note: "Quotation submitted for admin approval on create from estimate",
                by: reqUser._id,
                at: new Date(),
              },
            ],
          }
        : {
            status: "approved",
            reviewedBy: reqUser._id,
            reviewedAt: new Date(),
            approvedVersionNumber: 1,
            history: [
              {
                status: "approved",
                note: "Admin-created quotation auto-approved from estimate",
                by: reqUser._id,
                at: new Date(),
              },
            ],
          },
  };
};

const resolveLeadForEstimateConversion = async ({
  estimate,
  reqUser,
  explicitLeadId = null,
}) => {
  if (explicitLeadId) {
    const explicitAccess = await checkLeadAccess(explicitLeadId, reqUser);
    if (explicitAccess.error) {
      return { error: explicitAccess.error, code: explicitAccess.code || 400 };
    }
    return {
      lead: explicitAccess.lead,
      resolvedLeadId: explicitAccess.lead?._id || explicitLeadId,
      resolutionSource: "request_body_leadId",
    };
  }

  if (estimate.leadId) {
    const direct = await checkLeadAccess(estimate.leadId, reqUser);
    if (direct.error) return { error: direct.error, code: direct.code || 400 };
    return {
      lead: direct.lead,
      resolvedLeadId: direct.lead?._id || estimate.leadId,
      resolutionSource: "estimate_leadId",
    };
  }

  const jobNumber = String(estimate.jobNumber || "").trim();
  if (jobNumber) {
    const leadByJobNumber = await Lead.findOne({ jobId: jobNumber })
      .select("_id")
      .lean();
    if (leadByJobNumber?._id) {
      const byJob = await checkLeadAccess(leadByJobNumber._id, reqUser);
      if (byJob.error) return { error: byJob.error, code: byJob.code || 400 };
      return {
        lead: byJob.lead,
        resolvedLeadId: byJob.lead?._id || leadByJobNumber._id,
        resolutionSource: "estimate_jobNumber",
      };
    }
  }

  return {
    error:
      "Estimate is not linked to a lead. Provide body.leadId, or ensure estimate.jobNumber matches Lead.jobId.",
    code: 400,
  };
};

const findOrCreateQuotationFromEstimate = async ({
  estimateId,
  reqUser,
  forceNotSubmitted = false,
  explicitLeadId = null,
}) => {
  const estimate = await EstimateQuote.findById(estimateId);
  if (!estimate) return { error: "Estimate not found", code: 404 };
  const resolvedLead = await resolveLeadForEstimateConversion({
    estimate,
    reqUser,
    explicitLeadId,
  });
  if (resolvedLead.error) return { error: resolvedLead.error, code: resolvedLead.code };
  const lead = resolvedLead.lead;

  if (lead && String(estimate.leadId || "") !== String(lead._id || "")) {
    estimate.leadId = lead._id;
    await estimate.save();
  }

  const existing = await Quotation.findOne({ sourceEstimateId: estimate._id })
    .sort({ createdAt: -1 })
    .lean();
  if (existing) return { quotation: await Quotation.findById(existing._id), estimate, lead, created: false };

  const quoteNumber = await generateQuoteNumber();
  const quotationPayload = mapEstimateToQuotationPayload(
    estimate.toObject(),
    lead,
    reqUser
  );

  if (forceNotSubmitted) {
    quotationPayload.approval = {
      status: "not_submitted",
      submittedBy: null,
      submittedAt: null,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: "",
      approvedVersionNumber: null,
      history: [],
    };
  }

  const quotation = await Quotation.create({
    ...quotationPayload,
    quoteNumber,
  });

  await Lead.findByIdAndUpdate(lead._id, {
    isQuoteReady: true,
    quoteValue: quotation.basePrice || 0,
  });

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_CREATED,
    leadId: lead._id,
    customerId: lead.customerId,
    performedBy: reqUser._id,
    metadata: {
      quotationId: quotation._id,
      quoteNumber: quotation.quoteNumber,
      source: "estimate_conversion",
      sourceEstimateId: estimate._id,
      approvalStatus: quotation.approval?.status || "not_submitted",
    },
  });

  if (!forceNotSubmitted) {
    if (reqUser.role === "sales") {
      await auditService.log({
        type: "quotation",
        action: AUDIT_ACTIONS.QUOTATION_SUBMITTED_FOR_APPROVAL,
        leadId: lead._id,
        customerId: lead.customerId,
        performedBy: reqUser._id,
        metadata: {
          quotationId: quotation._id,
          quoteNumber: quotation.quoteNumber,
          source: "estimate_conversion",
        },
      });
    } else {
      await auditService.log({
        type: "quotation",
        action: AUDIT_ACTIONS.QUOTATION_APPROVED,
        leadId: lead._id,
        customerId: lead.customerId,
        performedBy: reqUser._id,
        metadata: {
          quotationId: quotation._id,
          quoteNumber: quotation.quoteNumber,
          source: "estimate_conversion_admin",
        },
      });
    }
  }

  return { quotation, estimate, lead, created: true };
};

exports.createQuotation = asyncHandler(async (req, res) => {
  const { leadId } = req.body;
  const { lead, error, code } = await checkLeadAccess(leadId, req.user);
  if (error) return code === 404 ? notFound(res, error) : forbidden(res, error);

  const { quoteNumber: _ignoredClientQuoteNumber, ...payload } = req.body;
  delete payload.customerId;
  payload.customerId = lead.customerId;
  const quoteNumber = await generateQuoteNumber();
  const pricing = computeQuotePricing(payload);

  const quotation = await Quotation.create({
    ...payload,
    ...pricing,
    quoteNumber,
    createdBy: req.user._id,
    approval:
      req.user.role === "sales"
        ? {
            status: "pending_approval",
            submittedBy: req.user._id,
            submittedAt: new Date(),
            history: [
              {
                status: "pending_approval",
                note: "Quotation submitted for admin approval on create",
                by: req.user._id,
                at: new Date(),
              },
            ],
          }
        : {
            status: "approved",
            reviewedBy: req.user._id,
            reviewedAt: new Date(),
            approvedVersionNumber: 1,
            history: [
              {
                status: "approved",
                note: "Admin-created quotation auto-approved",
                by: req.user._id,
                at: new Date(),
              },
            ],
          },
  });

  // Sync lead — mark quote ready and update quoteValue
  const leadUpdate = { isQuoteReady: true };
  if (quotation.basePrice) leadUpdate.quoteValue = quotation.basePrice;
  await Lead.findByIdAndUpdate(leadId, leadUpdate);

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_CREATED,
    leadId,
    customerId: lead.customerId,
    performedBy: req.user._id,
    metadata: {
      quotationId: quotation._id,
      basePrice: quotation.basePrice,
      approvalStatus: quotation.approval?.status || "not_submitted",
    },
  });
  if (req.user.role === "sales") {
    await auditService.log({
      type: "quotation",
      action: AUDIT_ACTIONS.QUOTATION_SUBMITTED_FOR_APPROVAL,
      leadId,
      customerId: lead.customerId,
      performedBy: req.user._id,
      metadata: { quotationId: quotation._id, quoteNumber: quotation.quoteNumber, source: "create_quotation" },
    });
  } else {
    await auditService.log({
      type: "quotation",
      action: AUDIT_ACTIONS.QUOTATION_APPROVED,
      leadId,
      customerId: lead.customerId,
      performedBy: req.user._id,
      metadata: { quotationId: quotation._id, quoteNumber: quotation.quoteNumber, source: "create_quotation_admin" },
    });
  }

  const quotationObj = quotation.toObject();
  return created(res, {
    quotation: await decorateQuotationResponse(quotationObj, {
      includeEstimate: true,
      includeDocuments: true,
    }),
  });
});

exports.createQuotationFromEstimate = asyncHandler(async (req, res) => {
  const { estimateId } = req.params;
  const explicitLeadId = req.body?.leadId || null;
  const resolved = await findOrCreateQuotationFromEstimate({
    estimateId,
    reqUser: req.user,
    explicitLeadId,
  });
  if (resolved.error) {
    if (resolved.code === 404) return notFound(res, resolved.error);
    if (resolved.code === 403) return forbidden(res, resolved.error);
    return badRequest(res, resolved.error);
  }
  const { quotation, estimate } = resolved;

  const quotationObj = await decorateQuotationResponse(quotation.toObject(), {
    includeEstimate: true,
    includeDocuments: true,
  });
  return created(
    res,
    {
      quotation: quotationObj,
      sourceEstimate: {
        _id: estimate._id,
        status: estimate.status,
        leadId: estimate.leadId,
      },
    },
    "Quotation created from estimate"
  );
});

exports.getQuotation = asyncHandler(async (req, res) => {
  const quotation = await populateQuotationUsers(Quotation.findById(req.params.quotationId)).lean();
  if (!quotation) return notFound(res, "Quotation not found");
  const { error: accessError, code } = await checkLeadAccess(quotation.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);

  const includeEstimate = toBoolean(req.query.includeEstimate, true);
  const includeDocuments = toBoolean(req.query.includeDocuments, true);
  return success(res, {
    quotation: await decorateQuotationResponse(quotation, {
      includeEstimate,
      includeDocuments,
    }),
  });
});

exports.downloadQuotationPdf = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId);
  if (!quotation) return notFound(res, "Quotation not found");

  const { error: accessError, code } = await checkLeadAccess(quotation.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);

  const customer = await Customer.findById(quotation.customerId).lean();
  const sourceEstimate = quotation.sourceEstimateId
    ? await EstimateQuote.findById(quotation.sourceEstimateId).lean()
    : null;
  const sections = parsePdfSections(req.query.sections);
  const format = String(req.query.format || "pdf").trim().toLowerCase();

  try {
    const pdfPayload = mapQuotationToDocumentPayload(quotation.toObject(), customer || {}, sourceEstimate);
    if (format === "html") {
      const assembledHtml = generateAssembledHtml({
        ...pdfPayload,
        sections,
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(assembledHtml);
    }

    const pdfBuffer = await generateAssembledQuotePdf({ ...pdfPayload, sections });
    const fileName = `Quotation-${quotation.quoteNumber || quotation._id}.pdf`.replace(/[^\w.-]+/g, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    return badRequest(res, `PDF generation failed: ${err.message}`);
  }
});

exports.updateQuotation = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId);
  if (!quotation) return notFound(res, "Quotation not found");
  if (quotation.status !== "draft")
    return badRequest(res, "Only draft quotations can be edited");
  const { error: accessError, code } = await checkLeadAccess(quotation.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);

  // Per spec line 614: same fields as POST except quoteNumber (never editable)
  const ALLOWED = [
    "buildingType",
    "basePrice",
    "maxPrice",
    "sqft",
    "width",
    "length",
    "height",
    "currency",
    "roofStyle",
    "validTill",
    "location",
    "windLoad",
    "snowLoad",
    "paymentTerms",
    "companyName",
    "estimatedDelivery",
    "includedMaterials",
    "optionalAddOns",
    "specialNote",
    "internalNotes",
    "priorityLevel",
    "proposalDate",
    "validity",
    "preparedBy",
    "assignedSalesperson",
    "margin",
    "leftEaveHeight",
    "rightEaveHeight",
    "roofSlope",
    "frameType",
    "endwallType",
    "girtType",
    "purlinType",
    "bracingType",
    "roofPanel",
    "wallPanelType",
    "roofColor",
    "wallColor",
    "trimColor",
    "baseAngle",
    "insulation",
    "shippingCost",
    "deliveryType",
    "shippingIncluded",
    "materialCost",
    "freightCost",
    "markupPercent",
    "doors",
    "includedComponents",
    "exclusions",
    "clientNotes",
    "changeNote",
  ];
  const prevBasePrice = quotation.basePrice;
  ALLOWED.forEach((k) => {
    if (req.body[k] !== undefined) quotation[k] = req.body[k];
  });

  // Per spec line 616: re-run auto-calculations if any pricing input changed
  const RECALC_KEYS = [
    "width",
    "length",
    "materialCost",
    "freightCost",
    "markupPercent",
  ];
  if (RECALC_KEYS.some((k) => req.body[k] !== undefined)) {
    const pricing = computeQuotePricing(quotation);
    Object.assign(quotation, pricing);
  }

  // Per spec line 615: auto-increment versionNumber on every save
  quotation.versionNumber = (quotation.versionNumber || 1) + 1;
  ensureApprovalState(quotation);
  if (
    ["pending_approval", "approved", "rejected"].includes(quotation.approval.status)
  ) {
    const prevApproval = quotation.approval.status;
    quotation.approval.status = "not_submitted";
    quotation.approval.reviewedBy = null;
    quotation.approval.reviewedAt = null;
    quotation.approval.rejectionReason = "";
    quotation.approval.approvedVersionNumber = null;
    pushApprovalHistory(quotation, {
      status: "not_submitted",
      note: `Approval reset after quotation edit (from ${prevApproval})`,
      by: req.user._id,
    });
  }

  await quotation.save();

  // Keep lead.quoteValue in sync when basePrice changes
  if (
    req.body.basePrice !== undefined &&
    req.body.basePrice !== prevBasePrice
  ) {
    await Lead.findByIdAndUpdate(quotation.leadId, {
      quoteValue: req.body.basePrice,
    });
  }

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_EDITED,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: {
      quotationId: quotation._id,
      versionNumber: quotation.versionNumber,
      approvalStatus: quotation.approval?.status || "not_submitted",
    },
  });

  return success(res, {
    quotation: await decorateQuotationResponse(quotation.toObject(), {
      includeEstimate: true,
      includeDocuments: true,
    }),
  });
});

exports.sendQuotation = asyncHandler(async (req, res) => {
  if (!mailer.isEmailConfigured()) {
    return badRequest(res, "Email service is not configured. Set SENDGRID or SMTP credentials.");
  }
  const quotation = await Quotation.findById(req.params.quotationId);
  if (!quotation) return notFound(res, "Quotation not found");
  const { error: accessError, code } = await checkLeadAccess(quotation.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);
  const readyError = assertQuotationReadyToSend(quotation);
  if (readyError) return badRequest(res, readyError);

  const customer = await Customer.findById(quotation.customerId);
  if (!customer) return notFound(res, "Customer not found");
  const recipients = resolveOutboundRecipients({
    body: req.body,
    fallbackToEmail: customer.email,
  });
  if (recipients.error) return badRequest(res, recipients.error);
  const customMessage = recipients.customMessage;
  const messageSourceKey = recipients.messageSourceKey;
  const requestedSections =
    Array.isArray(req.body?.sections) && req.body.sections.length
      ? req.body.sections
      : ["quote", "sow", "contract", "drawings"];

  let pdfAttachment = null;
  let pdfWarning = null;
  let draftHtml = "";
  let draftHtmlIncluded = false;
  let sourceEstimate = null;
  if (quotation.sourceEstimateId) {
    sourceEstimate = await EstimateQuote.findById(quotation.sourceEstimateId).lean();
  }
  const pdfPayload = mapQuotationToDocumentPayload(quotation.toObject(), customer.toObject(), sourceEstimate);
  const emailSections = requestedSections.filter((section) => section !== "drawings");
  try {
    draftHtml = generateAssembledHtml({
      ...pdfPayload,
      sections: emailSections.length ? emailSections : ["quote"],
    });
    draftHtmlIncluded = Boolean(String(draftHtml || "").trim());
  } catch (err) {
    console.warn("[sendQuotation] Assembled quotation draft HTML skipped:", err.message);
  }
  try {
    const pdfBuffer = await generateAssembledQuotePdf({
      ...pdfPayload,
      sections: requestedSections,
    });
    pdfAttachment = {
      filename: `Quotation-${quotation.quoteNumber || quotation._id}.pdf`,
      content: pdfBuffer,
      contentType: "application/pdf",
    };
  } catch (err) {
    pdfWarning = err.message || "Quotation PDF generation failed";
    console.warn("[sendQuotation] PDF attachment skipped, sending quotation draft HTML email only:", pdfWarning);
  }

  let emailResult = { provider: "unknown" };
  try {
    emailResult = await mailer.sendQuotation({
      toEmail: recipients.toEmail,
      cc: recipients.cc,
      customerName: customer.firstName,
      quotation,
      message: customMessage,
      draftHtml,
      pdfAttachment,
    });
  } catch (err) {
    console.error("[sendQuotation] Email failed for quotation", quotation.quoteNumber, err.message);
    return error(res, `Failed to send quotation email: ${err.message}`, 502);
  }

  applyQuotationSentFields(quotation, {
    sendMethod: "platform",
    sentTo: recipients.toEmail,
    sentCc: recipients.cc,
    sentMessage: customMessage,
  });
  pushApprovalHistory(quotation, {
    status: "sent",
    note: `Quotation sent to ${recipients.toEmail}${recipients.cc.length ? ` (cc: ${recipients.cc.join(", ")})` : ""}`,
    by: req.user._id,
  });
  await quotation.save();
  await advanceLeadToProposalSent(quotation.leadId, req.user._id);

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_SENT,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: {
      quotationId: quotation._id,
      sendMethod: "platform",
      sentTo: recipients.toEmail,
      sentCc: recipients.cc,
      provider: emailResult?.provider || "unknown",
      customMessageIncluded: Boolean(customMessage),
      customMessageSourceKey: messageSourceKey,
      draftHtmlIncluded,
      pdfAttached: Boolean(pdfAttachment),
      pdfWarning: pdfWarning || null,
    },
  });

  // Fire-and-forget: generate AI summary
  quoteSummaryService
    .generateAndSave(quotation, quotation.leadId, quotation.customerId)
    .catch((err) => console.error("[QuoteSummary]", err.message));

  return success(
    res,
    {
      quotation: await decorateQuotationResponse(quotation.toObject(), {
        includeEstimate: true,
        includeDocuments: true,
      }),
      emailProvider: emailResult?.provider || "unknown",
      sendMethod: "platform",
      sentTo: recipients.toEmail,
      sentCc: recipients.cc,
      messageIncluded: Boolean(customMessage),
      messageSourceKey,
      draftHtmlIncluded,
      pdfAttached: Boolean(pdfAttachment),
      pdfWarning: pdfWarning || null,
    },
    "Quotation sent successfully",
  );
});

exports.markQuotationSent = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId);
  if (!quotation) return notFound(res, "Quotation not found");
  const { error: accessError, code } = await checkLeadAccess(quotation.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);
  if (quotation.status === "sent") {
    return badRequest(res, "Quotation is already marked as sent");
  }
  const readyError = assertQuotationReadyToSend(quotation);
  if (readyError) return badRequest(res, readyError);

  const sentAt = req.body?.sentAt ? new Date(req.body.sentAt) : new Date();
  if (Number.isNaN(sentAt.getTime())) return badRequest(res, "Invalid sentAt");
  const note = String(req.body?.note || req.body?.message || "").trim();

  applyQuotationSentFields(quotation, {
    sendMethod: "manual",
    sentTo: "",
    sentCc: [],
    sentMessage: note,
    sentAt,
  });
  pushApprovalHistory(quotation, {
    status: "sent",
    note: note || "Marked as sent (sent outside the platform)",
    by: req.user._id,
    at: sentAt,
  });
  await quotation.save();
  await advanceLeadToProposalSent(quotation.leadId, req.user._id);

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_SENT,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: {
      quotationId: quotation._id,
      sendMethod: "manual",
      sentAt,
      note: note || null,
    },
  });

  quoteSummaryService
    .generateAndSave(quotation, quotation.leadId, quotation.customerId)
    .catch((err) => console.error("[QuoteSummary]", err.message));

  return success(
    res,
    {
      quotation: await decorateQuotationResponse(quotation.toObject(), {
        includeEstimate: true,
        includeDocuments: true,
      }),
      sendMethod: "manual",
    },
    "Quotation marked as sent",
  );
});

exports.submitQuotationForApproval = asyncHandler(async (req, res) => {
  const routeId = req.params.quotationId;
  const bodyEstimateId = req.body?.estimateId;
  const explicitLeadId = req.body?.leadId || null;
  let quotation = await Quotation.findById(routeId);

  if (!quotation && bodyEstimateId) {
    const resolved = await findOrCreateQuotationFromEstimate({
      estimateId: bodyEstimateId,
      reqUser: req.user,
      forceNotSubmitted: true,
      explicitLeadId,
    });
    if (resolved.error) {
      if (resolved.code === 404) return notFound(res, resolved.error);
      if (resolved.code === 403) return forbidden(res, resolved.error);
      return badRequest(res, resolved.error);
    }
    quotation = resolved.quotation;
  }

  if (!quotation) {
    const resolved = await findOrCreateQuotationFromEstimate({
      estimateId: routeId,
      reqUser: req.user,
      forceNotSubmitted: true,
      explicitLeadId,
    });
    if (!resolved.error) {
      quotation = resolved.quotation;
    }
  }

  if (!quotation) return notFound(res, "Quotation not found");
  if (quotation.status === "sent") return badRequest(res, "Sent quotation cannot be submitted for approval");
  const { error: accessError, code } = await checkLeadAccess(quotation.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);

  ensureApprovalState(quotation);
  if (quotation.approval.status === "pending_approval") {
    return success(
      res,
      {
        quotation: await decorateQuotationResponse(quotation.toObject(), {
          includeEstimate: true,
          includeDocuments: true,
        }),
      },
      "Quotation already pending approval"
    );
  }
  quotation.approval.status = "pending_approval";
  quotation.approval.submittedBy = req.user._id;
  quotation.approval.submittedAt = new Date();
  quotation.approval.reviewedBy = null;
  quotation.approval.reviewedAt = null;
  quotation.approval.rejectionReason = "";
  quotation.approval.approvedVersionNumber = null;
  pushApprovalHistory(quotation, {
    status: "pending_approval",
    note: req.body?.note || "Submitted for admin approval",
    by: req.user._id,
  });
  await quotation.save();

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_SUBMITTED_FOR_APPROVAL,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: { quotationId: quotation._id, quoteNumber: quotation.quoteNumber, versionNumber: quotation.versionNumber },
  });

  return success(
    res,
    {
      quotation: await decorateQuotationResponse(quotation.toObject(), {
        includeEstimate: true,
        includeDocuments: true,
      }),
    },
    "Quotation submitted for approval"
  );
});

exports.approveQuotation = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return forbidden(res, "Only admin can approve quotations");
  const quotation = await Quotation.findById(req.params.quotationId);
  if (!quotation) return notFound(res, "Quotation not found");
  if (quotation.status === "sent") return badRequest(res, "Sent quotation cannot be approved");

  ensureApprovalState(quotation);
  if (quotation.approval.status !== "pending_approval") {
    return badRequest(res, "Only pending approval quotations can be approved");
  }
  quotation.approval.status = "approved";
  quotation.approval.reviewedBy = req.user._id;
  quotation.approval.reviewedAt = new Date();
  quotation.approval.rejectionReason = "";
  quotation.approval.approvedVersionNumber = Number(quotation.versionNumber || 1);
  pushApprovalHistory(quotation, {
    status: "approved",
    note: req.body?.note || "Approved by admin",
    by: req.user._id,
  });
  await quotation.save();

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_APPROVED,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: { quotationId: quotation._id, quoteNumber: quotation.quoteNumber, approvedVersionNumber: quotation.approval.approvedVersionNumber },
  });

  return success(
    res,
    {
      quotation: await decorateQuotationResponse(quotation.toObject(), {
        includeEstimate: true,
        includeDocuments: true,
      }),
    },
    "Quotation approved"
  );
});

exports.rejectQuotationApproval = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return forbidden(res, "Only admin can reject quotations");
  const quotation = await Quotation.findById(req.params.quotationId);
  if (!quotation) return notFound(res, "Quotation not found");
  if (quotation.status === "sent") return badRequest(res, "Sent quotation cannot be rejected");

  ensureApprovalState(quotation);
  if (quotation.approval.status !== "pending_approval") {
    return badRequest(res, "Only pending approval quotations can be rejected");
  }
  const reason = String(req.body?.reason || req.body?.note || "").trim();
  if (!reason) return badRequest(res, "Rejection reason is required");

  quotation.approval.status = "rejected";
  quotation.approval.reviewedBy = req.user._id;
  quotation.approval.reviewedAt = new Date();
  quotation.approval.rejectionReason = reason;
  quotation.approval.approvedVersionNumber = null;
  pushApprovalHistory(quotation, {
    status: "rejected",
    note: reason,
    by: req.user._id,
  });
  await quotation.save();

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_APPROVAL_REJECTED,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: { quotationId: quotation._id, quoteNumber: quotation.quoteNumber, reason },
  });

  return success(
    res,
    {
      quotation: await decorateQuotationResponse(quotation.toObject(), {
        includeEstimate: true,
        includeDocuments: true,
      }),
    },
    "Quotation rejected"
  );
});

exports.getQuotationStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query);
  const filter = { ...dateFilter };
  if (req.user.role === "sales") filter.createdBy = req.user._id;

  const quotations = await Quotation.find(filter).select("status approval").lean();
  const stats = {
    total: quotations.length,
    approved: 0,
    pendingApproval: 0,
    rejected: 0,
    sent: 0,
    draft: 0,
  };

  for (const quotation of quotations) {
    const workflowStatus = getWorkflowStatus(quotation);
    if (workflowStatus === "approved") stats.approved += 1;
    else if (workflowStatus === "pending_approval") stats.pendingApproval += 1;
    else if (workflowStatus === "rejected") stats.rejected += 1;
    else if (workflowStatus === "sent") stats.sent += 1;
    else stats.draft += 1;
  }

  return success(res, {
    ...stats,
    pending_approval: stats.pendingApproval,
    statusLabels: QUOTATION_STATUS_LABELS,
  });
});

exports.getPendingQuotationApprovals = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return forbidden(res, "Only admin can view pending quotation approvals");
  const {
    leadId,
    status,
    approvalStatus,
    search,
    buildingType,
    startDate,
    endDate,
    page = 1,
    limit = 20,
    sort = "latest",
  } = req.query;
  const dateFilter = buildDateFilter({ startDate, endDate });
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const skip = (parsedPage - 1) * parsedLimit;

  const filter = { ...dateFilter };
  if (leadId) filter.leadId = leadId;
  if (buildingType) filter.buildingType = buildingType;
  if (search) filter.quoteNumber = { $regex: String(search).trim(), $options: "i" };

  const normalizedApprovalStatus = String(approvalStatus || "").trim().toLowerCase();
  if (normalizedApprovalStatus && !QUOTATION_APPROVAL_STATUSES.includes(normalizedApprovalStatus)) {
    return badRequest(
      res,
      `Invalid approvalStatus. Use: ${QUOTATION_APPROVAL_STATUSES.join(", ")}`
    );
  }
  if (normalizedApprovalStatus) {
    filter["approval.status"] = normalizedApprovalStatus;
  }

  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (normalizedStatus) {
    if (!QUOTATION_STATUS_FILTERS.includes(normalizedStatus)) {
      return badRequest(
        res,
        `Invalid status. Use: ${QUOTATION_STATUS_FILTERS.join(", ")}`
      );
    }
    if (normalizedStatus === "pending_approval") filter["approval.status"] = "pending_approval";
    else if (normalizedStatus === "pending") filter["approval.status"] = "pending_approval";
    else if (normalizedStatus === "approved") filter["approval.status"] = "approved";
    else if (normalizedStatus === "rejected") filter["approval.status"] = "rejected";
    else if (normalizedStatus === "draft") filter["approval.status"] = "not_submitted";
    else if (["sent", "accepted"].includes(normalizedStatus)) filter.status = normalizedStatus;
  }

  const normalizedSort = String(sort || "latest").trim().toLowerCase();
  if (!QUOTATION_SORT_VALUES.includes(normalizedSort)) {
    return badRequest(
      res,
      `Invalid sort. Use: ${QUOTATION_SORT_VALUES.join(", ")}`
    );
  }
  const sortQuery = normalizedSort === "oldest" ? { createdAt: 1 } : { createdAt: -1 };

  const [quotations, total] = await Promise.all([
    Quotation.find(filter)
      .populate("customerId", "firstName lastName email company")
      .populate("leadId", "jobId projectName")
      .populate("createdBy", QUOTATION_USER_FIELDS)
      .populate("approval.submittedBy", QUOTATION_USER_FIELDS)
      .populate("approval.reviewedBy", QUOTATION_USER_FIELDS)
      .populate("approval.history.by", QUOTATION_USER_FIELDS)
      .sort(sortQuery)
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Quotation.countDocuments(filter),
  ]);

  const decorated = quotations.map((q) => ({
    ...q,
    approvalStatus: q.approval?.status || "not_submitted",
    workflowStatus: getWorkflowStatus(q),
    pdfLink: buildQuotationPdfLink(q),
  }));
  await attachCustomerEmails(decorated);

  return success(res, {
    quotations: decorated,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
    },
    filters: {
      leadId: leadId || null,
      status: normalizedStatus || null,
      approvalStatus: normalizedApprovalStatus || null,
      buildingType: buildingType || null,
      search: search || null,
      startDate: startDate || null,
      endDate: endDate || null,
      sort: normalizedSort,
    },
  });
});

exports.getQuoteSummary = asyncHandler(async (req, res) => {
  const summary = await QuoteSummary.findOne({
    quotationId: req.params.quotationId,
  }).lean();
  if (!summary) return notFound(res, "Summary not generated yet");
  return success(res, { summary });
});

exports.deleteQuotation = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId)
  if (!quotation) return notFound(res, 'Quotation not found')
  if (req.user.role === 'sales' && String(quotation.createdBy) !== String(req.user._id)) {
    return forbidden(res, 'Access denied')
  }
  if (quotation.status !== 'draft') return badRequest(res, 'Only draft quotations can be deleted')

  await Quotation.findByIdAndDelete(req.params.quotationId)

  await auditService.log({
    type: 'quotation',
    action: AUDIT_ACTIONS.QUOTATION_DELETED,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: { quotationId: quotation._id },
  })

  return success(res, {}, 'Quotation deleted')
})

const pickQuoteSalesTax = (source = {}) => {
  const salesTax =
    source.salesTax ||
    source.fullQuoteResult?.salesTax ||
    source.storagePricingResult?.salesTax ||
    {};
  return {
    tax: toNumber(salesTax.amount, 0),
    taxRate: toNumber(salesTax.rate, 0),
  };
};

exports.getLatestApprovedQuotationTax = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const { error: accessError, code } = await checkLeadAccess(leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);

  const quotation = await Quotation.findOne({
    leadId,
    "approval.status": "approved",
  })
    .sort({ "approval.reviewedAt": -1, createdAt: -1 })
    .lean();

  if (!quotation) {
    return notFound(res, "No approved quotation found for this lead");
  }

  let tax = 0;
  let taxRate = 0;
  let estimateGrandTotal = 0;
  if (quotation.sourceEstimateId) {
    const estimate = await EstimateQuote.findById(quotation.sourceEstimateId)
      .select("salesTax storagePricingResult fullQuoteResult totalSell pricingResult")
      .lean();
    const picked = pickQuoteSalesTax(estimate || {});
    tax = picked.tax;
    taxRate = picked.taxRate;
    estimateGrandTotal = resolveEstimateGrandTotal(estimate || {});
  }

  const quoteValue =
    toNumber(quotation.finalPrice, 0) ||
    estimateGrandTotal ||
    toNumber(quotation.basePrice, 0);

  return success(res, {
    leadId: quotation.leadId,
    quotationId: quotation._id,
    quoteNumber: quotation.quoteNumber || "",
    quoteValue,
    tax,
    taxRate,
    salesTax: {
      amount: tax,
      rate: taxRate,
    },
    currency: quotation.currency || "USD",
    approvalStatus: quotation.approval?.status || "approved",
    versionNumber: quotation.versionNumber || 1,
    reviewedAt: quotation.approval?.reviewedAt || null,
  });
});

exports.getLeadQuotations = asyncHandler(async (req, res) => {
  const { leadId } = req.params;
  const dateFilter = buildDateFilter(req.query);

  const quotations = await Quotation.find({ leadId, ...dateFilter })
    .populate("createdBy", QUOTATION_USER_FIELDS)
    .populate("approval.submittedBy", QUOTATION_USER_FIELDS)
    .populate("approval.reviewedBy", QUOTATION_USER_FIELDS)
    .populate("approval.history.by", QUOTATION_USER_FIELDS)
    .sort({ createdAt: -1 })
    .lean();

  const { status, approvalStatus } = req.query;
  let rows = quotations;
  if (status) rows = rows.filter((q) => q.status === status);
  if (approvalStatus && QUOTATION_APPROVAL_STATUSES.includes(approvalStatus)) {
    rows = rows.filter((q) => (q.approval?.status || "not_submitted") === approvalStatus);
  }

  const decorated = rows.map((q) => ({
    ...q,
    approvalStatus: q.approval?.status || "not_submitted",
    workflowStatus: getWorkflowStatus(q),
    pdfLink: buildQuotationPdfLink(q),
  }));
  await attachCustomerEmails(decorated);

  return success(res, {
    quotations: decorated,
  });
});
