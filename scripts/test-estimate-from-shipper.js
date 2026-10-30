/**
 * Smoke test: createEstimateFromShipper + computeEstimateById
 * Usage: node scripts/test-estimate-from-shipper.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const Lead = require('../src/models/Lead')
const User = require('../src/models/User')
const EstimateQuote = require('../src/models/EstimateQuote')
const ctrl = require('../src/controllers/sales/estimateQuote.controller')

const callHandler = (handler, req) =>
  new Promise((resolve, reject) => {
    const out = { statusCode: 200, body: null }
    const res = {
      status(code) {
        out.statusCode = code
        return res
      },
      json(payload) {
        out.body = payload
        resolve(out)
        return res
      },
    }
    const next = (err) => {
      if (err) reject(err)
      else if (out.body) resolve(out)
      else reject(new Error('handler finished without response body'))
    }
    try {
      handler(req, res, next)
    } catch (err) {
      reject(err)
    }
  })

const main = async () => {
  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI required')
  await mongoose.connect(uri)

  // Bldg-D has real weight tabs; Paris sample Sheet1 is skipped/empty.
  const shipperPath = path.join(
    __dirname,
    '..',
    'EXCEL EXAMPLES',
    'Bldg-D SHIPPER (2) (1).xlsx',
  )
  if (!fs.existsSync(shipperPath)) {
    throw new Error(`Shipper file missing: ${shipperPath}`)
  }
  const fileBase64 = fs.readFileSync(shipperPath).toString('base64')

  const admin =
    (await User.findOne({ role: 'admin', isActive: { $ne: false } }).lean()) ||
    (await User.findOne({ role: 'admin' }).lean())
  if (!admin) throw new Error('No admin user found')

  const lead = await Lead.findOne({ isDeleted: { $ne: true } })
    .sort({ updatedAt: -1 })
    .lean()
  if (!lead) throw new Error('No lead found')

  console.log('lead', String(lead._id), lead.projectName || lead.jobId || '')
  console.log('user', admin.email || String(admin._id), admin.role)

  const created = await callHandler(ctrl.createEstimateFromShipper, {
    user: admin,
    body: {
      leadId: String(lead._id),
      fileBase64,
      fileName: path.basename(shipperPath),
      jobType: 'PEMB',
      scope: 'both',
      companyBrand: 'SBD',
    },
  })

  if (!created.body?.success) {
    console.error('CREATE FAIL', created.statusCode, JSON.stringify(created.body, null, 2))
    process.exitCode = 1
    await mongoose.disconnect()
    return
  }

  const data = created.body.data
  const estimateId = data.estimateId || data.estimate?._id
  console.log('created estimateId', String(estimateId))
  console.log(
    'SF',
    data.squareFootage,
    'totSell',
    data.pricing?.totSell ?? data.estimate?.totalSell,
    'grand',
    data.estimate?.grandTotal,
  )

  const createTot = Number(data.pricing?.totSell || 0)
  if (!(createTot > 0) || !(Number(data.squareFootage) > 0)) {
    console.error('CREATE produced zero pricing/SF — unexpected for Bldg-D sample')
    process.exitCode = 1
    await EstimateQuote.deleteOne({ _id: estimateId })
    await mongoose.disconnect()
    return
  }

  const computed = await callHandler(ctrl.computeEstimateById, {
    user: admin,
    params: { estimateId: String(estimateId) },
    body: {},
  })

  if (!computed.body?.success) {
    console.error('COMPUTE FAIL', computed.statusCode, JSON.stringify(computed.body, null, 2))
    process.exitCode = 1
  } else {
    const tot = Number(
      computed.body.data.pricing?.totSell ||
        computed.body.data.estimate?.pricingResult?.totSell ||
        0,
    )
    const match = Math.round(tot) === Math.round(createTot)
    console.log(
      'recomputed empty-body',
      'totSell',
      tot,
      'grandTotal',
      computed.body.data.estimate?.grandTotal,
      'parity',
      match ? 'OK' : 'MISMATCH',
    )
    if (!match) process.exitCode = 1
  }

  await EstimateQuote.deleteOne({ _id: estimateId })
  console.log('cleaned up smoke estimate', String(estimateId))
  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await mongoose.disconnect()
  } catch (_) {}
  process.exit(1)
})
