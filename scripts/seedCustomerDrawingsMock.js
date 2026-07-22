/**
 * Seeds realistic multi-building drawing/document mock data for customer1@example.com
 * so the Customer Panel "Project Drawings" screens have something real to show:
 *   Project Drawings (landing) -> Select Building -> Building Drawings & Documents
 *
 * Safe to re-run: skips a lead if it already has DrawingDocument records.
 * Usage: node scripts/seedCustomerDrawingsMock.js
 */
const mongoose = require('mongoose')
require('dotenv').config()

const Lead = require('../src/models/Lead')
const Customer = require('../src/models/Customer')
const User = require('../src/models/User')
const DrawingDocument = require('../src/models/DrawingDocument')

const DRAWING_TEMPLATES = [
  { name: 'Architectural Plans.pdf', fileType: 'pdf', documentType: 'architectural', status: 'under_review', category: 'drawing' },
  { name: 'Structural Drawings.dwg', fileType: 'dwg', documentType: 'structural', status: 'approved', category: 'drawing' },
  { name: 'Fabrication Details.dwg', fileType: 'dwg', documentType: 'fabrication', status: 'approved', category: 'drawing' },
  { name: 'Erection Plan.pdf', fileType: 'pdf', documentType: 'erection', status: 'pending', category: 'drawing' },
  { name: 'Specifications.docx', fileType: 'docx', documentType: 'specification', status: 'approved', category: 'drawing' },
  { name: 'Building.Image', fileType: 'jpg', documentType: 'other', status: 'approved', category: 'photo' },
]

const DOCUMENT_TEMPLATES = [
  { name: 'Agreement', fileType: 'pdf', documentType: 'other', status: 'approved', category: 'document' },
  { name: 'Contract', fileType: 'pdf', documentType: 'other', status: 'approved', category: 'document' },
  { name: 'Invoice', fileType: 'pdf', documentType: 'other', status: 'approved', category: 'document' },
]

const BUILDING_LETTERS = ['A', 'B', 'C', 'D']

async function seedLead(lead, uploader) {
  const existing = await DrawingDocument.countDocuments({ leadId: lead._id })
  if (existing >= 20) {
    console.log(`  skip ${lead.jobId} — already has ${existing} documents`)
    return
  }

  await Lead.findByIdAndUpdate(lead._id, { numberOfBuildings: 4 })

  const docs = []
  for (const letter of BUILDING_LETTERS) {
    const buildingLabel = `Building ${letter}`
    for (const t of DRAWING_TEMPLATES) {
      docs.push({
        leadId: lead._id,
        buildingLabel,
        category: t.category,
        name: t.name,
        fileUrl: `https://example-bucket.s3.amazonaws.com/${lead.jobId}/${letter}/${encodeURIComponent(t.name)}`,
        fileType: t.fileType,
        fileSize: 15200000,
        documentType: t.documentType,
        status: t.status,
        uploadedBy: uploader._id,
        approvedBy: t.status === 'approved' ? uploader._id : null,
        approvedAt: t.status === 'approved' ? new Date() : null,
        revisionNote: t.status === 'under_review' ? 'Please confirm anchor bolt spacing on grid line 4' : '',
      })
    }
    for (const t of DOCUMENT_TEMPLATES) {
      docs.push({
        leadId: lead._id,
        buildingLabel,
        category: t.category,
        name: t.name,
        fileUrl: `https://example-bucket.s3.amazonaws.com/${lead.jobId}/${letter}/${encodeURIComponent(t.name)}`,
        fileType: t.fileType,
        fileSize: 15200000,
        documentType: t.documentType,
        status: t.status,
        uploadedBy: uploader._id,
        approvedBy: uploader._id,
        approvedAt: new Date(),
      })
    }
  }

  await DrawingDocument.insertMany(docs)
  console.log(`  seeded ${docs.length} documents across ${BUILDING_LETTERS.length} buildings for ${lead.jobId} (${lead.projectName})`)
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI)

  const customer = await Customer.findOne({ email: 'customer1@example.com' }).select('_id email').lean()
  if (!customer) throw new Error('customer1@example.com not found')

  const uploader = await User.findOne({ email: 'admin@flyweis.test' }).select('_id name').lean()
  if (!uploader) throw new Error('admin@flyweis.test not found')

  const leads = await Lead.find({ customerId: customer._id }).select('_id projectName jobId').lean()
  console.log(`Seeding drawings for ${leads.length} project(s) owned by ${customer.email}`)

  for (const lead of leads) {
    await seedLead(lead, uploader)
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
