const { LEAD_SOURCES, LIFECYCLE_STAGES } = require('../config/constants')

const LEAD_EDIT_BODY_KEYS = [
  'projectName',
  'buildingType',
  'location',
  'source',
  'quoteValue',
  'roofStyle',
  'roofPitch',
  'width',
  'length',
  'height',
  'doors',
  'windows',
  'insulation',
  'door',
  'window',
  'numberOfBuildings',
  'lifecycleStatus',
  'notes',
]

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const normalizeProjectName = (value = '') => value.trim()

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const resolveLeadSource = (source) => {
  if (source === undefined || source === null || source === '') return 'manual'
  return LEAD_SOURCES.includes(source) ? source : null
}

/**
 * Maps request body fields to Lead.create() payload for admin/sales create flows.
 */
const buildLeadCreatePayload = (body, options = {}) => {
  const {
    customerId,
    assignedBy,
    defaultSource = 'manual',
    acceptSource = false,
    forceAssignedSales = null,
  } = options

  const {
    projectName,
    buildingType,
    location,
    source,
    quoteValue,
    estimatedValue,
    roofStyle,
    roofPitch,
    width,
    length,
    height,
    assignedSales,
    doors,
    windows,
    insulation,
    door,
    window,
    numberOfBuildings,
  } = body

  let resolvedSource = defaultSource
  if (acceptSource) {
    const fromBody = source !== undefined && source !== '' ? resolveLeadSource(source) : defaultSource
    if (fromBody === null) return { error: 'Invalid lead source' }
    resolvedSource = fromBody
  }

  const salesId = forceAssignedSales ?? assignedSales ?? null
  const buildingCount = toNumberOrNull(numberOfBuildings)
  const resolvedBuildingCount = buildingCount != null && buildingCount >= 1 ? buildingCount : 1

  return {
    payload: {
      customerId,
      projectName: normalizeProjectName(projectName || ''),
      buildingType: buildingType ? String(buildingType).trim() : '',
      location: location ? String(location).trim() : '',
      source: resolvedSource,
      quoteValue: toNumberOrNull(quoteValue ?? estimatedValue) ?? 0,
      roofStyle: roofStyle || '',
      roofPitch: roofPitch === undefined || roofPitch === null ? '' : String(roofPitch).trim(),
      width: toNumberOrNull(width),
      length: toNumberOrNull(length),
      height: toNumberOrNull(height),
      numDoors: toNumberOrNull(doors ?? door),
      numWindows: toNumberOrNull(windows ?? window),
      numInsulation: toNumberOrNull(insulation),
      numberOfBuildings: resolvedBuildingCount,
      assignedSales: salesId,
      isHandedToSales: !!salesId,
      assigningHistory: salesId
        ? [{ employeeId: salesId, method: 'manual', assignedBy, assignedAt: new Date() }]
        : [],
    },
  }
}

const hasLeadEditFields = (body) =>
  LEAD_EDIT_BODY_KEYS.some((key) => body[key] !== undefined)

/**
 * Applies partial updates to an existing lead document.
 * Numeric fields: send `null` to clear (width/length/height/doors/windows/insulation).
 * quoteValue: send `null` to reset to 0.
 * assignedSales is NOT handled here — use PUT /leads/:leadId/assign.
 */
const applyLeadUpdateFromBody = (lead, body) => {
  if (!hasLeadEditFields(body)) {
    return { error: 'At least one lead field is required' }
  }

  if (body.projectName !== undefined) {
    lead.projectName = normalizeProjectName(body.projectName ?? '')
  }
  if (body.buildingType !== undefined) {
    lead.buildingType = body.buildingType === null ? '' : String(body.buildingType).trim()
  }
  if (body.location !== undefined) {
    lead.location = body.location === null ? '' : String(body.location).trim()
  }
  if (body.source !== undefined) {
    if (body.source === null || body.source === '') {
      return { error: 'Invalid lead source' }
    }
    const resolved = resolveLeadSource(body.source)
    if (resolved === null) return { error: 'Invalid lead source' }
    lead.source = resolved
  }
  if (body.quoteValue !== undefined) {
    lead.quoteValue = body.quoteValue === null ? 0 : (toNumberOrNull(body.quoteValue) ?? 0)
  }
  if (body.roofStyle !== undefined) {
    lead.roofStyle = body.roofStyle === null ? '' : String(body.roofStyle)
  }
  if (body.roofPitch !== undefined) {
    lead.roofPitch = body.roofPitch === null ? '' : String(body.roofPitch).trim()
  }
  if (body.width !== undefined) lead.width = toNumberOrNull(body.width)
  if (body.length !== undefined) lead.length = toNumberOrNull(body.length)
  if (body.height !== undefined) lead.height = toNumberOrNull(body.height)
  if (body.doors !== undefined) lead.numDoors = toNumberOrNull(body.doors)
  else if (body.door !== undefined) lead.numDoors = toNumberOrNull(body.door)
  if (body.windows !== undefined) lead.numWindows = toNumberOrNull(body.windows)
  else if (body.window !== undefined) lead.numWindows = toNumberOrNull(body.window)
  if (body.insulation !== undefined) lead.numInsulation = toNumberOrNull(body.insulation)
  if (body.numberOfBuildings !== undefined) {
    const n = toNumberOrNull(body.numberOfBuildings)
    if (n != null && n >= 1) lead.numberOfBuildings = n
  }
  if (body.notes !== undefined) {
    lead.notes = body.notes === null ? '' : String(body.notes).trim()
  }

  return { lifecycleStatus: body.lifecycleStatus }
}

module.exports = {
  escapeRegex,
  normalizeProjectName,
  toNumberOrNull,
  resolveLeadSource,
  buildLeadCreatePayload,
  applyLeadUpdateFromBody,
  hasLeadEditFields,
  LEAD_EDIT_BODY_KEYS,
  LEAD_SOURCES,
  LIFECYCLE_STAGES,
}
