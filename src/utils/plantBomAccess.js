const BOMJob = require('../models/BOMJob')
const { assertPlantProjectAccess } = require('./plantProjectAccess')

const getLatestBomJobsByBuilding = async (leadId) => {
  const jobs = await BOMJob.find({ leadId }).sort({ createdAt: -1 }).lean()
  const map = new Map()
  for (const job of jobs) {
    const key = String(job.buildingId)
    if (!map.has(key)) map.set(key, job)
  }
  return map
}

const formatBomJobSummary = (job) => {
  if (!job) return null
  return {
    bomJobId: job._id,
    status: job.status,
    fileName: job.fileName || '',
    fileUrl: job.fileUrl || '',
    fileFormat: job.fileFormat,
    totalItems: job.totalItems ?? 0,
    matchedItems: job.matchedItems ?? 0,
    unmatchedItems: job.unmatchedItems ?? 0,
    frameItems: job.frameItems ?? 0,
    isConfirmed: job.isConfirmed === true,
    extractionMethod: job.extractionMethod || 'exceljs',
    skippedSheets: job.skippedSheets || [],
    errorMessage: job.errorMessage || null,
    uploadedAt: job.createdAt,
  }
}

const assertBomJobAccess = async (jobId, req) => {
  const job = await BOMJob.findById(jobId).lean()
  if (!job) return { error: 'BOM job not found', code: 404 }

  const access = await assertPlantProjectAccess(job.leadId, req)
  if (access.error) return access

  return { job, ...access }
}

module.exports = {
  getLatestBomJobsByBuilding,
  formatBomJobSummary,
  assertBomJobAccess,
}
