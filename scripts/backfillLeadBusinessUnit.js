/**
 * Sets `businessUnit` on existing leads that don't have one yet.
 * Leads that already have a unit are never touched. Dry run by default.
 *
 * Run:
 *   node scripts/backfillLeadBusinessUnit.js --unit=steel            # preview count only
 *   node scripts/backfillLeadBusinessUnit.js --unit=steel --apply    # write changes
 *
 * Optional: --source=chat to limit to one lead source.
 */

require('../src/config/env')
const connectDB = require('../src/config/db')
const mongoose = require('mongoose')
const Lead = require('../src/models/Lead')
const { BUSINESS_UNITS } = require('../src/config/constants')

const readArg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=').slice(1).join('=').trim() : null
}

const run = async () => {
  const unit = (readArg('unit') || '').toLowerCase()
  const source = readArg('source')
  const apply = process.argv.includes('--apply')

  if (!BUSINESS_UNITS.includes(unit)) {
    console.error(`[backfill] --unit is required and must be one of: ${BUSINESS_UNITS.join(', ')}`)
    process.exit(1)
  }

  await connectDB()

  const filter = { $or: [{ businessUnit: { $exists: false } }, { businessUnit: null }] }
  if (source) filter.source = source

  const count = await Lead.countDocuments(filter).setOptions({ includeDeleted: true })
  console.log(`[backfill] leads without businessUnit${source ? ` (source=${source})` : ''}: ${count}`)

  if (!apply) {
    console.log('[backfill] dry run — re-run with --apply to set businessUnit =', unit)
  } else {
    const result = await Lead.updateMany(filter, { $set: { businessUnit: unit } }).setOptions({
      includeDeleted: true,
    })
    console.log(`[backfill] set businessUnit=${unit} — matched: ${result.matchedCount}, modified: ${result.modifiedCount}`)
  }

  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('[backfill] error:', err.message)
  process.exit(1)
})
