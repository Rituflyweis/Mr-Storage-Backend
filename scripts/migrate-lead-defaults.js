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

  // Backfill missing/non-year jobIds with YYYY### (same as generateJobId / Lead pre-save)
  const generateJobId = require('../src/utils/generateJobId')
  const { isYearFormatJobId } = generateJobId
  const leadsNeedingJobId = await Lead.find({})
    .setOptions({ includeDeleted: true })
    .sort({ createdAt: 1 })
    .select('_id jobId createdAt')
    .lean()
  const toFix = leadsNeedingJobId.filter((l) => !isYearFormatJobId(l.jobId))
  console.log(`[migrate] leads missing year-format jobId: ${toFix.length}`)

  for (const lead of toFix) {
    const nextId = await generateJobId(lead.createdAt ? new Date(lead.createdAt) : new Date())
    await Lead.updateOne(
      { _id: lead._id },
      { $set: { jobId: nextId, previousJobId: lead.jobId || null } },
    ).setOptions({ includeDeleted: true })
  }
  console.log(`[migrate] jobId backfill done — assigned ${toFix.length} year-format job IDs`)

  await mongoose.disconnect()
}

run().catch(err => {
  console.error('[migrate] error:', err.message)
  process.exit(1)
})
