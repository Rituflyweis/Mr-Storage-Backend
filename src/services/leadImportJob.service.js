const LeadImportJob = require('../models/LeadImportJob')
const { importLeadRecords } = require('./leadExcelImport.service')

const STALE_PROCESSING_MS = 2 * 60 * 60 * 1000

const formatJobPayload = (job, { salesResponseShape = false } = {}) => {
  const base = {
    async: true,
    jobId: job._id,
    status: job.status,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    skipped: job.skipped,
    errors: job.errors,
    headerRowIndex: job.headerRowIndex,
    sheetName: job.sheetName,
    sourceFileName: job.sourceFileName,
    processingStartedAt: job.processingStartedAt,
    processingEndedAt: job.processingEndedAt,
    errorMessage: job.errorMessage || null,
    progressPct: job.totalRows
      ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 1000) / 10)
      : 0,
  }
  if (salesResponseShape) {
    return { ...base, imported: job.created }
  }
  return { ...base, created: job.created }
}

const markStaleJobsFailed = async () => {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS)
  await LeadImportJob.updateMany(
    { status: 'processing', processingStartedAt: { $lt: cutoff } },
    {
      status: 'failed',
      errorMessage: 'Import timed out or server restarted during processing',
      processingEndedAt: new Date(),
    }
  )
}

const processJob = async (jobId, records, ctx) => {
  const job = await LeadImportJob.findById(jobId)
  if (!job || job.status !== 'queued') return

  job.status = 'processing'
  job.processingStartedAt = new Date()
  job.totalRows = records.length
  await job.save()

  let lastPersist = Date.now()

  try {
    const results = await importLeadRecords(records, ctx, {
      concurrency: 6,
      maxErrors: 150,
      onProgress: async ({ processedRows, created, skipped, errors }) => {
        if (Date.now() - lastPersist < 2000 && processedRows < records.length) return
        lastPersist = Date.now()
        await LeadImportJob.findByIdAndUpdate(jobId, {
          processedRows,
          created,
          skipped,
          errors,
        })
      },
    })

    await LeadImportJob.findByIdAndUpdate(jobId, {
      status: 'completed',
      processedRows: results.totalRows,
      created: results.created,
      skipped: results.skipped,
      errors: results.errors,
      processingEndedAt: new Date(),
    })
  } catch (err) {
    await LeadImportJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      errorMessage: err.message || 'Import failed',
      processingEndedAt: new Date(),
    })
  }
}

/**
 * Queue background import (returns immediately).
 * @param {object} meta - { panel, fileName?, headerRowIndex?, sheetName? }
 */
const startLeadImportJob = async (records, ctx, meta = {}) => {
  await markStaleJobsFailed()

  const active = await LeadImportJob.findOne({
    initiatedBy: ctx.createdByUserId,
    status: { $in: ['queued', 'processing'] },
  }).select('_id status totalRows')

  if (active) {
    const err = new Error(
      'An import is already running for your account. Poll its status or wait until it completes.'
    )
    err.code = 'LEAD_IMPORT_IN_PROGRESS'
    err.jobId = active._id
    err.activeJob = await LeadImportJob.findById(active._id).lean()
    throw err
  }

  const job = await LeadImportJob.create({
    initiatedBy: ctx.createdByUserId,
    panel: meta.panel || 'admin',
    status: 'queued',
    totalRows: records.length,
    sourceFileName: meta.fileName || '',
    sheetName: meta.sheetName || '',
    headerRowIndex: meta.headerRowIndex ?? null,
  })

  setImmediate(() => {
    processJob(job._id, records, ctx).catch((err) => {
      console.error('[LeadImportJob]', job._id.toString(), err.message)
    })
  })

  return job
}

const getLeadImportJob = async (jobId, userId) => {
  const job = await LeadImportJob.findById(jobId).lean()
  if (!job) return null
  if (String(job.initiatedBy) !== String(userId)) return null
  return job
}

module.exports = {
  SYNC_ROW_LIMIT: 50,
  startLeadImportJob,
  getLeadImportJob,
  formatJobPayload,
  markStaleJobsFailed,
}
