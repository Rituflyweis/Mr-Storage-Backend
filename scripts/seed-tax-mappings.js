/**
 * Seed the 11 client tax categories (spec §4 Table 1).
 *
 * Each category is pre-filled with a STANDARD AvaTax placeholder code so tax
 * computes immediately in sandbox:
 *   - goods/materials -> P0000000 (tangible personal property, taxable)
 *   - labor/installation/engineering -> NT (non-taxable service)
 *   - freight/shipping -> FR (freight)
 *
 * By default rows are DRAFT: sandbox computes tax (flagged test-only), and
 * PRODUCTION commit stays blocked until an accountant approves official codes.
 *
 *   node scripts/seed-tax-mappings.js            # seed DRAFT with default codes
 *   node scripts/seed-tax-mappings.js --approve  # also mark APPROVED (opt-in)
 *   SEED_APPROVE=true node scripts/seed-tax-mappings.js
 *
 * --approve is an explicit choice: it lets these DEFAULT codes be charged/committed
 * as final tax. The client/accountant should still review them (spec §4, §12);
 * approving does not make the codes correct, only usable.
 *
 * Idempotent: fills a default code on an existing row only if its code is empty,
 * and never downgrades an already-APPROVED mapping.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const TaxCategoryMapping = require('../src/models/TaxCategoryMapping')

const P = 'P0000000' // taxable tangible personal property
const NT = 'NT'       // non-taxable service
const FR = 'FR'       // freight / delivery

const SEED = [
  { backend_category: 'Structure',   item_type: 'PRODUCT', code: P,  description: 'Structural steel / building materials (rigid frames, HSS beams, purlins, girts, eave struts)', keywords: ['frame','beam','purlin','girt','eave','column','structural','hss'] },
  { backend_category: 'Panels',      item_type: 'PRODUCT', code: P,  description: 'Metal roof and wall panels', keywords: ['panel','roof panel','wall panel','sheeting','cladding'] },
  { backend_category: 'Hardware',    item_type: 'PRODUCT', code: P,  description: 'Construction hardware (bolts, screws, fasteners)', keywords: ['bolt','screw','fastener','hardware','anchor'] },
  { backend_category: 'Trims',       item_type: 'PRODUCT', code: P,  description: 'Building trim / flashing materials', keywords: ['trim','flashing','closure'] },
  { backend_category: 'Opening',     item_type: 'PRODUCT', code: P,  description: 'Doors and related opening components', keywords: ['door','window','opening','overhead','rollup','roll-up'] },
  { backend_category: 'Accessories', item_type: 'PRODUCT', code: P,  description: 'Other building accessories (classify by actual accessory)', keywords: ['accessory','accessories','vent','gutter','downspout','skylight'] },
  { backend_category: 'Insulation',  item_type: 'PRODUCT', code: P,  description: 'Building insulation (roof and wall)', keywords: ['insulation','insul','vapor barrier'] },
  { backend_category: 'Concrete',    item_type: 'PRODUCT', code: P,  description: 'Concrete supply OR installed foundation work — REVIEW REQUIRED (bundled lump-sum / foundation)', keywords: ['concrete','foundation','footing','slab'] },
  { backend_category: 'Installation',item_type: 'SERVICE', code: NT, description: 'Construction / installation service (erection crew / installation charge)', keywords: ['install','installation','erection','erect','labor','labour','supervision'] },
  { backend_category: 'Shipping',    item_type: 'SERVICE', code: FR, description: 'Freight / delivery service (separately charged)', keywords: ['freight','shipping','delivery','transport','hauling'] },
  { backend_category: 'Drawings',    item_type: 'SERVICE', code: NT, description: 'Engineering / design service (separately charged drawings)', keywords: ['drawing','engineering','design','stamp','sealed drawings','blueprint'] },
]

const APPROVE = process.argv.includes('--approve') || String(process.env.SEED_APPROVE || '').toLowerCase() === 'true'

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (!uri) throw new Error('Set MONGO_URI in .env')
  await mongoose.connect(uri)

  let created = 0
  let filled = 0
  let approved = 0
  let skipped = 0

  for (const row of SEED) {
    const existing = await TaxCategoryMapping.findOne({ backend_category: row.backend_category })
    const approvalFields = APPROVE
      ? { approval_status: 'APPROVED', approved_at: new Date() }
      : {}

    if (!existing) {
      await TaxCategoryMapping.create({
        backend_category: row.backend_category,
        item_type: row.item_type,
        avalara_tax_code: row.code,
        description: row.description,
        keywords: row.keywords,
        approval_status: APPROVE ? 'APPROVED' : 'DRAFT',
        approved_at: APPROVE ? new Date() : null,
      })
      created += 1
      if (APPROVE) approved += 1
      continue
    }

    let changed = false
    if (!existing.avalara_tax_code) {
      existing.avalara_tax_code = row.code
      filled += 1
      changed = true
    }
    if (APPROVE && existing.approval_status !== 'APPROVED') {
      existing.approval_status = 'APPROVED'
      existing.approved_at = new Date()
      approved += 1
      changed = true
    }
    if (changed) await existing.save()
    else skipped += 1
  }

  console.log(`[seed-tax-mappings] created=${created} filled_code=${filled} approved=${approved} skipped=${skipped} total=${SEED.length}`)
  if (APPROVE) {
    console.log('[seed-tax-mappings] ⚠️  APPROVED with DEFAULT codes. These are standard placeholders (P0000000/NT/FR),')
    console.log('[seed-tax-mappings] ⚠️  not accountant-verified per-state codes. Review before relying on them in production (spec §4, §12).')
  } else {
    console.log('[seed-tax-mappings] Rows are DRAFT. Sandbox computes test-only tax; production commit stays blocked.')
    console.log('[seed-tax-mappings] Approve official codes per category via PUT /api/admin/tax-mappings/:id, or re-run with --approve to go live on defaults.')
  }
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error('[seed-tax-mappings] FAILED:', e.message)
  process.exit(1)
})
