const { resolveLeadImportExcelBuffer } = require('./leadImportRequest.util')
const {
  SYNC_ROW_LIMIT,
  startLeadImportJob,
  formatJobPayload,
} = require('../services/leadImportJob.service')

const resolveUploadFileName = (req) =>
  req.file?.originalname ||
  req.files?.file?.[0]?.originalname ||
  req.files?.csv?.[0]?.originalname ||
  req.files?.excel?.[0]?.originalname ||
  ''

const runLeadImport = async (req, ctx, { salesResponseShape = false, panel = 'admin' } = {}) => {
  const leadImport = require('../services/leadExcelImport.service')
  const excelBuffer = resolveLeadImportExcelBuffer(req)
  const fileName = resolveUploadFileName(req)
  const forceSync = req.query.sync === 'true' || req.body?.sync === true
  const forceAsync = req.query.async === 'true' || req.body?.async === true

  if (excelBuffer) {
    const { records, headerRowIndex, sheetName } = await leadImport.parseExcelToRecords(excelBuffer)
    const useAsync = !forceSync && (forceAsync || records.length > SYNC_ROW_LIMIT)

    if (useAsync) {
      try {
        const job = await startLeadImportJob(records, ctx, {
          panel,
          fileName,
          headerRowIndex,
          sheetName,
        })
        return {
          mode: 'async',
          httpStatus: 202,
          payload: formatJobPayload(job, { salesResponseShape }),
          message: `Import started for ${records.length} rows. Poll GET .../import/jobs/${job._id} for progress.`,
        }
      } catch (err) {
        if (err.code === 'LEAD_IMPORT_IN_PROGRESS') {
          return {
            mode: 'async',
            httpStatus: 200,
            payload: {
              ...formatJobPayload(err.activeJob, { salesResponseShape }),
              jobId: err.jobId,
              inProgress: true,
            },
            message: err.message,
          }
        }
        throw err
      }
    }

    const results = await leadImport.importLeadRecords(records, ctx, { concurrency: 4 })
    const merged = { ...results, headerRowIndex, sheetName }
    if (salesResponseShape) {
      return {
        mode: 'sync',
        httpStatus: 200,
        payload: {
          imported: merged.created,
          skipped: merged.skipped,
          errors: merged.errors,
          totalRows: merged.totalRows,
          headerRowIndex,
          sheetName,
        },
        message: `Import complete: ${merged.created} created, ${merged.skipped} skipped (${merged.totalRows} rows)`,
      }
    }
    return {
      mode: 'sync',
      httpStatus: 200,
      payload: merged,
      message: `Import complete: ${merged.created} created, ${merged.skipped} skipped (${merged.totalRows} rows)`,
    }
  }

  const csvText = req.body?.csv
  if (typeof csvText !== 'string' || !csvText.trim()) {
    const err = new Error(
      'Upload an Excel file (multipart field file/csv/excel) or send CSV text in body.csv'
    )
    err.code = 'LEAD_IMPORT_NO_PAYLOAD'
    throw err
  }

  const results = await leadImport.importFromCsvText(csvText, ctx)
  if (salesResponseShape) {
    return {
      mode: 'sync',
      httpStatus: 200,
      payload: {
        imported: results.created,
        skipped: results.skipped,
        errors: results.errors,
        totalRows: results.totalRows,
      },
    }
  }
  return {
    mode: 'sync',
    httpStatus: 200,
    payload: results,
    message: `Import complete: ${results.created} created, ${results.skipped} skipped`,
  }
}

module.exports = { runLeadImport, SYNC_ROW_LIMIT }
