const Lead = require('../models/Lead')

const generateJobId = async () => {
  const last = await Lead.findOne({ jobId: { $exists: true, $ne: null } }, { jobId: 1 })
    .sort({ createdAt: -1 })
    .lean()

  if (!last || !last.jobId) return 'PRO-001'

  const num = parseInt(last.jobId.split('-')[1], 10)
  return `PRO-${String(num + 1).padStart(3, '0')}`
}

module.exports = generateJobId
