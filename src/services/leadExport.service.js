const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const ExcelJS = require('exceljs')
const { v4: uuidv4 } = require('uuid')
const Lead = require('../models/Lead')
const env = require('../config/env')

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const EXPORT_COLUMNS = [
  { header: 'Lead ID', key: 'leadId', width: 26 },
  { header: 'Job ID', key: 'jobId', width: 14 },
  { header: 'Project Name', key: 'projectName', width: 28 },
  { header: 'Building Type', key: 'buildingType', width: 18 },
  { header: 'Location', key: 'location', width: 22 },
  { header: 'Roof Style', key: 'roofStyle', width: 14 },
  { header: 'Width', key: 'width', width: 10 },
  { header: 'Length', key: 'length', width: 10 },
  { header: 'Height', key: 'height', width: 10 },
  { header: 'Sqft', key: 'sqft', width: 10 },
  { header: 'Doors', key: 'numDoors', width: 8 },
  { header: 'Windows', key: 'numWindows', width: 10 },
  { header: 'Insulation', key: 'numInsulation', width: 12 },
  { header: 'Source', key: 'source', width: 14 },
  { header: 'Quote Value', key: 'quoteValue', width: 14 },
  { header: 'Lifecycle Status', key: 'lifecycleStatus', width: 20 },
  { header: 'Lead Score', key: 'leadScore', width: 12 },
  { header: 'Quote Ready', key: 'isQuoteReady', width: 12 },
  { header: 'Handed To Sales', key: 'isHandedToSales', width: 16 },
  { header: 'Raised To PO', key: 'isRaisedToPO', width: 12 },
  { header: 'PO Status', key: 'poStatus', width: 12 },
  { header: 'Terminated', key: 'isTerminated', width: 12 },
  { header: 'Termination Reason', key: 'terminationReason', width: 24 },
  { header: 'Terminated At', key: 'terminatedAt', width: 22 },
  { header: 'Buildings Count', key: 'numberOfBuildings', width: 16 },
  { header: 'Notes', key: 'notes', width: 32 },
  { header: 'Customer Code', key: 'customerCode', width: 14 },
  { header: 'Customer Name', key: 'customerName', width: 22 },
  { header: 'Customer Email', key: 'customerEmail', width: 28 },
  { header: 'Customer Phone', key: 'customerPhone', width: 18 },
  { header: 'Customer Active', key: 'customerActive', width: 14 },
  { header: 'Assigned Sales', key: 'assignedSalesName', width: 22 },
  { header: 'Assigned Sales Email', key: 'assignedSalesEmail', width: 28 },
  { header: 'Document Count', key: 'documentCount', width: 14 },
  { header: 'Has Contract', key: 'hasContract', width: 12 },
  { header: 'Created At', key: 'createdAt', width: 22 },
  { header: 'Updated At', key: 'updatedAt', width: 22 },
]

const formatDate = (value) => (value ? new Date(value).toISOString() : '')

const mapLeadToRow = (lead) => {
  const customer = lead.customerId && typeof lead.customerId === 'object' ? lead.customerId : null
  const sales = lead.assignedSales && typeof lead.assignedSales === 'object' ? lead.assignedSales : null
  const documents = lead.documents || []

  return {
    leadId: String(lead._id),
    jobId: lead.jobId || '',
    projectName: lead.projectName || '',
    buildingType: lead.buildingType || '',
    location: lead.location || '',
    roofStyle: lead.roofStyle || '',
    width: lead.width ?? '',
    length: lead.length ?? '',
    height: lead.height ?? '',
    sqft: lead.sqft || '',
    numDoors: lead.numDoors ?? '',
    numWindows: lead.numWindows ?? '',
    numInsulation: lead.numInsulation ?? '',
    source: lead.source || '',
    quoteValue: lead.quoteValue ?? 0,
    lifecycleStatus: lead.lifecycleStatus || '',
    leadScore: lead.leadScoring?.score ?? 0,
    isQuoteReady: lead.isQuoteReady ? 'Yes' : 'No',
    isHandedToSales: lead.isHandedToSales ? 'Yes' : 'No',
    isRaisedToPO: lead.isRaisedToPO ? 'Yes' : 'No',
    poStatus: lead.poStatus || '',
    isTerminated: lead.isTerminated ? 'Yes' : 'No',
    terminationReason: lead.terminationReason || '',
    terminatedAt: formatDate(lead.terminatedAt),
    numberOfBuildings: lead.numberOfBuildings ?? 1,
    notes: lead.notes || '',
    customerCode: customer?.customerId || '',
    customerName: customer?.firstName || '',
    customerEmail: customer?.email || '',
    customerPhone: customer?.phone
      ? `${customer.phone.countryCode || ''} ${customer.phone.number || ''}`.trim()
      : '',
    customerActive: customer?.isActive === false ? 'No' : customer ? 'Yes' : '',
    assignedSalesName: sales?.name || '',
    assignedSalesEmail: sales?.email || '',
    documentCount: documents.length,
    hasContract: documents.some((d) => d.type === 'contract') ? 'Yes' : 'No',
    createdAt: formatDate(lead.createdAt),
    updatedAt: formatDate(lead.updatedAt),
  }
}

const buildExcelBuffer = async (leads) => {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Mr Storage Backend'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Leads', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  sheet.columns = EXPORT_COLUMNS
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF7' },
  }

  for (const lead of leads) {
    sheet.addRow(mapLeadToRow(lead))
  }

  return workbook.xlsx.writeBuffer()
}

const uploadExcelToS3 = async (buffer, s3KeyPrefix) => {
  if (!env.AWS_S3_BUCKET || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    const err = new Error('S3 is not configured. Set AWS_S3_BUCKET and credentials.')
    err.statusCode = 503
    throw err
  }

  const key = `${s3KeyPrefix}/leads-${Date.now()}-${uuidv4()}.xlsx`
  const contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  await s3.send(new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    Body: Buffer.from(buffer),
    ContentType: contentType,
  }))

  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`
  return { fileUrl, key }
}

const exportLeadsToExcelAndS3 = async ({ filter, s3KeyPrefix }) => {
  const leads = await Lead.find(filter)
    .populate({ path: 'customerId', select: 'customerId firstName email phone isActive' })
    .populate({ path: 'assignedSales', select: 'name email' })
    .sort({ createdAt: -1 })
    .lean()

  const buffer = await buildExcelBuffer(leads)
  const { fileUrl, key } = await uploadExcelToS3(buffer, s3KeyPrefix)

  return {
    fileUrl,
    key,
    exportedCount: leads.length,
    generatedAt: new Date().toISOString(),
  }
}

module.exports = { exportLeadsToExcelAndS3, buildExcelBuffer, mapLeadToRow }
