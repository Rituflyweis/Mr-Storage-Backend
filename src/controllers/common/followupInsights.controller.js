const FollowUp = require("../../models/FollowUp");
const Lead = require("../../models/Lead");
const LeadTemperatureTransition = require("../../models/LeadTemperatureTransition");
const {
  buildActiveLeadMatch,
  isLeadActive,
} = require("../../utils/activeLeadScope");
const asyncHandler = require("../../utils/asyncHandler");
const {
  success,
  badRequest,
  forbidden,
  notFound,
} = require("../../utils/apiResponse");
const { buildDateFilter } = require("../../utils/dateRange");

const VALID_KINDS = ["manual", "automatic"];
const VALID_VIEWS = ["summary", "detail"];
const VALID_STATUS = ["pending", "completed", "overdue"];
const VALID_MODES = ["call", "email", "meeting", "sms"];
const VALID_TEMPERATURES = ["hot", "warm", "cold"];
const VALID_TRANSITION_SOURCES = ["manual_override", "ai_scoring", "system"];
const VALID_TRANSITION_STATES = [
  "hot_to_warm",
  "hot_to_cold",
  "warm_to_hot",
  "warm_to_cold",
  "cold_to_hot",
  "cold_to_warm",
];

const parsePagination = (query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(query.limit, 10) || 20), 200);
  return { page, limit, skip: (page - 1) * limit };
};

const computeStatus = (row, now = new Date()) => {
  if (row.status === "completed") return "completed";
  if (row.status === "pending" && new Date(row.followUpDate) < now)
    return "overdue";
  return "pending";
};

const resolveActivityAt = (row) => {
  if (row.status === "completed" && row.completedAt) return row.completedAt;
  if (row.createdAt) return row.createdAt;
  return row.followUpDate;
};

const parseTransitionState = (transitionState) => {
  if (!transitionState || !VALID_TRANSITION_STATES.includes(transitionState))
    return null;
  const [fromTemperature, toTemperature] =
    String(transitionState).split("_to_");
  if (!fromTemperature || !toTemperature) return null;
  return { fromTemperature, toTemperature };
};

const shouldAttachTransitionData = (query = {}) =>
  Boolean(query.startDate || query.endDate || query.transitionState);

const filterGroupedToActiveLeads = async (grouped = []) => {
  if (!grouped.length) return grouped;
  const leadIds = grouped.map((row) => row.leadId).filter(Boolean);
  const activeLeadIds = await Lead.find({
    ...buildActiveLeadMatch(),
    _id: { $in: leadIds },
  }).distinct("_id");
  const activeSet = new Set(activeLeadIds.map((id) => String(id)));
  return grouped.filter((row) => activeSet.has(String(row.leadId)));
};

const buildLeadTransitionSnapshot = async ({ req, leadIds = [] }) => {
  if (!leadIds.length)
    return { latestByLead: new Map(), matchedLeadSet: new Set() };

  const transitionPair = parseTransitionState(req.query.transitionState);
  const match = {
    leadId: { $in: leadIds },
  };
  const dateFilter = buildDateFilter(req.query, "changedAt");
  if (dateFilter.changedAt) match.changedAt = dateFilter.changedAt;
  if (transitionPair) {
    match.fromTemperature = transitionPair.fromTemperature;
    match.toTemperature = transitionPair.toTemperature;
  }

  const transitionRows = await LeadTemperatureTransition.find(match)
    .select("leadId fromTemperature toTemperature source changedAt metadata")
    .sort({ changedAt: -1, createdAt: -1 })
    .lean();

  const latestByLead = new Map();
  const matchedLeadSet = new Set();
  for (const row of transitionRows) {
    const key = String(row.leadId);
    matchedLeadSet.add(key);
    const scoreBefore = Number(row.metadata?.scoreBefore);
    const scoreAfter = Number(row.metadata?.scoreAfter);
    if (!latestByLead.has(key)) {
      latestByLead.set(key, {
        transitionState: `${row.fromTemperature}_to_${row.toTemperature}`,
        transitionFrom: row.fromTemperature,
        transitionTo: row.toTemperature,
        transitionAt: row.changedAt,
        transitionSource: row.source || null,
        scoreBefore: Number.isFinite(scoreBefore) ? scoreBefore : null,
        scoreAfter: Number.isFinite(scoreAfter) ? scoreAfter : null,
        scoreDelta:
          Number.isFinite(scoreBefore) && Number.isFinite(scoreAfter)
            ? Number((scoreAfter - scoreBefore).toFixed(2))
            : null,
        transitionReason: row.metadata?.reason || null,
      });
    }
  }

  return { latestByLead, matchedLeadSet };
};

