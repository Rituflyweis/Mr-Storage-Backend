/**
 * Bulk lead import creates Customer stubs (source: import + synthetic email)
 * so Lead can reference customerId. Those are not real Customers-panel rows.
 */

const IMPORT_EMAIL_SUFFIX = '@imports.mrstorage.internal'

const isTruthyQueryFlag = (v) =>
  ['true', '1', 'yes'].includes(String(v || '').toLowerCase())

const importEmailNotMatch = () =>
  new RegExp(`${IMPORT_EMAIL_SUFFIX.replace(/\./g, '\\.')}$`, 'i')

/**
 * Default = real customers only (exclude import stubs).
 * Opt-in: `imported=true` → only stubs; `source=` → exact source.
 */
const applyCustomerSourceScope = (filter = {}, query = {}) => {
  const { source, imported } = query
  if (isTruthyQueryFlag(imported)) {
    filter.source = 'import'
    return filter
  }
  if (source?.trim()) {
    filter.source = source.trim()
    return filter
  }
  filter.$and = [
    ...(filter.$and || []),
    { source: { $ne: 'import' } },
    { email: { $not: importEmailNotMatch() } },
  ]
  return filter
}

/** Mongo match fragment for aggregations / $match stages. */
const realCustomerMatch = () => ({
  source: { $ne: 'import' },
  email: { $not: importEmailNotMatch() },
})

module.exports = {
  IMPORT_EMAIL_SUFFIX,
  applyCustomerSourceScope,
  realCustomerMatch,
  isTruthyQueryFlag,
}
