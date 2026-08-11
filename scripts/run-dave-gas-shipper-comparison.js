/**
 * Single-building BOM upload → consolidate → vendor PDF quote → shipper comparison.
 *
 * Prerequisites: npm start on localhost, .env with Mongo + AWS.
 *   node scripts/run-dave-gas-shipper-comparison.js
 *   node scripts/run-dave-gas-shipper-comparison.js bom/_9081_Twin_Creek_Car_Condos_BOM.out bom/Twin_Creek_Test_Vendor_Quote_From_BOM.pdf twin-creek
 */

require('dotenv').config()

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { v4: uuidv4 } = require('uuid')

const env = require('../src/config/env')
const User = require('../src/models/User')
const Customer = require('../src/models/Customer')
const Lead = require('../src/models/Lead')
const Building = require('../src/models/Building')
const POOrder = require('../src/models/POOrder')
const Invoice = require('../src/models/Invoice')
const SMDTCostVersion = require('../src/models/SMDTCostVersion')
const Vendor = require('../src/models/Vendor')
const ShipperRequest = require('../src/models/ShipperRequest')
const ConsolidatedBOM = require('../src/models/ConsolidatedBOM')
const BOMJob = require('../src/models/BOMJob')
const BOMItem = require('../src/models/BOMItem')
const ShipperComparisonJob = require('../src/models/ShipperComparisonJob')
const QuoteComparisonResult = require('../src/models/QuoteComparisonResult')
const generateCustomerId = require('../src/utils/generateCustomerId')
const { getLatestBomJobsByBuilding } = require('../src/utils/plantBomAccess')
const {
  loadBomItemsForJobs,
  groupItemsForConsolidation,
  generateConsolidatedExcel,
  uploadConsolidatedExcelToS3,
} = require('../src/services/plant/consolidator.service')

const BASE = `http://localhost:${env.PORT}`
const PLANT_EMAIL = 'test123@gmail.com'
const PLANT_PASS = 'sales12345'
const BOM_FILE = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '../bom/Dave_s_Gas_Stations_BOM.out')
const VENDOR_PDF = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, '../bom/Dave_Gas_Stations_Test_Vendor_Quote_From_BOM.pdf')
const RUN_SLUG = process.argv[4] || 'dave-gas'

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(token, method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`${method} ${urlPath} → ${res.status}: ${text.slice(0, 400)}`)
  }
  if (!res.ok || data.success === false) {
    throw new Error(`${method} ${urlPath} → ${res.status}: ${data.message || text.slice(0, 400)}`)
  }
  return data
}

