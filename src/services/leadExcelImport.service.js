const crypto = require('crypto')
const ExcelJS = require('exceljs')
const bcrypt = require('bcryptjs')
const { parse } = require('csv-parse/sync')
const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const generateCustomerId = require('../utils/generateCustomerId')
const { normalizeBusinessUnit } = require('../utils/businessUnit')
const { normalizeStructuredAddress } = require('../models/schemas/structuredAddress')
const { syncLeadBuildings } = require('./leadBuilding.service')

const IMPORT_EMAIL_DOMAIN = 'imports.mrstorage.internal'

const normalizeHeader = (h) =>
  String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s/%()-]/g, '')

/** Map normalized header → canonical field key */
const HEADER_ALIASES = {
  project: 'projectName',
  'project name': 'projectName',
  projectname: 'projectName',
  name: 'customerName',
  'customer name': 'customerName',
  customername: 'customerName',
  email: 'customerEmail',
  'customer email': 'customerEmail',
  customeremail: 'customerEmail',
  phone: 'customerPhone',
  'customer phone': 'customerPhone',
  customerphone: 'customerPhone',
  'owner email': 'customerEmail',
  'developer email': 'customerEmailAlt',
  'owner phone': 'customerPhone',
  'developer phone': 'customerPhoneAlt',
  'business contact': 'businessContact',
  'developer owner': 'developerOwner',
  'developer / owner': 'developerOwner',
  address: 'addressLine1',
  city: 'city',
  state: 'state',
  zip: 'postalCode',
  'sq ft': 'sqft',
  sqft: 'sqft',
  description: 'description',
  stage: 'stage',
  status: 'status',
  notes: 'notes',
  source: 'sourceLabel',
  market: 'market',
  'project value': 'quoteValue',
  projectvalue: 'quoteValue',
  'quote value': 'quoteValue',
  buildingtype: 'buildingType',
  'building type': 'buildingType',
  projecttype: 'buildingType',
  project_type: 'buildingType',
  location: 'location',
  businessunit: 'businessUnit',
  'business unit': 'businessUnit',
  roofstyle: 'roofStyle',
  roofpitch: 'roofPitch',
  width: 'width',
  length: 'length',
  height: 'height',
  link: 'link',
  map: 'mapLink',
  'street view': 'streetView',
  county: 'county',
  'owner llc': 'ownerLlc',
  'owner / llc': 'ownerLlc',
  latitude: 'latitude',
  longitude: 'longitude',
}

const cellToString = (value) => {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object' && value.text) return String(value.text).trim()
  if (typeof value === 'object' && value.result != null) return String(value.result).trim()
  return String(value).trim()
}

const findHeaderRowIndex = (sheet, maxScan = 25) => {
  for (let r = 1; r <= Math.min(maxScan, sheet.rowCount); r++) {
    const row = sheet.getRow(r)
    const texts = []
    row.eachCell({ includeEmpty: false }, (cell) => {
      texts.push(normalizeHeader(cellToString(cell.value)))
    })
    const hasProject = texts.some((t) => t === 'project' || t === 'project name' || t === 'projectname')
    const hasContact = texts.some((t) =>
      ['email', 'customer email', 'address', 'city'].includes(t)
    )
    if (hasProject && texts.length >= 5) return r
    if (hasProject && hasContact) return r
  }
  return 1
}

const parseExcelToRecords = async (buffer) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('Excel file has no worksheets')

  const headerRowIndex = findHeaderRowIndex(sheet)
  const headerRow = sheet.getRow(headerRowIndex)
  const colKeys = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const norm = normalizeHeader(cellToString(cell.value))
    colKeys[colNumber] = HEADER_ALIASES[norm] || norm.replace(/\s+/g, '_')
  })

  const records = []
  for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const record = {}
    let nonEmpty = 0
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = colKeys[colNumber]
      if (!key) return
      const val = cellToString(cell.value)
      if (val) nonEmpty++
      record[key] = val
    })
    if (nonEmpty === 0) continue
    records.push(record)
  }
  return { records, headerRowIndex, sheetName: sheet.name }
}

