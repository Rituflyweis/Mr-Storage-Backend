/**
 * Two-building test pack — merge both .out BOMs into building 1, consolidate, compare shipper PDF.
 *
 *   node scripts/run-two-building-test-pack-comparison.js
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
const BOMItem = require('../src/models/BOMItem')
const generateCustomerId = require('../src/utils/generateCustomerId')
const { getLatestBomJobsByBuilding } = require('../src/utils/plantBomAccess')
const { parseOutFile } = require('../src/services/plant/outparser.service')
const {
  loadBomItemsForJobs,
  groupItemsForConsolidation,
  generateConsolidatedExcel,
  uploadConsolidatedExcelToS3,
} = require('../src/services/plant/consolidator.service')

const PACK_DIR = path.join(__dirname, '../two_building_bom_and_shipper_quote_test_pack')
const BOM_1 = path.join(PACK_DIR, 'Two_Building_Test_Project_Building_1_BOM.out')
const BOM_2 = path.join(PACK_DIR, 'Two_Building_Test_Project_Building_2_BOM.out')
const VENDOR_PDF = path.join(PACK_DIR, 'Two_Building_Test_Central_States_Row_Preserved_Shipper_Quote.pdf')
const PACK_SUMMARY = path.join(PACK_DIR, 'Two_Building_Test_Pack_Summary.json')
const MERGED_BOM = path.join(PACK_DIR, 'Two_Building_Test_Merged_Building_1_BOM.out')
const OUT_JSON = path.join(__dirname, '../two-building-test-pack-shipper-comparison-output.json')

const BASE = `http://localhost:${env.PORT}`
const PLANT_EMAIL = 'test123@gmail.com'
const PLANT_PASS = 'sales12345'
const RUN_SLUG = 'two-building-test-pack'

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const stripSummaryReports = (text) => {
  const idx = text.indexOf('Summary Reports')
  return (idx >= 0 ? text.slice(0, idx) : text).trimEnd()
}

const parseSummaryTotals = (text) => {
  const weightMatch = text.match(/Total Weight:\s*([\d,]+\.?\d*)/i)
  const costMatch = text.match(/Total Cost:\s*([\d,]+\.?\d*)/i)
  return {
    weight: weightMatch ? Number(weightMatch[1].replace(/,/g, '')) : 0,
    cost: costMatch ? Number(costMatch[1].replace(/,/g, '')) : 0,
  }
}

/** Concatenate both .out files as one building-1 BOM (all B1 + B2 marks in one upload). */
const mergeOutFilesAsBuildingOne = (filePaths) => {
  const bodies = filePaths.map((fp) => stripSummaryReports(fs.readFileSync(fp, 'utf-8')))
  const perFileTotals = filePaths.map((fp) => parseSummaryTotals(fs.readFileSync(fp, 'utf-8')))

  const combinedWeight = perFileTotals.reduce((s, row) => s + row.weight, 0)
  const combinedCost = perFileTotals.reduce((s, row) => s + row.cost, 0)

  const merged = [
    ...bodies,
    '',
    'Summary Reports',
    `Building 1 Combined Total Weight: ${combinedWeight.toFixed(1)}`,
    `Building 1 Combined Total Cost: ${combinedCost.toFixed(2)}`,
    '',
  ].join('\n')

  return {
    mergedText: merged,
    perFileTotals,
    combinedWeight,
    combinedCost,
  }
}

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

