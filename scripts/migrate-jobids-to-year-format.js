/**
 * Reassign non-year Lead.jobId values (PRO-###, empty, UNIQ-*, etc.) to YYYY### format.
 * Safe to re-run — year-format IDs are left alone.
 *
 * Usage:
 *   node scripts/migrate-jobids-to-year-format.js           # dry-run
 *   node scripts/migrate-jobids-to-year-format.js --apply   # write changes
 */

require('dotenv').config()
require('../src/config/env')
const connectDB = require('../src/config/db')
const mongoose = require('mongoose')
const Lead = require('../src/models/Lead')
const generateJobId = require('../src/utils/generateJobId')
const {
  isYearFormatJobId,
  formatYearJobId,
  getProjectIdYear,
} = generateJobId

const APPLY = process.argv.includes('--apply')
const PAD = 3

const run = async () => {
  await connectDB()

  const leads = await Lead.find({})
    .setOptions({ includeDeleted: true })
    .sort({ createdAt: 1 })
    .select('_id projectName jobId previousJobId createdAt isDeleted')
    .lean()

  const needsFix = leads.filter((l) => !isYearFormatJobId(l.jobId))
  console.log(`[migrate-jobids] total leads: ${leads.length}`)
  console.log(`[migrate-jobids] need year-format jobId: ${needsFix.length}`)
  console.log(`[migrate-jobids] mode: ${APPLY ? 'APPLY' : 'DRY-RUN (pass --apply to write)'}`)

  // Track next sequence per year so dry-run (and apply) don't repeat the same candidate.
  const nextSeqByYear = {}
  const seedYearMax = async (year) => {
    if (nextSeqByYear[year] != null) return
    const yearPattern = new RegExp(`^${year}(\\d{${PAD},})$`)
    const rows = await Lead.find({ jobId: { $regex: yearPattern } })
      .setOptions({ includeDeleted: true })
      .select('jobId')
      .lean()
    let max = 0
    for (const row of rows) {
      const m = String(row.jobId || '').match(yearPattern)
      if (!m) continue
      const n = parseInt(m[1], 10)
      if (Number.isFinite(n) && n > max) max = n
    }
    nextSeqByYear[year] = max + 1
  }

  let updated = 0
  for (const lead of needsFix) {
    const when = lead.createdAt ? new Date(lead.createdAt) : new Date()
    const year = getProjectIdYear(when)
    await seedYearMax(year)
    const nextId = formatYearJobId(year, nextSeqByYear[year])
    nextSeqByYear[year] += 1

    const oldId = lead.jobId || null
    console.log(`  ${lead._id}  ${oldId || '(empty)'}  →  ${nextId}  (${lead.projectName || '—'})`)

    if (APPLY) {
      // Ensure uniqueness if something raced since seed
      let candidate = nextId
      let guard = 0
      while (await Lead.exists({ jobId: candidate }).setOptions({ includeDeleted: true })) {
        candidate = formatYearJobId(year, nextSeqByYear[year]++)
        guard += 1
        if (guard > 50) throw new Error(`Unable to allocate unique jobId for ${lead._id}`)
      }
      await Lead.updateOne(
        { _id: lead._id },
        {
          $set: {
            jobId: candidate,
            previousJobId: oldId || lead.previousJobId || null,
          },
        },
      ).setOptions({ includeDeleted: true })
      updated += 1
    }
  }

  console.log(`[migrate-jobids] ${APPLY ? `updated ${updated}` : `would update ${needsFix.length}`}`)
  await mongoose.disconnect()
}

run().catch((err) => {
  console.error('[migrate-jobids] error:', err)
  process.exit(1)
})
