const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Allocate the next unique sequential code by scanning the highest numeric suffix.
 * Never uses createdAt or countDocuments — safe when rows are out of order or deleted.
 *
 * @param {object} opts
 * @param {import('mongoose').Model} opts.model
 * @param {string} opts.field
 * @param {RegExp} opts.parsePattern - must capture the numeric suffix in group 1
 * @param {(n: number) => string} opts.format - builds the candidate for integer n
 * @param {object} [opts.filter={}]
 * @param {boolean} [opts.includeDeleted=false]
 * @param {number} [opts.retries=20]
 */
const allocateSequentialId = async ({
  model,
  field,
  parsePattern,
  format,
  filter = {},
  includeDeleted = false,
  retries = 20,
}) => {
  const query = { ...filter, [field]: { $exists: true, $nin: [null, ''] } }
  let finder = model.find(query).select(field).lean()
  if (includeDeleted) finder = finder.setOptions({ includeDeleted: true })
  const rows = await finder

  let maxNum = 0
  for (const row of rows) {
    const m = String(row[field] || '').trim().match(parsePattern)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > maxNum) maxNum = n
  }

  for (let offset = 1; offset <= retries; offset++) {
    const candidate = format(maxNum + offset)
    let existsQuery = model.exists({ [field]: candidate })
    if (includeDeleted) existsQuery = existsQuery.setOptions({ includeDeleted: true })
    if (!(await existsQuery)) return candidate
  }

  throw new Error(`Unable to allocate unique ${field}`)
}

/** PREFIX-0001 style (e.g. VND-0001, PRO-001, DEL-0001) */
const allocatePrefixedCode = async ({
  model,
  field,
  prefix,
  pad = 4,
  filter = {},
  includeDeleted = false,
  retries = 20,
}) => {
  const parsePattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`, 'i')
  return allocateSequentialId({
    model,
    field,
    parsePattern,
    format: (n) => `${prefix}-${String(n).padStart(pad, '0')}`,
    filter,
    includeDeleted,
    retries,
  })
}

module.exports = {
  allocateSequentialId,
  allocatePrefixedCode,
  escapeRegExp,
}
