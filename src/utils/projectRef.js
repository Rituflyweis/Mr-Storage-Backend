const mongoose = require('mongoose')
const Lead = require('../models/Lead')

const resolveLeadByProjectRef = async (projectRef) => {
  const ref = String(projectRef || '').trim()
  if (!ref) return null

  if (mongoose.Types.ObjectId.isValid(ref)) {
    const byId = await Lead.findById(ref)
    if (byId) return byId
  }

  return Lead.findOne({ jobId: ref })
}

module.exports = {
  resolveLeadByProjectRef,
}
