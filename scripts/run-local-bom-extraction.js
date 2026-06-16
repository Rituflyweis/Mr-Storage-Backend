/**
 * Full local BOM flow: seed plant project → S3 upload → API extraction → confirm → consolidate.
 *
 * Usage (server must be running on PORT from .env):
 *   node scripts/run-local-bom-extraction.js
 *   node scripts/run-local-bom-extraction.js bom/_9081_Twin_Creek_Car_Condos_BOM.out
 */

require('dotenv').config()

const fs = require('fs')
const path = require('path')
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
const BOMJob = require('../src/models/BOMJob')
const BOMItem = require('../src/models/BOMItem')
const generateCustomerId = require('../src/utils/generateCustomerId')
const { classifyShipperSheet, SHIPPER_SHEETS } = require('../src/services/plant/consolidator.service')

const BASE = `http://localhost:${env.PORT}`
const PLANT_EMAIL = 'test123@gmail.com'
const PLANT_PASS = 'sales12345'
const BOM_DIR = path.join(__dirname, '../bom')

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
    throw new Error(`${method} ${urlPath} → ${res.status}: ${text.slice(0, 300)}`)
  }
  if (!res.ok || data.success === false) {
    throw new Error(`${method} ${urlPath} → ${res.status}: ${data.message || text.slice(0, 300)}`)
  }
  return data
}

async function uploadFileToS3(filePath) {
  const fileName = path.basename(filePath)
  const key = `boms/${uuidv4()}.out`
  const buffer = fs.readFileSync(filePath)
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
    const hashed = await bcrypt.hash(PLANT_PASS, 12)
    plant = await User.create({
      name: 'test 123',
      email: PLANT_EMAIL,
      password: hashed,
      role: 'plant',
      isActive: true,
    })
    console.log('[seed] Created plant user:', PLANT_EMAIL)
  }

  let admin = await User.findOne({ role: 'admin' })
  if (!admin) {
    const hashed = await bcrypt.hash('Admin@123', 12)
    admin = await User.create({
      name: 'Admin',
      email: 'admin@construction.com',
      password: hashed,
      role: 'admin',
      isActive: true,
    })
    console.log('[seed] Created admin:', admin.email)
  }

  return { plant, admin }
}

async function ensureActiveSmdt(adminId) {
  let version = await SMDTCostVersion.findOne({ isActive: true })
  if (!version) {
    version = await SMDTCostVersion.create({
      name: 'Local test SMDT',
      sourceFileName: 'seed',
      isActive: true,
      uploadedBy: adminId,
      stats: { totalItems: 0, inserted: 0, updated: 0, skippedRows: 0 },
    })
    console.log('[seed] Created active SMDT version:', version._id)
  }
  return version
}