async function uploadToS3(localPath, folder) {
  const fileName = path.basename(localPath)
  const ext = fileName.split('.').pop()
  const key = `${folder}/${uuidv4()}.${ext}`
  const contentType = ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'
  await s3.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: fs.readFileSync(localPath),
      ContentType: contentType,
    })
  )
  const fileUrl = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`
  return { fileName, fileUrl }
}

async function ensurePlantUser() {
  let plant = await User.findOne({ email: PLANT_EMAIL })
  if (!plant) {
    plant = await User.create({
      name: 'test 123',
      email: PLANT_EMAIL,
      password: await bcrypt.hash(PLANT_PASS, 12),
      role: 'plant',
      isActive: true,
    })
  }
  let admin = await User.findOne({ role: 'admin' })
  if (!admin) {
    admin = await User.create({
      name: 'Admin',
      email: 'admin@construction.com',
      password: await bcrypt.hash('Admin@123', 12),
      role: 'admin',
      isActive: true,
    })
  }
  return { plant, admin }
}

async function ensureActiveSmdt(adminId) {
  let version = await SMDTCostVersion.findOne({ isActive: true })
  if (!version) {
    version = await SMDTCostVersion.create({
      name: 'Local test SMDT',
      isActive: true,
      uploadedBy: adminId,
      stats: { totalItems: 0 },
    })
  }
  return version
}

async function seedSingleBuildingProject(plant, admin, label) {
  const tag = `${label}-${Date.now()}`
  const customer = await Customer.create({
    customerId: await generateCustomerId(),
    firstName: `${label} Test`,
    email: `${tag}@test.local`,
    phone: { number: '8888888888', countryCode: '+1' },
    password: await bcrypt.hash('test1234', 12),
    source: 'manual',
  })

  const lead = await Lead.create({
    customerId: customer._id,
    projectName: `${label} ${tag}`,
    buildingType: 'commercial',
    location: label,
    source: 'manual',
    lifecycleStatus: 'released_to_plant',
    numberOfBuildings: 1,
    lifecycleHistory: [
      { stage: 'released_to_plant', changedAt: new Date(), changedBy: admin._id },
    ],
  })

  const invoice = await Invoice.create({
    leadId: lead._id,
    customerId: customer._id,
    createdBy: admin._id,
    invoiceNumber: `INV-${tag}`,
    totalAmount: 50000,
    status: 'sent',
  })

  await POOrder.create({
    leadId: lead._id,
    customerId: customer._id,
    raisedBy: admin._id,
    assignedTo: plant._id,
    invoiceId: invoice._id,
    poNumber: `PO-${tag}`,
    status: 'approved',
  })

  const building = await Building.create({
    leadId: lead._id,
    customerId: customer._id,
    buildingNumber: 1,
    createdBy: admin._id,
    status: 'pending',
  })

  return { lead, building }
}

async function priceRemainingItems(jobId) {
  const unpriced = await BOMItem.find({ bomJobId: jobId, isPriced: false })
  for (const item of unpriced) {
    const total = item.bomSourceTotalCost != null ? Number(item.bomSourceTotalCost) : 0.01
    item.isPriced = true
    item.priceSource = item.bomSourceTotalCost != null ? 'bom' : 'manual'
    item.finalTotalCost = total
    item.finalUnitCost =
      item.bomSourceUnitCost != null ? item.bomSourceUnitCost : total / (Number(item.quantity) || 1)
    if (item.priceSource === 'manual') {
      item.isManuallyPriced = true
      item.manualUnitCost = item.finalUnitCost
    }
    await item.save()
  }
  return unpriced.length
}

async function pollBomJob(token, jobId) {
  for (let i = 0; i < 90; i++) {
    const data = await api(token, 'GET', `/api/plant/bom/${jobId}`)
    const job = data.data?.bomJob
    if (job?.status === 'completed') return job
    if (job?.status === 'failed') throw new Error(job.errorMessage || 'BOM job failed')
    await sleep(2000)
  }
  throw new Error('BOM job timeout')
}

async function pollCompareJob(token, jobId) {
  for (let i = 0; i < 120; i++) {
    const data = await api(token, 'GET', `/api/plant/shipper-requests/compare-jobs/${jobId}/status`)
    const job = data.data
    if (job?.status === 'completed') return job
    if (job?.status === 'failed') throw new Error(job.errorMessage || 'Comparison failed')
    await sleep(3000)
  }
  throw new Error('Comparison job timeout')
}

async function consolidateLead(lead, plant) {
  const buildings = await Building.find({ leadId: lead._id }).sort({ buildingNumber: 1 }).lean()
  const bomJobMap = await getLatestBomJobsByBuilding(lead._id)
  const bomJobIds = buildings.map((b) => bomJobMap.get(String(b._id))?._id).filter(Boolean)
  const allItems = await loadBomItemsForJobs(bomJobIds)
  const buildingMap = Object.fromEntries(buildings.map((b) => [String(b._id), b.buildingNumber]))
  const groupedItems = groupItemsForConsolidation(allItems, buildingMap)
  const totalCost = groupedItems.reduce((s, g) => s + (g.totalCost || 0), 0)
  const totalWeight = groupedItems.reduce((s, g) => s + (g.totalWeight || 0), 0)
  const { buffer } = await generateConsolidatedExcel(lead, buildings, allItems)
  const { fileUrl } = await uploadConsolidatedExcelToS3(buffer, lead._id)

  const consolidatedBOM = await ConsolidatedBOM.findOneAndReplace(
    { leadId: lead._id },
    {
      leadId: lead._id,
      createdBy: plant._id,
      status: 'draft',
      fileUrl,
      totalCost,
      totalWeight,
      totalPanelsArea: 0,
      items: groupedItems,
      sentToVendors: [],
    },
    { upsert: true, new: true }
  )

  return { consolidatedBOM, allItems, groupedItems, totalCost, totalWeight }
}

async function main() {
  if (!fs.existsSync(BOM_FILE)) throw new Error(`Missing ${BOM_FILE}`)
  if (!fs.existsSync(VENDOR_PDF)) throw new Error(`Missing ${VENDOR_PDF}`)

  await mongoose.connect(env.MONGO_URI)
  const { plant, admin } = await ensurePlantUser()
  await ensureActiveSmdt(admin._id)
  const { lead, building } = await seedSingleBuildingProject(plant, admin, RUN_SLUG)
  console.log('[seed] leadId:', lead._id, 'buildingId:', building._id, 'jobId:', lead.jobId)

  const bomUp = await uploadToS3(BOM_FILE, 'boms')
  console.log('[s3] BOM →', bomUp.fileUrl)

  const login = await api(null, 'POST', '/api/auth/login', {
    email: PLANT_EMAIL,
    password: PLANT_PASS,
  })
  const token = login.data.accessToken

  const uploadRes = await api(token, 'POST', `/api/plant/projects/${lead._id}/bom`, {
    bomFiles: [
      {
        buildingId: String(building._id),
        fileUrl: bomUp.fileUrl,
        fileName: bomUp.fileName,
        fileFormat: 'out',
      },
    ],
  })

  const jobMeta = uploadRes.data.jobs[0]
  const bomJob = await pollBomJob(token, jobMeta.bomJobId)
  const priced = await priceRemainingItems(jobMeta.bomJobId)
  if (priced) console.log(`[price] filled ${priced} unpriced lines`)

  await api(token, 'POST', `/api/plant/bom/buildings/${building._id}/confirm`)
  console.log('[bom] confirmed, items:', bomJob.totalItems)

  const { consolidatedBOM, allItems, groupedItems, totalCost, totalWeight } =
    await consolidateLead(lead, plant)
  console.log('[consolidated]', groupedItems.length, 'groups | cost:', totalCost.toFixed(2))

  const tag = String(Date.now())
  let vendor = await Vendor.findOne({ email: `dave-vendor-${tag}@test.local` })
  if (!vendor) {
    vendor = await Vendor.create({
      vendorCode: `DV-${tag}`,
      vendorName: `${RUN_SLUG} Test Vendor`,
      email: `dave-vendor-${tag}@test.local`,
      status: 'active',
    })
  }

  const pdfUp = await uploadToS3(VENDOR_PDF, 'vendor-uploads')
  console.log('[s3] vendor PDF →', pdfUp.fileUrl)

  const shipperRequest = await ShipperRequest.create({
    leadId: lead._id,
    consolidatedBOMId: consolidatedBOM._id,
    vendorId: vendor._id,
    token: crypto.randomBytes(32).toString('hex'),
    ourFileUrl: consolidatedBOM.fileUrl,
    sentAt: new Date(),
    status: 'submitted',
    submittedFileUrl: pdfUp.fileUrl,
    submittedFileName: pdfUp.fileName,
    submittedAt: new Date(),
    quoteValue: totalCost,
  })
  console.log('[shipper] requestId:', shipperRequest._id)

  const compareRes = await api(
    token,
    'POST',
    `/api/plant/shipper-requests/${shipperRequest._id}/compare`
  )
  const compareJobId = compareRes.data.compareJobId
  console.log('[compare] job queued:', compareJobId)

  const compareJob = await pollCompareJob(token, compareJobId)
  console.log('[compare] completed')

  const summary = await api(
    token,
    'GET',
    `/api/plant/shipper-requests/${shipperRequest._id}/comparison-summary`
  )
  const results = await api(
    token,
    'GET',
    `/api/plant/shipper-requests/${shipperRequest._id}/comparison-results?limit=50`
  )

  const extractedItems = await BOMItem.find({ bomJobId: jobMeta.bomJobId })
    .select('markId description partCode quantity lengthFeet weight finalTotalCost category matchStatus')
    .lean()

  const out = {
    meta: {
      leadId: String(lead._id),
      jobId: lead.jobId,
      projectName: lead.projectName,
      buildingId: String(building._id),
      bomJobId: String(jobMeta.bomJobId),
      consolidatedBOMId: String(consolidatedBOM._id),
      shipperRequestId: String(shipperRequest._id),
      compareJobId: String(compareJobId),
      vendorId: String(vendor._id),
      bomFile: path.basename(BOM_FILE),
      vendorPdf: path.basename(VENDOR_PDF),
      bomS3Url: bomUp.fileUrl,
      vendorPdfS3Url: pdfUp.fileUrl,
      consolidatedFileUrl: consolidatedBOM.fileUrl,
      extractedLineCount: allItems.length,
      consolidatedGroupCount: groupedItems.length,
      consolidatedTotalCost: totalCost,
      consolidatedTotalWeight: totalWeight,
    },
    comparisonSummary: summary.data,
    comparisonJobSummary: compareJob.summary,
    comparisonResultsSample: results.data?.results?.slice(0, 25) || results.data,
    comparisonResultTotal: results.data?.total,
    extractedItemsSample: extractedItems.slice(0, 20),
  }

  const outPath = path.join(__dirname, `../${RUN_SLUG}-shipper-comparison-output.json`)
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))

  console.log('\n=== DONE ===')
  console.log('leadId:', lead._id)
  console.log('buildingId:', building._id)
  console.log('shipperRequestId:', shipperRequest._id)
  console.log('Output:', outPath)
  console.log('Summary:', JSON.stringify(compareJob.summary || summary.data, null, 2))

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error('[error]', err.message)
  try {
    await mongoose.disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
