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

  console.log(`[migrate] matched: ${result.matchedCount}, modified: ${result.modifiedCount}`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error('[migrate] error:', err.message)
  process.exit(1)
})
