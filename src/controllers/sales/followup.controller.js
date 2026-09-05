const FollowUp = require("../../models/FollowUp");
const AuditLog = require("../../models/AuditLog");
const Lead = require("../../models/Lead");
const Invoice = require("../../models/Invoice");
const PaymentFollowUp = require("../../models/PaymentFollowUp");
const AIScriptSession = require("../../models/AIScriptSession");
const aiScriptChat = require("../../services/ai/aiScriptChat.service");
const auditService = require("../../services/audit.service");
const {
  success,
  created,
  notFound,
  forbidden,
  badRequest,
} = require("../../utils/apiResponse");
const asyncHandler = require("../../utils/asyncHandler");
const { buildDateFilter } = require("../../utils/dateRange");
const { AUDIT_ACTIONS } = require("../../config/constants");
const { getOrCreateConfig } = require("../../services/followup/followUpAutomation.service");
const { resolveFollowUpDate } = require("../../utils/timezoneDate");
const {
  scheduleFollowUpReminder,
} = require("../../utils/scheduler/followUpScheduler");
const {
  upsertFollowUpEvent,
  markFollowUpCompleted,
} = require("../../services/calendar/calendarSync.service");

const normalizeFollowUpStatus = (status) =>
  String(status || "").trim().toLowerCase();
const isCompleted = (f) =>
  normalizeFollowUpStatus(f?.status) === "completed" || Boolean(f?.completedAt);
const isOverdue = (f) =>
  !isCompleted(f) &&
  normalizeFollowUpStatus(f?.status) === "pending" &&
  new Date(f.followUpDate) < new Date();

exports.getStats = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query);
  const now = new Date();

  const all = await FollowUp.find({
    assignedTo: req.user._id,
    ...dateFilter,
  }).lean();
  const total = all.length;
  const completed = all.filter((f) => f.status === "completed").length;
  const overdue = all.filter(isOverdue).length;
  const upcoming = all.filter(
    (f) => f.status === "pending" && new Date(f.followUpDate) >= now,
  ).length;

  return success(res, { total, upcoming, completed, overdue });
});

exports.getUpcoming = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query, "followUpDate");

  const followups = await FollowUp.find({
    assignedTo: req.user._id,
    status: "pending",
    followUpDate: { $gte: new Date() },
    ...dateFilter,
  })
    .populate("leadId")
    .populate("customerId")
    .sort({ followUpDate: 1 })
    .lean();

  return success(res, { followups });
});

exports.getTrend = asyncHandler(async (req, res) => {
  const { range = "7d" } = req.query;
  const rangeMap = { "7d": 7, "30d": 30, "3m": 90 };
  const days = rangeMap[range] || 7;
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - days);

  const [createdRaw, completedRaw] = await Promise.all([
    FollowUp.find({ assignedTo: req.user._id, createdAt: { $gte: start } })
      .select("createdAt")
      .lean(),
    FollowUp.find({
      assignedTo: req.user._id,
      status: "completed",
      completedAt: { $gte: start },
    })
      .select("completedAt")
      .lean(),
  ]);

  const dateMap = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dateMap[key] = { date: key, created: 0, completed: 0 };
  }

  for (const f of createdRaw) {
    const key = new Date(f.createdAt).toISOString().slice(0, 10);
    if (dateMap[key]) dateMap[key].created++;
  }
  for (const f of completedRaw) {
    const key = new Date(f.completedAt).toISOString().slice(0, 10);
    if (dateMap[key]) dateMap[key].completed++;
  }

  return success(res, { data: Object.values(dateMap) });
});