async function seedProject(plant, admin, buildingCount = 5) {
  const tag = `bom-local-${Date.now()}`
  const custId = await generateCustomerId()
  const customer = await Customer.create({
    customerId: custId,
    firstName: 'BOM Test',
    email: `${tag}@test.local`,
    phone: { number: '9999999999', countryCode: '+1' },
    password: await bcrypt.hash('test1234', 12),
    source: 'manual',
  })

  const lead = await Lead.create({
    customerId: customer._id,
    projectName: `BOM extraction test ${tag}`,
    buildingType: 'warehouse',
    location: 'Test City',
    source: 'manual',
    lifecycleStatus: 'released_to_plant',
    numberOfBuildings: buildingCount,
    lifecycleHistory: [
      { stage: 'released_to_plant', changedAt: new Date(), changedBy: admin._id },
    ],
  })

  const invoice = await Invoice.create({
    leadId: lead._id,
    customerId: customer._id,
    createdBy: admin._id,
    invoiceNumber: `INV-${tag}`,
    totalAmount: 100000,
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

  const buildingDocs = []
  for (let i = 1; i <= buildingCount; i++) {
    buildingDocs.push({
      leadId: lead._id,
      customerId: customer._id,
      buildingNumber: i,
      createdBy: admin._id,
      status: 'pending',
    })
  }
  const buildings = await Building.insertMany(buildingDocs)

  console.log('[seed] leadId:', lead._id, '| jobId:', lead.jobId)
  return { lead, buildings }
}

async function priceRemainingItems(jobId) {
  const unpriced = await BOMItem.find({ bomJobId: jobId, isPriced: false })
  for (const item of unpriced) {
    const total = item.bomSourceTotalCost != null ? Number(item.bomSourceTotalCost) : 0.01
    item.isPriced = true
    item.priceSource = item.bomSourceTotalCost != null ? 'bom' : 'manual'
    item.finalTotalCost = total
    item.finalUnitCost =
      item.bomSourceUnitCost != null
        ? item.bomSourceUnitCost
        : total / (Number(item.quantity) || 1)
    if (item.isManuallyPriced !== true && item.priceSource === 'manual') {
      item.isManuallyPriced = true
      item.manualUnitCost = item.finalUnitCost
    }
    await item.save()
  }
  return unpriced.length
}

async function pollJob(token, jobId, maxWaitMs = 180000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const data = await api(token, 'GET', `/api/plant/bom/${jobId}`)
    const job = data.data?.bomJob
    if (job?.status === 'completed') return job
    if (job?.status === 'failed') {
      throw new Error(`BOM job failed: ${job.errorMessage || 'unknown'}`)
    }
    await sleep(2000)
  }
  throw new Error(`BOM job ${jobId} timed out`)
}

async function main() {
  const singleBomArg = process.argv[2]
  let bomFiles
  if (singleBomArg) {
    const bomPath = path.resolve(singleBomArg)
    if (!fs.existsSync(bomPath)) throw new Error(`BOM file not found: ${bomPath}`)
    bomFiles = [path.basename(bomPath)]
    const singleBomDir = path.dirname(bomPath)
    // use parent bom dir variable override for upload path
    global.__SINGLE_BOM_PATH__ = bomPath
    global.__SINGLE_BOM_DIR__ = singleBomDir
  } else {
    bomFiles = fs.readdirSync(BOM_DIR).filter((f) => f.endsWith('.out')).sort()
  }
  if (!bomFiles.length) {
    throw new Error(`No .out files in ${BOM_DIR}`)
  }

  const bomDir = global.__SINGLE_BOM_DIR__ || BOM_DIR

  await mongoose.connect(env.MONGO_URI)
  console.log('[db] connected')

  const { plant, admin } = await ensurePlantUser()
  await ensureActiveSmdt(admin._id)
  const { lead, buildings } = await seedProject(plant, admin, bomFiles.length)

  if (buildings.length < bomFiles.length) {
    throw new Error('Not enough buildings for BOM files')
  }

  console.log('[s3] uploading', bomFiles.length, 'files...')
  const uploads = []
  for (let i = 0; i < bomFiles.length; i++) {
    const filePath = global.__SINGLE_BOM_PATH__ && i === 0
      ? global.__SINGLE_BOM_PATH__
      : path.join(bomDir, bomFiles[i])
    const up = await uploadFileToS3(filePath)
    uploads.push({ ...up, buildingId: String(buildings[i]._id) })
    console.log('[s3]', bomFiles[i], '→', up.fileUrl)
  }

  const login = await api(null, 'POST', '/api/auth/login', {
    email: PLANT_EMAIL,
    password: PLANT_PASS,
  })
  const token = login.data.accessToken

  const bomPayload = {
    bomFiles: uploads.map((u) => ({
      buildingId: u.buildingId,
      fileUrl: u.fileUrl,
      fileName: u.fileName,
      fileFormat: 'out',
    })),
  }

  const uploadRes = await api(token, 'POST', `/api/plant/projects/${lead._id}/bom`, bomPayload)
  const jobs = uploadRes.data.jobs || []
  console.log('[api] extraction started for', jobs.length, 'jobs')

  const jobResults = []
  for (const j of jobs) {
    const job = await pollJob(token, j.bomJobId)
    const priced = await priceRemainingItems(j.bomJobId)
    if (priced) console.log(`[price] auto-filled ${priced} unpriced items for job ${j.bomJobId}`)

    await api(token, 'POST', `/api/plant/bom/buildings/${j.buildingId}/confirm`)
    jobResults.push({
      buildingId: j.buildingId,
      buildingNumber: j.buildingNumber,
      bomJobId: j.bomJobId,
      fileName: j.fileName,
      totalItems: job.totalItems,
      matchedItems: job.matchedItems,
      unmatchedItems: job.unmatchedItems,
      extractionMethod: job.extractionMethod,
    })
    console.log(`[done] building ${j.buildingNumber}: ${job.totalItems} items`)
  }

  const consolidated = await api(
    token,
    'POST',
    `/api/plant/projects/${lead._id}/consolidated-bom/generate`
  )

  const consolidatedGet = await api(
    token,
    'GET',
    `/api/plant/projects/${lead._id}/consolidated-bom`
  )

  const consolidatedItems = consolidatedGet.data?.consolidatedBOM?.items || []
  const categoryBreakdown = {}
  for (const sheet of SHIPPER_SHEETS) {
    categoryBreakdown[sheet.id] = 0
  }
  for (const item of consolidatedItems) {
    const cat = item.category || 'UNKNOWN'
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1
  }

  const extractedCategorySample = {}
  for (const j of jobResults) {
    const items = await BOMItem.find({ bomJobId: j.bomJobId })
      .select('description partCode category')
      .lean()
    for (const item of items.slice(0, 5)) {
      const classified = classifyShipperSheet(item)
      if (!extractedCategorySample[classified]) extractedCategorySample[classified] = []
      if (extractedCategorySample[classified].length < 3) {
        extractedCategorySample[classified].push({
          partCode: item.partCode,
          description: item.description,
          rawCategory: item.category,
        })
      }
    }
  }

  const outPath = path.join(__dirname, '../bom-consolidator-retest-output.json')
  const summary = {
    leadId: String(lead._id),
    projectName: lead.projectName,
    jobId: lead.jobId,
    plantUser: PLANT_EMAIL,
    buildings: buildings.map((b) => ({ buildingId: String(b._id), buildingNumber: b.buildingNumber })),
    jobs: jobResults,
    consolidated: {
      totalCost: consolidatedGet.data?.consolidatedBOM?.totalCost,
      totalWeight: consolidatedGet.data?.consolidatedBOM?.totalWeight,
      groupCount: consolidatedItems.length,
      fileUrl: consolidatedGet.data?.consolidatedBOM?.fileUrl,
      categoryBreakdown,
      sampleGroups: consolidatedItems.slice(0, 15),
    },
    extractionClassificationSample: extractedCategorySample,
    generateResponse: consolidated.data,
  }

  // Full extracted items per job from DB
  const extracted = []
  for (const j of jobResults) {
    const items = await BOMItem.find({ bomJobId: j.bomJobId })
      .select('markId description partCode quantity lengthFeet weight finalTotalCost category matchStatus isPriced')
      .lean()
    extracted.push({ bomJobId: j.bomJobId, buildingNumber: j.buildingNumber, fileName: j.fileName, items })
  }

  fs.writeFileSync(outPath, JSON.stringify({ ...summary, extractedByJob: extracted }, null, 2))
  console.log('\n=== SUCCESS ===')
  console.log('leadId:', lead._id)
  console.log('Output:', outPath)
  console.log('Consolidated groups:', summary.consolidated.groupCount)
  console.log('Category breakdown:', JSON.stringify(categoryBreakdown))
  console.log('Total cost:', summary.consolidated.totalCost)

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