const buildFollowUpMatch = async (req, { kind, leadId }) => {
  const match = {};
  const now = new Date();

  if (kind === "manual") match.source = "manual";
  else if (kind === "automatic") match.source = { $ne: "manual" };

  const dateFilter = buildDateFilter(req.query, "followUpDate");
  if (dateFilter.followUpDate) match.followUpDate = dateFilter.followUpDate;

  const mode = req.query.modeOfContact;
  if (mode) match.modeOfContact = mode;

  const status = req.query.status;
  if (status === "pending") match.status = "pending";
  else if (status === "completed") match.status = "completed";
  else if (status === "overdue") {
    match.status = "pending";
    match.followUpDate = { ...(match.followUpDate || {}), $lt: now };
  }

  if (leadId) match.leadId = leadId;

  if (req.user.role === "sales") {
    const ownedLeadIds = await Lead.find({
      assignedSales: req.user._id,
    }).distinct("_id");
    if (kind === "manual") {
      match.$or = [
        { createdBy: req.user._id },
        { assignedTo: req.user._id },
        { leadId: { $in: ownedLeadIds } },
      ];
    } else if (kind === "automatic") {
      match.leadId = leadId || { $in: ownedLeadIds };
    } else if (!leadId) {
      match.$or = [
        {
          source: "manual",
          $or: [
            { createdBy: req.user._id },
            { assignedTo: req.user._id },
            { leadId: { $in: ownedLeadIds } },
          ],
        },
        { source: { $ne: "manual" }, leadId: { $in: ownedLeadIds } },
      ];
    }
  }

  return { match, now };
};

const getLeadMap = async (leadIds = []) => {
  if (!leadIds.length) return new Map();
  const leads = await Lead.find({ _id: { $in: leadIds } })
    .select(
      "_id jobId projectName location quoteValue lifecycleStatus assignedSales leadScoring customerId",
    )
    .populate({ path: "customerId", select: "_id firstName" })
    .populate({ path: "assignedSales", select: "_id name email" })
    .lean();
  return new Map(
    leads.map((l) => [
      String(l._id),
      {
        ...l,
        customerName: l.customerId?.firstName || "",
        location: l.location || "",
        quoteValue: l.quoteValue ?? 0,
      },
    ]),
  );
};