async function uploadBufferToS3(buffer, fileName, folder) {
  const ext = fileName.split('.').pop()
  const key = `${folder}/${uuidv4()}.${ext}`
  await s3.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'application/octet-stream',
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

async function seedProject(plant, admin) {
  const tag = `${RUN_SLUG}-${Date.now()}`
  const customer = await Customer.create({
    customerId: await generateCustomerId(),
    firstName: 'Two Building',
    lastName: 'Test',
    email: `${tag}@test.local`,
    phone: { number: '8888888888', countryCode: '+1' },
    password: await bcrypt.hash('test1234', 12),
    source: 'manual',
  })

  const lead = await Lead.create({
    customerId: customer._id,
    projectName: `Two Building Test ${tag}`,
    buildingType: 'commercial',
    location: 'Test Pack',
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
    totalAmount: 61812.83,
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
  for (const fp of [BOM_1, BOM_2, VENDOR_PDF, PACK_SUMMARY]) {
    if (!fs.existsSync(fp)) throw new Error(`Missing ${fp}`)
  }

  const packExpected = JSON.parse(fs.readFileSync(PACK_SUMMARY, 'utf-8'))
  const { mergedText, perFileTotals, combinedWeight, combinedCost } = mergeOutFilesAsBuildingOne([
    BOM_1,
    BOM_2,
  ])
  fs.writeFileSync(MERGED_BOM, mergedText)

  const parsed1 = parseOutFile(fs.readFileSync(BOM_1))
  const parsed2 = parseOutFile(fs.readFileSync(BOM_2))
  const parsedMerged = parseOutFile(Buffer.from(mergedText, 'utf-8'))

  console.log('[merge] per-file items:', parsed1.items.length, parsed2.items.length)
  console.log('[merge] merged items:', parsedMerged.items.length)
  console.log('[merge] merged cost/weight:', combinedCost.toFixed(2), combinedWeight.toFixed(1))
  console.log('[merge] wrote', MERGED_BOM)

  await mongoose.connect(env.MONGO_URI)
  const { plant, admin } = await ensurePlantUser()
  await ensureActiveSmdt(admin._id)
  const { lead, building } = await seedProject(plant, admin)
  console.log('[seed] leadId:', lead._id, 'buildingId:', building._id)

  const bomUp = await uploadBufferToS3(
    Buffer.from(mergedText, 'utf-8'),
    'Two_Building_Test_Merged_Building_1_BOM.out',
    'boms'
  )
  console.log('[s3] merged BOM →', bomUp.fileUrl)

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
  const vendor = await Vendor.create({
    vendorCode: `TB-${tag}`,
    vendorName: 'Two Building Test Vendor',
    email: `two-building-vendor-${tag}@test.local`,
    status: 'active',
  })

  const pdfUp = await uploadToS3(VENDOR_PDF, 'vendor-uploads')
  console.log('[s3] shipper PDF →', pdfUp.fileUrl)

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
    quoteValue: packExpected.totalCost,
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
    `/api/plant/shipper-requests/${shipperRequest._id}/comparison-results?limit=200`
  )

  const exceptions = (results.data?.results || []).filter(
    (row) => row.issueType && row.issueType !== 'matched'
  )

  const out = {
    meta: {
      pack: 'two_building_bom_and_shipper_quote_test_pack',
      mode: 'single_building_merged_out_files',
      leadId: String(lead._id),
      buildingId: String(building._id),
      bomJobId: String(jobMeta.bomJobId),
      consolidatedBOMId: String(consolidatedBOM._id),
      shipperRequestId: String(shipperRequest._id),
      compareJobId: String(compareJobId),
      mergedBomFile: path.basename(MERGED_BOM),
      parsedLineCounts: {
        building1: parsed1.items.length,
        building2: parsed2.items.length,
        merged: parsedMerged.items.length,
      },
      extractedLineCount: allItems.length,
      consolidatedGroupCount: groupedItems.length,
      consolidatedTotalCost: totalCost,
      consolidatedTotalWeight: totalWeight,
      mergeFileTotals: perFileTotals,
      packExpected: {
        combinedItems: packExpected.combinedItems,
        totalCost: packExpected.totalCost,
        totalWeight: packExpected.totalWeight,
      },
    },
    comparisonSummary: summary.data,
    comparisonJobSummary: compareJob.summary,
    exceptionCount: exceptions.length,
    exceptionsSample: exceptions.slice(0, 20),
    comparisonResultsSample: results.data?.results?.slice(0, 25) || [],
    comparisonResultTotal: results.data?.total,
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2))

  console.log('\n=== DONE ===')
  console.log('Output:', OUT_JSON)
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
