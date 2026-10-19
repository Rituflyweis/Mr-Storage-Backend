const TaxCategoryMapping = require('../../models/TaxCategoryMapping')
const TaxMappingAudit = require('../../models/TaxMappingAudit')
const TAX_CODES = require('../../config/avalaraTaxCodes')
const { isProductionEnv } = require('../../config/taxEngine')

/**
 * Sandbox-only fallback codes, used when no APPROVED mapping exists. These are
 * flagged test-only and are NEVER allowed to be committed as final tax in
 * production (spec §5, §8). Keyword buckets mirror the seeded categories.
 */
const FALLBACK_SERVICE_LABOR = /\b(labor|labour|install(ation)?|erection|erect|supervision|warranty)\b/i
const FALLBACK_FREIGHT = /\b(freight|shipping|delivery|transport|hauling)\b/i
const FALLBACK_ENGINEERING = /\b(engineering|drawing|design|blueprint|stamp)\b/i

const buildLineText = (line = {}) =>
  [line.description, ...(Array.isArray(line.items) ? line.items : []), line.taxCategory, line.category]
    .filter(Boolean)
    .join(' ')

/**
 * Load the APPROVED, in-effect mappings once per calculation and index them by
 * backend_category and by keyword, so line resolution is a pure in-memory lookup.
 */
const loadApprovedMappings = async (at = new Date()) => {
  const rows = await TaxCategoryMapping.find({ approval_status: 'APPROVED' }).lean()
  const usable = rows.filter((m) => {
    if (!m.avalara_tax_code) return false
    if (m.effective_from && at < new Date(m.effective_from)) return false
    if (m.effective_to && at > new Date(m.effective_to)) return false
    return true
  })
  const byCategory = new Map()
  const keywordIndex = [] // [{ re, code, category, itemType }]
  for (const m of usable) {
    byCategory.set(String(m.backend_category).toLowerCase(), m)
    const kws = Array.isArray(m.keywords) ? m.keywords.filter(Boolean) : []
    if (kws.length) {
      const re = new RegExp(`\\b(${kws.map(escapeRe).join('|')})\\b`, 'i')
      keywordIndex.push({ re, code: m.avalara_tax_code, category: m.backend_category, itemType: m.item_type })
    }
  }
  const latest = usable.reduce((max, m) => {
    const t = new Date(m.updatedAt || m.approved_at || 0).getTime()
    return t > max ? t : max
  }, 0)
  return { byCategory, keywordIndex, mappingVersion: latest ? new Date(latest).toISOString() : 'none' }
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Resolve one invoice line to a tax code.
 * Precedence: explicit line.taxCode -> explicit line.taxable flag ->
 *   APPROVED mapping (by category, then keyword) -> sandbox test-only fallback.
 * Returns { code, approved, source, category }.
 */
const resolveLineTaxCode = (line = {}, approved = null) => {
  const explicit = String(line.taxCode || '').trim()
  if (explicit) return { code: explicit, approved: true, source: 'explicit', category: line.category || null }
  if (line.taxable === false) return { code: TAX_CODES.DEFAULT_NON_TAXABLE, approved: true, source: 'explicit_flag', category: null }
  if (line.taxable === true) return { code: TAX_CODES.DEFAULT_TAXABLE, approved: true, source: 'explicit_flag', category: null }

  const text = buildLineText(line)
  const catKey = String(line.category || '').toLowerCase()

  if (approved) {
    if (catKey && approved.byCategory.has(catKey)) {
      const m = approved.byCategory.get(catKey)
      return { code: m.avalara_tax_code, approved: true, source: 'mapping_category', category: m.backend_category }
    }
    for (const entry of approved.keywordIndex) {
      if (entry.re.test(text)) {
        return { code: entry.code, approved: true, source: 'mapping_keyword', category: entry.category }
      }
    }
  }

  // No approved mapping — sandbox test-only fallback (never final in production).
  if (FALLBACK_FREIGHT.test(text)) return { code: TAX_CODES.FREIGHT, approved: false, source: 'fallback_freight', category: 'Shipping' }
  if (FALLBACK_ENGINEERING.test(text)) return { code: TAX_CODES.LABOR_NON_TAXABLE, approved: false, source: 'fallback_engineering', category: 'Drawings' }
  if (FALLBACK_SERVICE_LABOR.test(text)) return { code: TAX_CODES.LABOR_NON_TAXABLE, approved: false, source: 'fallback_labor', category: 'Installation' }
  return { code: TAX_CODES.DEFAULT_TAXABLE, approved: false, source: 'fallback_default', category: null }
}

/** True if any resolved line used an unapproved (test-only) code. */
const hasUnapprovedCodes = (resolutions = []) => resolutions.some((r) => !r.approved)

/** Production must never charge test-only tax (§5, §8). */
const testOnlyBlocksFinal = (resolutions = []) => isProductionEnv() && hasUnapprovedCodes(resolutions)

// ── Admin mapping CRUD + audit ──────────────────────────────────────────────

const listMappings = async () =>
  TaxCategoryMapping.find({}).sort({ backend_category: 1 }).lean()

const writeAudit = async ({ actor, action, before, after, reason }) => {
  try {
    await TaxMappingAudit.create({
      actor: actor?._id || null,
      actorName: actor?.name || actor?.email || '',
      mappingId: (after && after._id) || (before && before._id) || null,
      action,
      mapping_before: before || null,
      mapping_after: after || null,
      reason: reason || '',
    })
  } catch (err) {
    console.warn('[tax-mapping] audit write failed:', err.message)
  }
}

const APPROVAL_FLOW = { DRAFT: ['PENDING'], PENDING: ['APPROVED', 'DRAFT'], APPROVED: ['DRAFT'] }

/**
 * Update a mapping with role-aware approval transitions and audit.
 * Allowed fields: avalara_tax_code, description, item_type, keywords, effective_from,
 * effective_to, approval_status. Approving requires a non-empty code.
 */
const updateMapping = async (id, patch = {}, actor, reason = '') => {
  const mapping = await TaxCategoryMapping.findById(id)
  if (!mapping) return { error: 'not_found' }
  const before = mapping.toObject()

  const ALLOWED = ['avalara_tax_code', 'description', 'item_type', 'keywords', 'effective_from', 'effective_to']
  for (const key of ALLOWED) {
    if (patch[key] !== undefined) mapping[key] = patch[key]
  }

  if (patch.approval_status && patch.approval_status !== mapping.approval_status) {
    const from = mapping.approval_status
    const to = patch.approval_status
    if (!APPROVAL_FLOW[from]?.includes(to)) {
      return { error: 'invalid_transition', message: `Cannot move ${from} -> ${to}` }
    }
    if (to === 'APPROVED' && !String(mapping.avalara_tax_code || '').trim()) {
      return { error: 'code_required', message: 'An Avalara tax code is required before approval' }
    }
    mapping.approval_status = to
    if (to === 'APPROVED') {
      mapping.approved_by = actor?._id || null
      mapping.approved_at = new Date()
    } else {
      mapping.approved_by = null
      mapping.approved_at = null
    }
  }

  mapping.updated_by = actor?._id || null
  await mapping.save()
  const after = mapping.toObject()

  const action = patch.approval_status && patch.approval_status !== before.approval_status ? 'approve' : 'update'
  await writeAudit({ actor, action, before, after, reason })

  return { ok: true, mapping: after }
}

module.exports = {
  loadApprovedMappings,
  resolveLineTaxCode,
  hasUnapprovedCodes,
  testOnlyBlocksFinal,
  listMappings,
  updateMapping,
  writeAudit,
}