exports.getResponseRate = asyncHandler(async (req, res) => {
  const dateFilter = buildDateFilter(req.query);
  const ownLeadIds = await Lead.find({ assignedSales: req.user._id }).distinct(
    "_id",
  );

  const activities = await AuditLog.find({
    type: "activity",
    leadId: { $in: ownLeadIds },
    ...dateFilter,
  }).lean();

  const platforms = ["call", "email", "meeting", "note"];
  const breakdown = platforms.map((platform) => {
    const entries = activities.filter(
      (a) => a.metadata?.activityType === platform,
    );
    const total = entries.length;
    const responded = entries.filter(
      (a) => a.metadata?.outcome && a.metadata.outcome !== "no_response",
    ).length;
    const rate = total > 0 ? Math.round((responded / total) * 100) : 0;
    return { platform, total, responded, rate };
  });

  return success(res, { breakdown });
});

exports.createFollowUp = asyncHandler(async (req, res) => {
  const {
    leadId,
    followUpDate,
    modeOfContact,
    notes,
    priority,
    reminderMinutes,
    notifyCustomer,
    sendSms,
    sendEmail,
  } = req.body;
  const lead = await Lead.findById(leadId).select("customerId").lean();
  if (!lead) return notFound(res, "Lead not found");
  const customerId = lead.customerId;
  const config = await getOrCreateConfig();
  const normalizedDate = resolveFollowUpDate(followUpDate, {
    timezone: config?.timezone || "UTC",
  });
  if (!normalizedDate.date) return badRequest(res, "Invalid followUpDate");

  const followUp = await FollowUp.create({
    leadId,
    customerId,
    assignedTo: req.user._id,
    createdBy: req.user._id,
    followUpDate: normalizedDate.date,
    modeOfContact: modeOfContact || "call",
    reminderMinutes: Number(reminderMinutes ?? 30),
    notifyCustomer: notifyCustomer !== false,
    sendSms: sendSms !== false,
    sendEmail: sendEmail !== false,
    notes: notes || "",
    priority: priority || "medium",
  });

  await auditService.log({
    type: "followup",
    action: AUDIT_ACTIONS.FOLLOWUP_CREATED,
    leadId,
    customerId,
    performedBy: req.user._id,
    metadata: {
      followUpDate,
      followUpDateUtc: normalizedDate.date,
      followUpTimezone: normalizedDate.timezoneUsed,
      followUpParseMode: normalizedDate.mode,
      priority,
      modeOfContact,
      reminderMinutes,
      notifyCustomer,
      sendSms,
      sendEmail,
    },
  });

  scheduleFollowUpReminder(followUp);
  await upsertFollowUpEvent(followUp);

  return created(res, { followUp });
});

exports.completeFollowUp = asyncHandler(async (req, res) => {
  const { followUpId } = req.params;

  const followUp = await FollowUp.findById(followUpId);
  if (!followUp) return notFound(res, "Follow-up not found");
  if (String(followUp.assignedTo) !== String(req.user._id))
    return forbidden(res, "Access denied");

  followUp.status = "completed";
  followUp.completedAt = new Date();
  await followUp.save();
  await markFollowUpCompleted(followUp);

  await auditService.log({
    type: "followup",
    action: AUDIT_ACTIONS.FOLLOWUP_COMPLETED,
    leadId: followUp.leadId,
    customerId: followUp.customerId,
    performedBy: req.user._id,
    metadata: { followUpId },
  });

  return success(res, { followUp }, "Follow-up marked as completed");
});

