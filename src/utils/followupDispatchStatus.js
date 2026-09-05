const FollowUpDispatchLog = require("../models/FollowUpDispatchLog");

const cloneChannelState = (enabled) => ({
  enabled: Boolean(enabled),
  status: enabled ? "pending" : "disabled",
  sentAt: null,
  error: "",
});

const buildInitialStatus = (followUp = {}) => {
  const notifyCustomer = followUp.notifyCustomer !== false;
  const customerSmsEnabled = notifyCustomer && followUp.sendSms !== false;
  const customerEmailEnabled = notifyCustomer && followUp.sendEmail !== false;
  const staffEnabled = followUp.source === "manual" && Boolean(followUp.assignedTo);

  return {
    customer: {
      sms: cloneChannelState(customerSmsEnabled),
      email: cloneChannelState(customerEmailEnabled),
    },
    salesEmployee: {
      sms: cloneChannelState(staffEnabled),
      email: cloneChannelState(staffEnabled),
    },
  };
};

const toId = (value) => (value ? String(value) : "");

const applyLog = (target, log) => {
  if (!target || !["sms", "email"].includes(log.channel)) return;
  if (!target[log.channel].sentAt) {
    target[log.channel].status = log.status || "pending";
    target[log.channel].sentAt = log.sentAt || null;
    target[log.channel].error = log.error || "";
  }
};

const getFollowUpDeliveryStatusMap = async (followUps = []) => {
  if (!followUps.length) return new Map();

  const byFollowUpId = new Map();
  const followUpIds = [];

  for (const row of followUps) {
    const id = toId(row?._id);
    if (!id) continue;
    followUpIds.push(row._id);
    byFollowUpId.set(id, {
      customerId: toId(row.customerId),
      assignedTo: toId(row.assignedTo),
      status: buildInitialStatus(row),
    });
  }

  if (!followUpIds.length) return new Map();

  const logs = await FollowUpDispatchLog.find({ followUpId: { $in: followUpIds } })
    .select("followUpId channel status error sentAt customerId createdAt")
    .sort({ createdAt: -1 })
    .lean();

  for (const log of logs) {
    const key = toId(log.followUpId);
    const state = byFollowUpId.get(key);
    if (!state) continue;

    const logCustomerId = toId(log.customerId);
    if (logCustomerId && logCustomerId === state.customerId) {
      applyLog(state.status.customer, log);
      continue;
    }
    if (logCustomerId && logCustomerId === state.assignedTo) {
      applyLog(state.status.salesEmployee, log);
      continue;
    }
  }

  const out = new Map();
  for (const [id, value] of byFollowUpId.entries()) out.set(id, value.status);
  return out;
};

module.exports = {
  getFollowUpDeliveryStatusMap,
};