const parseCsvToRecords = (csvText) =>
  parse(csvText, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })

const parseNumber = (v) => {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : null
}

const buildLocationString = (row) => {
  if (row.location) return row.location
  const parts = [row.addressLine1, row.city, row.state, row.postalCode].filter(Boolean)
  return parts.join(', ')
}

const pickCustomerIdentity = (row) => {
  const emailRaw =
    row.customerEmail ||
    row.customerEmailAlt ||
    row.businessContact?.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ||
    ''
  const phoneRaw =
    row.customerPhone ||
    row.customerPhoneAlt ||
    row.businessContact?.replace(/[^\d+]/g, '') ||
    ''

  let email = emailRaw.toLowerCase().trim()
  let phone = phoneRaw.replace(/[^\d]/g, '').slice(-15)

  const name =
    row.customerName ||
    row.developerOwner ||
    row.ownerLlc ||
    (row.projectName ? row.projectName.split(' ').slice(0, 2).join(' ') : '') ||
    'Import Contact'

  if (!email) {
    const hash = crypto
      .createHash('sha256')
      .update(`${row.projectName}|${buildLocationString(row)}`)
      .digest('hex')
      .slice(0, 20)
    email = `import.${hash}@${IMPORT_EMAIL_DOMAIN}`
  }
  if (!phone || phone.length < 7) {
    const hash = crypto.createHash('md5').update(email).digest('hex').replace(/\D/g, '').slice(0, 10)
    phone = `900${hash}`.slice(0, 15)
  }

  return { email, phone, name: String(name).trim().slice(0, 120) }
}

const buildImportNotes = (row) => {
  const chunks = []
  const push = (label, val) => {
    if (val) chunks.push(`${label}: ${val}`)
  }
  push('Description', row.description)
  push('Stage', row.stage)
  push('Status', row.status)
  push('Market', row.market)
  push('Source', row.sourceLabel)
  push('County', row.county)
  push('Owner/LLC', row.ownerLlc)
  push('Link', row.link)
  push('Map', row.mapLink)
  push('Street View', row.streetView)
  push('Lat/Lng', row.latitude && row.longitude ? `${row.latitude}, ${row.longitude}` : '')
  push('Notes', row.notes)
  if (row.businessContact) push('Business contact', row.businessContact)
  return chunks.join('\n').slice(0, 8000)
}

const inferBuildingType = (row) => {
  if (row.buildingType) return row.buildingType
  const blob = `${row.description || ''} ${row.projectName || ''}`.toLowerCase()
  if (blob.includes('self-storage') || blob.includes('self storage')) return 'Self-Storage'
  if (blob.includes('warehouse')) return 'Warehouse'
  return 'Commercial'
}

