/**
 * Backfills default values on Lead documents created before schema fields were added.
 * Safe to run multiple times — only updates docs where fields are missing.
 *
 * Run: node scripts/migrate-lead-defaults.js
 */

require('../src/config/env')
const connectDB = require('../src/config/db')
const mongoose = require('mongoose')
const Lead = require('../src/models/Lead')

const run = async () => {
  await connectDB()

  // Backfill numberOfBuildings and height
  const result = await Lead.updateMany(
    {
      $or: [
        { numberOfBuildings: { $exists: false } },
        { numberOfBuildings: null },
        { height: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          numberOfBuildings: {
            $cond: [{ $or: [{ $eq: ['$numberOfBuildings', null] }, { $not: ['$numberOfBuildings'] }] }, 1, '$numberOfBuildings'],
          },
          height: {
            $cond: [{ $not: ['$height'] }, null, '$height'],
          },
        },
      },
    ]
  )
  console.log(`[migrate] numberOfBuildings/height — matched: ${result.matchedCount}, modified: ${result.modifiedCount}`)

  // Backfill jobId for leads that don't have one, sorted by createdAt so numbering is chronological
  const leadsWithoutJobId = await Lead.find({ jobId: null }).sort({ createdAt: 1 }).lean()
  console.log(`[migrate] leads missing jobId: ${leadsWithoutJobId.length}`)

  let counter = 1
  const lastWithJobId = await Lead.findOne({ jobId: { $exists: true, $ne: null } }, { jobId: 1 })
    .sort({ createdAt: -1 })
    .lean()
  if (lastWithJobId?.jobId) {
    counter = parseInt(lastWithJobId.jobId.split('-')[1], 10) + 1
  }

  for (const lead of leadsWithoutJobId) {
    await Lead.updateOne({ _id: lead._id }, { $set: { jobId: `PRO-${String(counter).padStart(3, '0')}` } })
    counter++
  }
  console.log(`[migrate] jobId backfill done — assigned ${leadsWithoutJobId.length} job IDs`)

  await mongoose.disconnect()
}

run().catch(err => {
  console.error('[migrate] error:', err.message)
  process.exit(1)
})
