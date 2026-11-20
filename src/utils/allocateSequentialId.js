const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One queue per id series so overlapping creates cannot be handed the same code. */
const lanes = new Map()
/** Codes already handed out in this process that may not be saved yet. */
const reserved = new Map()

const laneKey = (model, field, parsePattern) =>
  `${model.modelName}:${field}:${parsePattern.source}:${parsePattern.flags}`

const enqueue = (key, fn) => {
  const previous = lanes.get(key) || Promise.resolve()
  const run = previous.then(fn, fn)
  lanes.set(key, run.then(() => {}, () => {}))
  return run
}

const numberFrom = (value, parsePattern) => {
  const match = String(value || '').trim().match(parsePattern)
  if (!match) return 0
  const n = parseInt(match[1], 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Allocate the next unique sequential code by scanning the highest numeric suffix.
 * Never uses createdAt or countDocuments — safe when rows are out of order or deleted.
 * Calls for the same series run one at a time, and a code is reserved until it is saved.
 *
 * @param {object} opts
 * @param {import('mongoose').Model} opts.model
 * @param {string} opts.field
 * @param {RegExp} opts.parsePattern - must capture the numeric suffix in group 1
 * @param {(n: number) => string} opts.format - builds the candidate for integer n
 * @param {object} [opts.filter={}]
 * @param {boolean} [opts.includeDeleted=false]
 * @param {number} [opts.retries=50]
 */
const allocateSequentialId = async ({
  model,
  field,
  parsePattern,
  format,
  filter = {},
  includeDeleted = false,
  retries = 50,
}) => {
  const key = laneKey(model, field, parsePattern)
  return enqueue(key, () => allocateNext({
    key,
    model,
    field,
    parsePattern,
    format,
    filter,
    includeDeleted,
    retries,
  }))
}

const allocateNext = async ({
  key,
  model,
  field,
  parsePattern,
  format,
  filter,
  includeDeleted,
  retries,
}) => {
  const query = { ...filter, [field]: { $exists: true, $nin: [null, ''] } }
  let finder = model.find(query).select(field).lean()
  if (includeDeleted) finder = finder.setOptions({ includeDeleted: true })
  const rows = await finder

  const held = reserved.get(key) || new Set()
  const saved = new Set()
  let maxNum = 0
  for (const row of rows) {
    const raw = String(row[field] || '').trim()
    saved.add(raw)
    const n = numberFrom(raw, parsePattern)
    if (n > maxNum) maxNum = n
  }
  for (const code of held) {
    if (saved.has(code)) held.delete(code)
    else maxNum = Math.max(maxNum, numberFrom(code, parsePattern))
  }

  for (let offset = 1; offset <= retries; offset++) {
    const candidate = format(maxNum + offset)
    if (held.has(candidate)) continue
    let existsQuery = model.exists({ [field]: candidate })
    if (includeDeleted) existsQuery = existsQuery.setOptions({ includeDeleted: true })
    if (await existsQuery) continue
    held.add(candidate)
    reserved.set(key, held)
    return candidate
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