const resolveDuplicateLead = async (projectName, city, state, postalCode) => {
  if (!projectName) return null
  const filter = {
    projectName: new RegExp(`^${projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    isDeleted: { $ne: true },
  }
  if (city) filter.city = new RegExp(`^${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  if (state) filter.state = state
  if (postalCode) filter.pincode = postalCode
  return Lead.findOne(filter).select('_id projectName').lean()
}

const importOneRow = async (row, ctx) => {
  const projectName = (row.projectName || row.project || '').trim()
  if (!projectName) {
    return { status: 'skipped', reason: 'missing projectName' }
  }

  const city = (row.city || '').trim()
  const state = (row.state || '').trim().toUpperCase().slice(0, 2)
  const postalCode = String(row.postalCode || row.zip || row.pincode || '').trim()
  const dup = await resolveDuplicateLead(projectName, city, state, postalCode)
  if (dup) return { status: 'skipped', reason: 'duplicate project', leadId: dup._id }

  const { email, phone, name } = pickCustomerIdentity(row)
  let customer = await Customer.findOne({ email })
  if (!customer) {
    const existingPhone = await Customer.findOne({ 'phone.number': phone })
    if (existingPhone) customer = existingPhone
  }
  if (!customer) {
    const custId = await generateCustomerId()
    const hashed = await bcrypt.hash(phone, 12)
    const nameParts = name.split(/\s+/)
    customer = await Customer.create({
      customerId: custId,
      firstName: nameParts[0] || 'Import',
      lastName: nameParts.slice(1).join(' '),
      email,
      phone: { number: phone, countryCode: '+1' },
      password: hashed,
      source: 'import',
      company: row.ownerLlc || row.developerOwner || '',
      location: buildLocationString(row),
    })
  }

  const installAddress = normalizeStructuredAddress({
    line1: row.addressLine1 || '',
    city,
    state,
    postalCode,
    country: 'US',
    companyName: row.ownerLlc || '',
  })

  const unitInput = row.businessUnit ?? ctx.defaultBusinessUnit
  const unit = unitInput != null ? normalizeBusinessUnit(unitInput) : { skip: true }

  const leadPayload = {
    customerId: customer._id,
    projectName,
    buildingType: inferBuildingType(row),
    location: buildLocationString(row),
    installAddress,
    city,
    state,
    pincode: postalCode,
    sqft: row.sqft != null ? String(row.sqft) : '',
    quoteValue: parseNumber(row.quoteValue) ?? 0,
    notes: buildImportNotes(row),
    source: 'import',
    lifecycleStatus: 'initial_contact',
    assignedSales: ctx.assignSalesUserId || null,
    isHandedToSales: Boolean(ctx.assignSalesUserId),
  }

  if (!unit.skip && !unit.error) leadPayload.businessUnit = unit.value
  if (row.width) leadPayload.width = parseNumber(row.width)
  if (row.length) leadPayload.length = parseNumber(row.length)
  if (row.height) leadPayload.height = parseNumber(row.height)
  if (row.roofStyle) leadPayload.roofStyle = row.roofStyle
  if (row.roofPitch) leadPayload.roofPitch = row.roofPitch

  if (ctx.assignSalesUserId) {
    leadPayload.assigningHistory = [{
      employeeId: ctx.assignSalesUserId,
      method: 'manual',
      assignedBy: ctx.assignSalesUserId,
      assignedAt: new Date(),
    }]
  }

  const lead = await Lead.create(leadPayload)
  await syncLeadBuildings(lead, { createdBy: ctx.createdByUserId })
  return { status: 'created', leadId: lead._id, jobId: lead.jobId }
}

exports.parseExcelToRecords = parseExcelToRecords
exports.parseCsvToRecords = parseCsvToRecords

/**
 * @param {object[]} records - normalized row objects
 * @param {object} ctx - { createdByUserId, assignSalesUserId?, defaultBusinessUnit? }
 */
exports.importLeadRecords = async (records, ctx = {}) => {
  const results = {
    created: 0,
    skipped: 0,
    errors: [],
    totalRows: records.length,
  }

  for (let i = 0; i < records.length; i++) {
    try {
      const outcome = await importOneRow(records[i], ctx)
      if (outcome.status === 'created') results.created++
      else results.skipped++
      if (outcome.reason && outcome.status === 'skipped') {
        results.errors.push({ row: i + 1, reason: outcome.reason, leadId: outcome.leadId })
      }
    } catch (err) {
      results.errors.push({ row: i + 1, reason: err.message })
    }
  }

  return results
}

exports.importFromExcelBuffer = async (buffer, ctx) => {
  const { records, headerRowIndex, sheetName } = await parseExcelToRecords(buffer)
  const results = await exports.importLeadRecords(records, ctx)
  return { ...results, headerRowIndex, sheetName }
}

exports.importFromCsvText = async (csvText, ctx) => {
  const raw = parseCsvToRecords(csvText)
  const records = raw.map((row) => {
    const mapped = {}
    for (const [k, v] of Object.entries(row)) {
      const norm = normalizeHeader(k)
      const key = HEADER_ALIASES[norm] || k
      mapped[key] = v
    }
    return mapped
  })
  return exports.importLeadRecords(records, ctx)
}
