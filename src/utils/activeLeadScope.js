const { PLANT_LIFECYCLE_STAGES, CLOSED_STAGES } = require("../config/constants");

const INACTIVE_LIFECYCLE_STAGES = [
  ...new Set([...PLANT_LIFECYCLE_STAGES, ...CLOSED_STAGES]),
];

const buildActiveLeadMatch = () => ({
  isDeleted: { $ne: true },
  isTerminated: { $ne: true },
  isRaisedToPO: { $ne: true },
  lifecycleStatus: { $nin: INACTIVE_LIFECYCLE_STAGES },
});

const isLeadActive = (lead = {}) => {
  if (!lead || lead.isDeleted === true || lead.isTerminated === true) return false;
  if (lead.isRaisedToPO === true) return false;
  return !INACTIVE_LIFECYCLE_STAGES.includes(String(lead.lifecycleStatus || ""));
};

module.exports = {
  INACTIVE_LIFECYCLE_STAGES,
  buildActiveLeadMatch,
  isLeadActive,
};
