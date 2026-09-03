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
const QUOTATION_APPROVAL_STATUSES = ["not_submitted", "pending_approval", "approved", "rejected"];
const QUOTATION_USER_FIELDS = "name email role";

const populateQuotationUsers = (query) =>
  query
    .populate("createdBy", QUOTATION_USER_FIELDS)
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

// Sales can only act on their assigned leads
const checkLeadAccess = async (leadId, user) => {
  const lead = await Lead.findById(leadId);
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

const buildQuotationDocumentMeta = (quotation = {}, estimate = null) => {
  const estimateId = quotation.sourceEstimateId || estimate?._id || null;
  const hasPricingData = Boolean(
    estimate?.pricingResult ||
      estimate?.fullQuoteResult?.pricing ||
      estimate?.storagePricingResult
  );
  return {
    source: estimateId ? "estimate" : "quotation",
    sourceEstimateId: estimateId || null,
    hasPricingData,
    previewEndpoint: estimateId ? "/api/sales/estimates/documents/preview" : null,
    pdfEndpoint: estimateId
      ? `/api/sales/estimates/${estimateId}/documents/pdf`
      : null,
    defaultSections: ["quote", "sow", "contract", "drawings"],
  };
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
  const estimate = await EstimateQuote.findById(estimateId);
  if (!estimate) return notFound(res, "Estimate not found");

  if (!estimate.leadId) {
    return badRequest(res, "Estimate is not linked to a lead. leadId is required to convert.");
  }

  const { lead, error: accessError, code } = await checkLeadAccess(estimate.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);

  const quoteNumber = await generateQuoteNumber();
  const quotationPayload = mapEstimateToQuotationPayload(estimate.toObject(), lead, req.user);
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
    performedBy: req.user._id,
    metadata: {
      quotationId: quotation._id,
      quoteNumber: quotation.quoteNumber,
      source: "estimate_conversion",
      sourceEstimateId: estimate._id,
      approvalStatus: quotation.approval?.status || "not_submitted",
    },
  });

  if (req.user.role === "sales") {
    await auditService.log({
      type: "quotation",
      action: AUDIT_ACTIONS.QUOTATION_SUBMITTED_FOR_APPROVAL,
      leadId: lead._id,
      customerId: lead.customerId,
      performedBy: req.user._id,
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
      performedBy: req.user._id,
      metadata: {
        quotationId: quotation._id,
        quoteNumber: quotation.quoteNumber,
        source: "estimate_conversion_admin",
      },
    });
  }

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
  ensureApprovalState(quotation);
  if (quotation.approval.status !== "approved") {
    return badRequest(res, "Quotation must be approved by admin before sending");
  }
  if (
    quotation.approval.approvedVersionNumber != null &&
    Number(quotation.approval.approvedVersionNumber) !== Number(quotation.versionNumber || 1)
  ) {
    return badRequest(res, "Quotation was edited after approval. Please resubmit for admin approval.");
  }

  const customer = await Customer.findById(quotation.customerId);
  if (!customer) return notFound(res, "Customer not found");
  if (!customer.email) return badRequest(res, "Customer has no email address on file");

  let emailResult = { provider: "unknown" };
  try {
    emailResult = await mailer.sendQuotation({
      toEmail: customer.email,
      customerName: customer.firstName,
      quotation,
    });
  } catch (err) {
    console.error("[sendQuotation] Email failed for quotation", quotation.quoteNumber, err.message);
    return error(res, `Failed to send quotation email: ${err.message}`, 502);
  }

  quotation.status = "sent";
  quotation.sentAt = new Date();
  pushApprovalHistory(quotation, {
    status: "sent",
    note: `Quotation sent to customer (${customer.email})`,
    by: req.user._id,
  });
  await quotation.save();

  // Only advance lifecycle — never regress a stage already reached
  const leadForStage = await Lead.findById(quotation.leadId).lean();
  if (leadForStage) {
    const targetIdx = LIFECYCLE_STAGES.indexOf("proposal_sent");
    const currentIdx = LIFECYCLE_STAGES.indexOf(leadForStage.lifecycleStatus);
    if (targetIdx > currentIdx) {
      await Lead.findByIdAndUpdate(quotation.leadId, {
        lifecycleStatus: "proposal_sent",
        $push: {
          lifecycleHistory: {
            stage: "proposal_sent",
            changedAt: new Date(),
            changedBy: req.user._id,
          },
        },
      });
    }
  }

  await auditService.log({
    type: "quotation",
    action: AUDIT_ACTIONS.QUOTATION_SENT,
    leadId: quotation.leadId,
    customerId: quotation.customerId,
    performedBy: req.user._id,
    metadata: {
      quotationId: quotation._id,
      sentTo: customer.email,
      provider: emailResult?.provider || "unknown",
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
    },
    "Quotation sent successfully",
  );
});

exports.submitQuotationForApproval = asyncHandler(async (req, res) => {
  const quotation = await Quotation.findById(req.params.quotationId);
  if (!quotation) return notFound(res, "Quotation not found");
  if (quotation.status === "sent") return badRequest(res, "Sent quotation cannot be submitted for approval");
  const { error: accessError, code } = await checkLeadAccess(quotation.leadId, req.user);
  if (accessError) return code === 404 ? notFound(res, accessError) : forbidden(res, accessError);

  ensureApprovalState(quotation);
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

exports.getPendingQuotationApprovals = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") return forbidden(res, "Only admin can view pending quotation approvals");
  const { leadId } = req.query;
  const filter = {
    status: { $ne: "sent" },
    "approval.status": "pending_approval",
  };
  if (leadId) filter.leadId = leadId;

  const quotations = await Quotation.find(filter)
    .populate("createdBy", QUOTATION_USER_FIELDS)
    .populate("approval.submittedBy", QUOTATION_USER_FIELDS)
    .populate("approval.reviewedBy", QUOTATION_USER_FIELDS)
    .populate("approval.history.by", QUOTATION_USER_FIELDS)
    .sort({ "approval.submittedAt": 1, createdAt: 1 })
    .lean();

  return success(res, {
    quotations: quotations.map((q) => ({
      ...q,
      approvalStatus: q.approval?.status || "not_submitted",
      workflowStatus: getWorkflowStatus(q),
    })),
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

  return success(res, {
    quotations: rows.map((q) => ({
      ...q,
      approvalStatus: q.approval?.status || "not_submitted",
      workflowStatus: getWorkflowStatus(q),
    })),
  });
});