exports.getFollowUpActivity = asyncHandler(async (req, res) => {
  const requestedKind = String(req.query.kind || "")
    .trim()
    .toLowerCase();
  const kind = requestedKind || "all";
  const view = String(req.query.view || "summary")
    .trim()
    .toLowerCase();
  if (requestedKind && !VALID_KINDS.includes(requestedKind))
    return badRequest(res, "Invalid kind. Use: manual, automatic");
  if (!VALID_VIEWS.includes(view))
    return badRequest(res, "Invalid view. Use: summary, detail");
  if (req.query.status && !VALID_STATUS.includes(String(req.query.status))) {
    return badRequest(res, "Invalid status. Use: pending, completed, overdue");
  }
  if (
    req.query.modeOfContact &&
    !VALID_MODES.includes(String(req.query.modeOfContact))
  ) {
    return badRequest(
      res,
      "Invalid modeOfContact. Use: call, email, meeting, sms",
    );
  }
  if (
    req.query.transitionState &&
    !VALID_TRANSITION_STATES.includes(String(req.query.transitionState))
  ) {
    return badRequest(
      res,
      `Invalid transitionState. Use: ${VALID_TRANSITION_STATES.join(", ")}`,
    );
  }

  const { page, limit, skip } = parsePagination(req.query);

  if (view === "detail") {
    const leadId = req.query.leadId;
    if (!leadId) return badRequest(res, "leadId is required for detail view");

    const lead = await Lead.findById(leadId)
      .select(
        "_id jobId projectName location quoteValue lifecycleStatus assignedSales leadScoring customerId",
      )
      .populate({ path: "customerId", select: "_id firstName" })
      .populate({ path: "assignedSales", select: "_id name email" })
      .lean();
    if (!lead) return notFound(res, "Lead not found");
    if (!isLeadActive(lead)) {
      return badRequest(
        res,
        "Lead is closed (PO-raised or plant-stage) and excluded from follow-up activity",
      );
    }
    lead.customerName = lead.customerId?.firstName || "";
    lead.location = lead.location || "";
    lead.quoteValue = lead.quoteValue ?? 0;
    if (
      req.user.role === "sales" &&
      String(lead.assignedSales?._id || lead.assignedSales) !==
        String(req.user._id)
    ) {
      return forbidden(res, "Access denied for this lead");
    }

    const { match, now } = await buildFollowUpMatch(req, { kind, leadId });
    const [rows, totalHistory, totalsAgg] = await Promise.all([
      FollowUp.find(match)
        .populate({ path: "assignedTo", select: "_id name email" })
        .populate({ path: "createdBy", select: "_id name email" })
        .sort({ followUpDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      FollowUp.countDocuments(match),
      FollowUp.find(match).select("status followUpDate").lean(),
    ]);

    const totals = totalsAgg.reduce(
      (acc, row) => {
        acc.followUpCount += 1;
        const s = computeStatus(row, now);
        if (s === "pending") acc.pendingCount += 1;
        else if (s === "completed") acc.completedCount += 1;
        else if (s === "overdue") acc.overdueCount += 1;
        return acc;
      },
      { followUpCount: 0, pendingCount: 0, completedCount: 0, overdueCount: 0 },
    );

    const history = rows.map((row) => ({
      _id: row._id,
      followUpDate: row.followUpDate,
      status: row.status,
      computedStatus: computeStatus(row, now),
      modeOfContact: row.modeOfContact,
      source: row.source,
      assignedTo: row.assignedTo || null,
      createdBy: row.createdBy || null,
      reminderMinutes: row.reminderMinutes,
      notifyCustomer: row.notifyCustomer,
      sendSms: row.sendSms,
      sendEmail: row.sendEmail,
      notes: row.notes || "",
      createdAt: row.createdAt,
      completedAt: row.completedAt || null,
    }));

    let transition = null;
    if (shouldAttachTransitionData(req.query)) {
      const snapshot = await buildLeadTransitionSnapshot({
        req,
        leadIds: [leadId],
      });
      transition = snapshot.latestByLead.get(String(leadId)) || null;
      if (req.query.transitionState && !transition) {
        return success(res, {
          kind,
          view,
          lead,
          totals,
          history: [],
          transition: null,
          pagination: { page, limit, totalHistory: 0 },
        });
      }
    }

    const detailLead = shouldAttachTransitionData(req.query)
      ? { ...lead, transition }
      : lead;

    return success(res, {
      kind,
      view,
      lead: detailLead,
      totals,
      history,
      transition,
      pagination: { page, limit, totalHistory },
    });
  }

  const { match, now } = await buildFollowUpMatch(req, { kind, leadId: null });
  const allRows = await FollowUp.find(match)
    .select("leadId followUpDate status createdAt completedAt")
    .lean();

  const leadSummaryMap = new Map();
  for (const row of allRows) {
    const key = String(row.leadId);
    const computedStatus = computeStatus(row, now);
    if (!leadSummaryMap.has(key)) {
      leadSummaryMap.set(key, {
        leadId: row.leadId,
        followUpCount: 0,
        pendingCount: 0,
        completedCount: 0,
        overdueCount: 0,
        lastActivityAt: null,
        lastFollowUpStatus: null,
      });
    }
    const bucket = leadSummaryMap.get(key);
    bucket.followUpCount += 1;
    if (computedStatus === "pending") bucket.pendingCount += 1;
    else if (computedStatus === "completed") bucket.completedCount += 1;
    else if (computedStatus === "overdue") bucket.overdueCount += 1;

    const activityAt = resolveActivityAt(row);
    const rowTime = new Date(activityAt).getTime();
    const lastTime = bucket.lastActivityAt
      ? new Date(bucket.lastActivityAt).getTime()
      : 0;
    if (!bucket.lastActivityAt || rowTime > lastTime) {
      bucket.lastActivityAt = activityAt;
      bucket.lastFollowUpStatus = computedStatus;
    }
  }

  const totals = {
    leadCount: leadSummaryMap.size,
    followUpCount: 0,
    pendingCount: 0,
    completedCount: 0,
    overdueCount: 0,
  };
  for (const row of leadSummaryMap.values()) {
    totals.followUpCount += row.followUpCount;
    totals.pendingCount += row.pendingCount;
    totals.completedCount += row.completedCount;
    totals.overdueCount += row.overdueCount;
  }

  let grouped = [...leadSummaryMap.values()];
  grouped = await filterGroupedToActiveLeads(grouped);
  grouped = grouped.sort(
    (a, b) =>
      new Date(b.lastActivityAt || 0).getTime() -
      new Date(a.lastActivityAt || 0).getTime(),
  );

  let transitionSnapshot = {
    latestByLead: new Map(),
    matchedLeadSet: new Set(),
  };
  if (shouldAttachTransitionData(req.query)) {
    transitionSnapshot = await buildLeadTransitionSnapshot({
      req,
      leadIds: grouped.map((r) => r.leadId),
    });
    if (req.query.transitionState) {
      grouped = grouped.filter((row) =>
        transitionSnapshot.matchedLeadSet.has(String(row.leadId)),
      );
      totals.leadCount = grouped.length;
      totals.followUpCount = 0;
      totals.pendingCount = 0;
      totals.completedCount = 0;
      totals.overdueCount = 0;
      for (const row of grouped) {
        totals.followUpCount += row.followUpCount;
        totals.pendingCount += row.pendingCount;
        totals.completedCount += row.completedCount;
        totals.overdueCount += row.overdueCount;
      }
    }
  }

  const pageRows = grouped.slice(skip, skip + limit);
  const leadMap = await getLeadMap(pageRows.map((r) => r.leadId));

  const leads = pageRows.map((row) => ({
    lead: leadMap.get(String(row.leadId)) || { _id: row.leadId },
    followUpCount: row.followUpCount,
    pendingCount: row.pendingCount,
    completedCount: row.completedCount,
    overdueCount: row.overdueCount,
    lastFollowUpAt: row.lastActivityAt,
    lastActivityAt: row.lastActivityAt,
    lastFollowUpStatus: row.lastFollowUpStatus,
    ...(shouldAttachTransitionData(req.query)
      ? {
          transition:
            transitionSnapshot.latestByLead.get(String(row.leadId)) || null,
        }
      : {}),
  }));

  return success(res, {
    kind,
    view,
    filters: {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
      status: req.query.status || null,
      modeOfContact: req.query.modeOfContact || null,
      transitionState: req.query.transitionState || null,
    },
    totals,
    leads,
    pagination: { page, limit, totalLeads: grouped.length },
  });
});

exports.getTemperatureTransitionSummary = asyncHandler(async (req, res) => {
  const match = {};
  const dateFilter = buildDateFilter(req.query, "changedAt");
  if (dateFilter.changedAt) match.changedAt = dateFilter.changedAt;

  if (req.user.role === "sales") {
    const ownedLeadIds = await Lead.find({
      assignedSales: req.user._id,
    }).distinct("_id");
    match.leadId = { $in: ownedLeadIds };
  }

  const rows = await LeadTemperatureTransition.find(match)
    .select("leadId fromTemperature toTemperature source")
    .lean();

  const transitions = {
    hot_to_warm: 0,
    hot_to_cold: 0,
    warm_to_hot: 0,
    warm_to_cold: 0,
    cold_to_hot: 0,
    cold_to_warm: 0,
  };
  const bySource = {
    manual_override: 0,
    ai_scoring: 0,
    system: 0,
  };
  const touched = new Set();

  for (const row of rows) {
    touched.add(String(row.leadId));
    const key = `${row.fromTemperature}_to_${row.toTemperature}`;
    if (transitions[key] !== undefined) transitions[key] += 1;
    if (bySource[row.source] !== undefined) bySource[row.source] += 1;
  }

  return success(res, {
    filters: {
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
    },
    transitions,
    totals: {
      totalTransitions: rows.length,
      leadTouchedCount: touched.size,
    },
    bySource,
  });
});

exports.getTemperatureTransitions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const match = {};
  const dateFilter = buildDateFilter(req.query, "changedAt");
  if (dateFilter.changedAt) match.changedAt = dateFilter.changedAt;

  const from = req.query.from;
  const to = req.query.to;
  const source = req.query.source;
  if (from) match.fromTemperature = from;
  if (to) match.toTemperature = to;
  if (source) match.source = source;

  if (req.user.role === "sales") {
    const ownedLeadIds = await Lead.find({
      assignedSales: req.user._id,
    }).distinct("_id");
    match.leadId = { $in: ownedLeadIds };
  }

  const [rows, total] = await Promise.all([
    LeadTemperatureTransition.find(match)
      .sort({ changedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LeadTemperatureTransition.countDocuments(match),
  ]);

  const leadMap = await getLeadMap(rows.map((r) => r.leadId));
  const dataRows = rows.map((row) => ({
    ...row,
    lead: leadMap.get(String(row.leadId)) || { _id: row.leadId },
  }));

  return success(res, {
    rows: dataRows,
    pagination: { page, limit, total },
  });
});

module.exports = {
  getFollowUpActivity: exports.getFollowUpActivity,
  getTemperatureTransitionSummary: exports.getTemperatureTransitionSummary,
  getTemperatureTransitions: exports.getTemperatureTransitions,
  VALID_KINDS,
  VALID_VIEWS,
  VALID_STATUS,
  VALID_MODES,
  VALID_TEMPERATURES,
  VALID_TRANSITION_SOURCES,
  VALID_TRANSITION_STATES,
};