exports.getCommunicationTimeline = asyncHandler(async (req, res) => {
  const { leadId, activityType, page = 1, limit = 20 } = req.query;
  const dateFilter = buildDateFilter(req.query);
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1);

  const ownLeadIds = await Lead.find({ assignedSales: req.user._id }).distinct(
    "_id",
  );

  const filter = {
    type: "activity",
    leadId: { $in: ownLeadIds },
    ...dateFilter,
  };
  if (leadId) filter.leadId = leadId;
  if (activityType) filter["metadata.activityType"] = activityType;

  const skip = (parsedPage - 1) * parsedLimit;
  const [entries, total] = await Promise.all([
    AuditLog.find(filter)
      .populate({ path: "leadId", select: "projectName" })
      .populate({ path: "customerId", select: "firstName" })
      .populate({ path: "performedBy", select: "name" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  return success(res, { entries, total });
});

exports.getAIScriptSessions = asyncHandler(async (req, res) => {
  const sessions = await AIScriptSession.find({ salesEmployeeId: req.user._id })
    .populate({ path: "leadId", select: "projectName" })
    .sort({ createdAt: -1 })
    .lean();

  return success(res, { sessions });
});

exports.postAIScript = asyncHandler(async (req, res) => {
  const { messages, leadId } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return badRequest(res, "messages array is required");
  }

  const { reply, sessionId } = await aiScriptChat.runOneShot({
    userId: req.user._id,
    leadId: leadId || null,
    messages,
  });

  return success(res, { reply, sessionId });
});

exports.getSmartReminders = asyncHandler(async (req, res) => {
  const salesId = req.user._id;
  const now = new Date();

  const leads = await Lead.find({
    assignedSales: salesId,
    lifecycleStatus: { $nin: ["won", "lost"] },
    isTerminated: { $ne: true },
  })
    .select("_id projectName jobId temperature lifecycleStatus lastActivityAt")
    .lean();

  const leadIds = leads.map((l) => l._id);

  const lastFollowUps = await FollowUp.find({ leadId: { $in: leadIds } })
    .sort({ followUpDate: -1 })
    .select("leadId followUpDate status completedAt")
    .lean();

  const lastFuMap = {};
  for (const fu of lastFollowUps) {
    const key = String(fu.leadId);
    if (!lastFuMap[key]) lastFuMap[key] = fu;
  }

  const TEMP_SCORE = { hot: 90, warm: 70, cold: 40 };

  const reminders = leads
    .map((lead) => {
      const key = String(lead._id);
      const lastFu = lastFuMap[key];
      const daysSinceLast = lastFu
        ? Math.floor((now - new Date(lastFu.followUpDate)) / 86400000)
        : 30;

      const tempScore = TEMP_SCORE[lead.temperature] || 50;
      const recencyBoost = Math.min(daysSinceLast * 2, 30);
      const confidence = Math.min(
        Math.round((tempScore + recencyBoost) / 1.2),
        99,
      );

      const nextTime = new Date(now);
      if (lead.temperature === "hot")
        nextTime.setHours(nextTime.getHours() + 4);
      else if (lead.temperature === "warm")
        nextTime.setDate(nextTime.getDate() + 1);
      else nextTime.setDate(nextTime.getDate() + 3);

      return {
        leadId: lead._id,
        projectName: lead.projectName,
        jobId: lead.jobId,
        temperature: lead.temperature,
        lifecycleStatus: lead.lifecycleStatus,
        confidence,
        suggestedTime: nextTime,
        daysSinceLastFollowUp: daysSinceLast,
        lastFollowUpStatus: lastFu?.status || null,
      };
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 20);

  const active = reminders.filter((r) => r.confidence >= 70).length;

  return success(res, { reminders, active });
});

exports.getFollowUpKPIs = asyncHandler(async (req, res) => {
  const salesId = req.user._id;
  const now = new Date();

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);
  const prevWeekStart = new Date(now);
  prevWeekStart.setDate(now.getDate() - 14);
  prevWeekStart.setHours(0, 0, 0, 0);
  const prevWeekEnd = new Date(weekStart);
  prevWeekEnd.setMilliseconds(-1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(monthStart);
  prevMonthEnd.setMilliseconds(-1);

  const ownLeadIds = await Lead.find({ assignedSales: salesId }).distinct(
    "_id",
  );

  const [
    weekFollowUps,
    prevWeekFollowUps,
    thisMonthActivities,
    prevMonthActivities,
    thisMonthWon,
    prevMonthWon,
    thisMonthLeads,
    prevMonthLeads,
    modeBreakdown,
    weekTrend,
  ] = await Promise.all([
    FollowUp.countDocuments({
      assignedTo: salesId,
      createdAt: { $gte: weekStart },
    }),
    FollowUp.countDocuments({
      assignedTo: salesId,
      createdAt: { $gte: prevWeekStart, $lte: prevWeekEnd },
    }),
    AuditLog.find({
      type: "activity",
      leadId: { $in: ownLeadIds },
      createdAt: { $gte: monthStart },
    })
      .select("metadata")
      .lean(),
    AuditLog.find({
      type: "activity",
      leadId: { $in: ownLeadIds },
      createdAt: { $gte: prevMonthStart, $lte: prevMonthEnd },
    })
      .select("metadata")
      .lean(),
    Lead.countDocuments({
      assignedSales: salesId,
      lifecycleStatus: "won",
      updatedAt: { $gte: monthStart },
    }),
    Lead.countDocuments({
      assignedSales: salesId,
      lifecycleStatus: "won",
      updatedAt: { $gte: prevMonthStart, $lte: prevMonthEnd },
    }),
    Lead.countDocuments({
      assignedSales: salesId,
      createdAt: { $gte: monthStart },
    }),
    Lead.countDocuments({
      assignedSales: salesId,
      createdAt: { $gte: prevMonthStart, $lte: prevMonthEnd },
    }),
    FollowUp.aggregate([
      { $match: { assignedTo: salesId, createdAt: { $gte: monthStart } } },
      { $group: { _id: "$modeOfContact", count: { $sum: 1 } } },
    ]),
    FollowUp.aggregate([
      { $match: { assignedTo: salesId, createdAt: { $gte: weekStart } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const responded = thisMonthActivities.filter(
    (a) => a.metadata?.outcome && a.metadata.outcome !== "no_response",
  ).length;
  const prevResponded = prevMonthActivities.filter(
    (a) => a.metadata?.outcome && a.metadata.outcome !== "no_response",
  ).length;
  const responseRate = thisMonthActivities.length
    ? Math.round((responded / thisMonthActivities.length) * 100)
    : 0;
  const prevResponseRate = prevMonthActivities.length
    ? Math.round((prevResponded / prevMonthActivities.length) * 100)
    : 0;

  const conversionRate = thisMonthLeads
    ? Math.round((thisMonthWon / thisMonthLeads) * 100)
    : 0;
  const prevConvRate = prevMonthLeads
    ? Math.round((prevMonthWon / prevMonthLeads) * 100)
    : 0;

  const weekDiff = prevWeekFollowUps
    ? Math.round(
        ((weekFollowUps - prevWeekFollowUps) / prevWeekFollowUps) * 100,
      )
    : 0;
  const respDiff = responseRate - prevResponseRate;
  const convDiff = conversionRate - prevConvRate;

  const modeMap = { email: 0, call: 0, meeting: 0 };
  let modeTotal = 0;
  for (const m of modeBreakdown) {
    const key = m._id?.toLowerCase();
    if (modeMap[key] !== undefined) modeMap[key] = m.count;
    modeTotal += m.count;
  }
  const responseTrend = Object.entries(modeMap).map(([mode, count]) => ({
    mode,
    count,
    pct: modeTotal ? Math.round((count / modeTotal) * 100) : 0,
  }));

  const trendMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    trendMap[key] = { date: key, count: 0 };
  }
  for (const pt of weekTrend) {
    if (trendMap[pt._id]) trendMap[pt._id].count = pt.count;
  }

  return success(res, {
    weeklyFollowUps: { count: weekFollowUps, vsLastWeekPct: weekDiff },
    responseRate: { pct: responseRate, vsLastWeekPct: respDiff },
    conversionRate: { pct: conversionRate, vsLastMonthPct: convDiff },
    autoSnoozeReactivation: { pct: 40 },
    followUpsTrend: Object.values(trendMap),
    responseTrend,
  });
});

exports.getPaymentFollowUps = asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);

  const ownLeadIds = await Lead.find({ assignedSales: req.user._id }).distinct(
    "_id",
  );

  const filter = { leadId: { $in: ownLeadIds } };
  if (status) filter.status = status;

  if (search?.trim()) {
    // Search targets project name/jobId (leadId) and invoice number — both live on populated
    // refs, not directly on PaymentFollowUp, so resolve matching ids first.
    const regex = new RegExp(search.trim(), 'i')
    const [matchingLeads, matchingInvoices] = await Promise.all([
      Lead.find({ _id: { $in: ownLeadIds }, $or: [{ projectName: regex }, { jobId: regex }] }).select('_id').lean(),
      Invoice.find({ invoiceNumber: regex }).select('_id').lean(),
    ])
    filter.$or = [
      { leadId: { $in: matchingLeads.map((l) => l._id) } },
      { invoiceId: { $in: matchingInvoices.map((i) => i._id) } },
    ]
  }

  const skip = (parsedPage - 1) * parsedLimit;
  const [followUps, total] = await Promise.all([
    PaymentFollowUp.find(filter)
      .populate({
        path: "invoiceId",
        select: "invoiceNumber totalAmount status date paidAt",
      })
      .populate({ path: "leadId", select: "projectName jobId" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    PaymentFollowUp.countDocuments(filter),
  ]);

  return success(res, {
    followUps,
    total,
    page: parsedPage,
    limit: parsedLimit,
  });
});

exports.createPaymentFollowUp = asyncHandler(async (req, res) => {
  const { invoiceId, leadId, nextFollowUp, notes } = req.body;

  const [inv, lead] = await Promise.all([
    Invoice.findById(invoiceId).select("_id").lean(),
    Lead.findOne({ _id: leadId, assignedSales: req.user._id })
      .select("_id")
      .lean(),
  ]);
  if (!inv) return notFound(res, "Invoice not found");
  if (!lead) return notFound(res, "Lead not found or not assigned to you");

  const record = await PaymentFollowUp.create({
    invoiceId,
    leadId,
    createdBy: req.user._id,
    nextFollowUp: nextFollowUp ? new Date(nextFollowUp) : null,
    notes: notes || "",
    status: "pending",
  });

  return created(res, { followUp: record });
});

exports.updatePaymentFollowUpStatus = asyncHandler(async (req, res) => {
  const { followUpId } = req.params;
  const { status } = req.body;

  const VALID = ["pending", "confirmed", "notified_to_accounts"];
  if (!VALID.includes(status)) return badRequest(res, "Invalid status");

  const record = await PaymentFollowUp.findById(followUpId);
  if (!record) return notFound(res, "Payment follow-up not found");

  record.status = status;
  await record.save();

  return success(res, { followUp: record }, "Status updated");
});

// Figma "Quotation" screen shows status labels Approved/Pending Approval/Rejected/Quote Sent —
// best-effort mapping onto the model's draft/sent/accepted/rejected enum.
const QUOTATION_STATUS_LABELS = { draft: 'Draft', sent: 'Pending Approval', accepted: 'Approved', rejected: 'Rejected' }
const APPROVAL_STATUSES = ['not_submitted', 'pending_approval', 'approved', 'rejected']

const resolveQuotationWorkflowStatus = (quotation = {}) => {
  if (quotation.status === 'sent') return 'sent'
  const approvalStatus = quotation.approval?.status || 'not_submitted'
  if (approvalStatus === 'pending_approval') return 'pending_approval'
  if (approvalStatus === 'approved') return 'approved'
  if (approvalStatus === 'rejected') return 'rejected'
  return 'draft'
}

const applySalesQuotationStatusFilter = (filter, statusRaw) => {
  const status = String(statusRaw || '').trim().toLowerCase()
  if (!status) return

  if (status === 'sent') {
    filter.status = 'sent'
    return
  }

  if (status === 'approved') {
    filter.$or = [{ 'approval.status': 'approved' }, { status: 'accepted' }]
    return
  }

  if (status === 'rejected') {
    filter.$or = [{ 'approval.status': 'rejected' }, { status: 'rejected' }]
    return
  }

  if (status === 'draft') {
    filter.status = { $ne: 'sent' }
    filter.$or = [
      { approval: { $exists: false } },
      { 'approval.status': { $exists: false } },
      { 'approval.status': 'not_submitted' },
    ]
    return
  }

  if (APPROVAL_STATUSES.includes(status)) {
    filter['approval.status'] = status
    return
  }

  filter.status = status
}

exports.getMyQuotations = asyncHandler(async (req, res) => {
  const Quotation = require("../../models/Quotation");
  const { status, approvalStatus, search, buildingType, minValue, maxValue, page = 1, limit = 20 } = req.query;
  const dateFilter = buildDateFilter(req.query);
  const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
  const parsedLimit = Math.max(parseInt(limit, 10) || 20, 1);

  const filter = { createdBy: req.user._id, ...dateFilter };
  if (status) applySalesQuotationStatusFilter(filter, status);
  const normalizedApprovalStatus = String(approvalStatus || '').trim().toLowerCase()
  if (normalizedApprovalStatus && APPROVAL_STATUSES.includes(normalizedApprovalStatus)) {
    filter['approval.status'] = normalizedApprovalStatus
  }
  if (buildingType) filter.buildingType = buildingType;
  if (minValue || maxValue) {
    filter.finalPrice = {};
    if (minValue) filter.finalPrice.$gte = Number(minValue);
    if (maxValue) filter.finalPrice.$lte = Number(maxValue);
  }
  if (search) filter.quoteNumber = { $regex: search, $options: "i" };

  const skip = (parsedPage - 1) * parsedLimit;
  const [quotations, total] = await Promise.all([
    Quotation.find(filter)
      .populate({ path: "leadId", select: "projectName" })
      .populate({ path: "customerId", select: "firstName email" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Quotation.countDocuments(filter),
  ]);

  const result = quotations.map((q) => {
    const approval = q.approval || {}
    const approvalStatusValue = approval.status || 'not_submitted'
    const workflowStatus = resolveQuotationWorkflowStatus(q)
    const approvalHistory = Array.isArray(approval.history) ? approval.history : []
    const latestApprovalEvent = approvalHistory.length
      ? approvalHistory[approvalHistory.length - 1]
      : null
    return {
      _id: q._id,
      quoteNumber: q.quoteNumber || "",
      versionNumber: q.versionNumber || 1,
      status: workflowStatus,
      quotationStatus: q.status || 'draft',
      approvalStatus: approvalStatusValue,
      workflowStatus,
      rejectionReason: approval.rejectionReason || '',
      approvalMessage: latestApprovalEvent?.note || '',
      approvalReviewedAt: approval.reviewedAt || null,
      finalPrice: q.finalPrice || 0,
      leadId: q.leadId
        ? { _id: q.leadId._id, projectName: q.leadId.projectName }
        : null,
      customerId: q.customerId
        ? {
            _id: q.customerId._id,
            firstName: q.customerId.firstName,
            email: q.customerId.email,
          }
        : null,
      createdAt: q.createdAt,
      sentAt: q.sentAt || null,
    }
  });

  return success(res, {
    quotations: result,
    total,
    page: parsedPage,
    limit: parsedLimit,
  });
});

exports.getQuotationStats = asyncHandler(async (req, res) => {
  const Quotation = require("../../models/Quotation");
  const dateFilter = buildDateFilter(req.query);
  const filter = { createdBy: req.user._id, ...dateFilter };
  const quotations = await Quotation.find(filter).select('status approval').lean()

  const stats = {
    total: quotations.length,
    approved: 0,
    pendingApproval: 0,
    rejected: 0,
    sent: 0,
    draft: 0,
  }

  for (const quotation of quotations) {
    const workflowStatus = resolveQuotationWorkflowStatus(quotation)
    if (workflowStatus === 'approved') stats.approved += 1
    else if (workflowStatus === 'pending_approval') stats.pendingApproval += 1
    else if (workflowStatus === 'rejected') stats.rejected += 1
    else if (workflowStatus === 'sent') stats.sent += 1
    else stats.draft += 1
  }

  return success(res, {
    ...stats,
    pending_approval: stats.pendingApproval,
    statusLabels: QUOTATION_STATUS_LABELS,
  });
});
