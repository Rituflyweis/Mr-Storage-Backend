const crypto = require('crypto')
const ExcelJS = require('exceljs')
const bcrypt = require('bcryptjs')
const { parse } = require('csv-parse/sync')
const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const generateCustomerId = require('../utils/generateCustomerId')
const { syncLeadBuildings } = require('./leadBuilding.service')
const roundRobinService = require('./roundRobin.service')
const leadListSocket = require('./leadListSocket.service')

const IMPORT_EMAIL_DOMAIN = 'imports.mrstorage.internal'

const EMPTY_CELL_VALUES = new Set(['none', 'null', 'n/a', 'na', '-', '—'])

const normalizeHeader = (h) =>
  String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s/%()-]/g, '')

/** Map normalized header → canonical field key (TractIQ export + legacy CSV templates). */
const HEADER_ALIASES = {
  project: 'projectName',
  'project name': 'projectName',
  projectname: 'projectName',
  'new this week': 'newThisWeek',
  added: 'addedDate',
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
  'developer (researched)': 'developerResearched',
  'people (business role)': 'peopleBusinessRole',
  'contractor / architect': 'contractorArchitect',
  'parcel owner': 'parcelOwner',
  'project status': 'projectStatus',
  website: 'website',
}

const cellToString = (value) => {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object' && value.text) return String(value.text).trim()
  if (typeof value === 'object' && value.result != null) return String(value.result).trim()
  const s = String(value).trim()
  if (EMPTY_CELL_VALUES.has(s.toLowerCase())) return ''
  return s
}

const findHeaderRowIndex = (sheet, maxScan = 30) => {
  for (let r = 1; r <= Math.min(maxScan, sheet.rowCount); r++) {
    const row = sheet.getRow(r)
    const texts = []
    row.eachCell({ includeEmpty: false }, (cell) => {
      texts.push(normalizeHeader(cellToString(cell.value)))
    })
    const hasProject = texts.some((t) => t === 'project' || t === 'project name' || t === 'projectname')
    const tractiqHeader = hasProject && texts.some((t) => t === 'added' || t === 'new this week')
    const legacyHeader = hasProject && texts.some((t) =>
      ['email', 'customer email', 'address', 'city'].includes(t)
    )
    if (tractiqHeader || (hasProject && texts.length >= 5) || (hasProject && legacyHeader)) return r
  }
  return 1
}

const pickWorksheet = (workbook) => {
  const named = workbook.getWorksheet('Leads')
  if (named) return named
  return workbook.worksheets[0]
}

const parseExcelToRecords = async (buffer) => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = pickWorksheet(workbook)
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
    if (!record.projectName && !record.project) continue
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
    row.website?.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ||
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
    row.developerResearched ||
    row.parcelOwner ||
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
  push('Lead status', row.status)
  push('Project status', row.projectStatus)
  push('Market', row.market)
  push('Source', row.sourceLabel)
  push('Added', row.addedDate)
  push('New this week', row.newThisWeek)
  push('County', row.county)
  push('Owner/LLC', row.ownerLlc)
  push('Developer (researched)', row.developerResearched)
  push('Parcel owner', row.parcelOwner)
  push('Contractor/architect', row.contractorArchitect)
  push('People (business role)', row.peopleBusinessRole)
  push('Link', row.link)
  push('Website', row.website)
  push('Map', row.mapLink)
  push('Street View', row.streetView)
  push('Lat/Lng', row.latitude && row.longitude ? `${row.latitude}, ${row.longitude}` : '')
  push('How real', row.how_real)
  push('Why', row.why)
  push('TractIQ status', row.tractiq_status)
  push('Due diligence notes', row['due-diligence_notes'])
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

const buildDuplicateKey = (projectName, city, state, postalCode) =>
  [
    (projectName || '').trim().toLowerCase(),
    (city || '').trim().toLowerCase(),
    (state || '').trim().toUpperCase().slice(0, 2),
    String(postalCode || '').trim(),
  ].join('|')

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

exports.buildDuplicateKey = buildDuplicateKey

const importOneRow = async (row, ctx) => {
  const projectName = (row.projectName || row.project || '').trim()
  if (!projectName) {
    return { status: 'skipped', reason: 'missing projectName' }
  }

  const city = (row.city || '').trim()
  const state = (row.state || '').trim().toUpperCase().slice(0, 2)
  const postalCode = String(row.postalCode || row.zip || row.pincode || '').trim()
  const dupKey = buildDuplicateKey(projectName, city, state, postalCode)
  if (!ctx.duplicateKeys) ctx.duplicateKeys = new Set()
  if (ctx.duplicateKeys.has(dupKey)) {
    return { status: 'skipped', reason: 'duplicate project' }
  }
  const dup = await resolveDuplicateLead(projectName, city, state, postalCode)
  if (dup) {
    ctx.duplicateKeys.add(dupKey)
    return { status: 'skipped', reason: 'duplicate project', leadId: dup._id }
  }
  ctx.duplicateKeys.add(dupKey)

  const { email, phone, name } = pickCustomerIdentity(row)
  if (!ctx.customerCache) ctx.customerCache = new Map()
  let customer = ctx.customerCache.get(email)
  if (!customer) {
    customer = await Customer.findOne({ email })
    if (!customer) {
      const existingPhone = await Customer.findOne({ 'phone.number': phone })
      if (existingPhone) customer = existingPhone
    }
    if (customer) ctx.customerCache.set(email, customer)
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
    ctx.customerCache.set(email, customer)
  }

  const useRoundRobin = ctx.useRoundRobin !== false

  const leadPayload = {
    customerId: customer._id,
    projectName,
    buildingType: inferBuildingType(row),
    location: buildLocationString(row),
    city,
    state,
    pincode: postalCode,
    sqft: row.sqft != null ? String(row.sqft) : '',
    quoteValue: parseNumber(row.quoteValue) ?? 0,
    notes: buildImportNotes(row),
    source: 'import',
    lifecycleStatus: 'initial_contact',
    assignedSales: useRoundRobin ? null : ctx.assignSalesUserId || null,
    isHandedToSales: useRoundRobin ? false : Boolean(ctx.assignSalesUserId),
  }

  if (row.width) leadPayload.width = parseNumber(row.width)
  if (row.length) leadPayload.length = parseNumber(row.length)
  if (row.height) leadPayload.height = parseNumber(row.height)
  if (row.roofStyle) leadPayload.roofStyle = row.roofStyle
  if (row.roofPitch) leadPayload.roofPitch = row.roofPitch

  if (!useRoundRobin && ctx.assignSalesUserId) {
    leadPayload.assigningHistory = [{
      employeeId: ctx.assignSalesUserId,
      method: 'manual',
      assignedBy: ctx.assignSalesUserId,
      assignedAt: new Date(),
    }]
  }

  let lead
  try {
    lead = await Lead.create(leadPayload)
    await syncLeadBuildings(lead, { createdBy: ctx.createdByUserId })
    if (useRoundRobin) {
      const silent = ctx.bulkImport === true
      const employeeId = await roundRobinService.assignNextSales(lead._id, customer._id, { silent })
      if (employeeId && silent) {
        if (!ctx.assignCountByUser) ctx.assignCountByUser = new Map()
        const key = String(employeeId)
        ctx.assignCountByUser.set(key, (ctx.assignCountByUser.get(key) || 0) + 1)
      }
    }
  } catch (err) {
    ctx.duplicateKeys.delete(dupKey)
    throw err
  }

  return { status: 'created', leadId: lead._id, jobId: lead.jobId }
}

exports.parseExcelToRecords = parseExcelToRecords
exports.parseCsvToRecords = parseCsvToRecords

const applyRowOutcome = (results, rowIndex, outcome, maxErrors) => {
  if (outcome.status === 'created') results.created++
  else results.skipped++
  if (outcome.reason && outcome.status === 'skipped' && results.errors.length < maxErrors) {
    results.errors.push({ row: rowIndex + 1, reason: outcome.reason, leadId: outcome.leadId })
  }
}

/**
 * @param {object[]} records - normalized row objects
 * @param {object} ctx - { createdByUserId, useRoundRobin?, assignSalesUserId?, duplicateKeys?, customerCache? }
 * @param {object} opts - { concurrency?, onProgress?, maxErrors? }
 */
exports.importLeadRecords = async (records, ctx = {}, opts = {}) => {
  const concurrency = Math.min(Math.max(opts.concurrency || 1, 1), 12)
  const maxErrors = opts.maxErrors ?? 150
  const onProgress = opts.onProgress

  ctx.duplicateKeys = ctx.duplicateKeys || new Set()
  ctx.customerCache = ctx.customerCache || new Map()

  const results = {
    created: 0,
    skipped: 0,
    errors: [],
    totalRows: records.length,
    processedRows: 0,
  }

  for (let start = 0; start < records.length; start += concurrency) {
    const batch = records.slice(start, start + concurrency)
    const batchOutcomes = await Promise.all(
      batch.map(async (row, offset) => {
        const i = start + offset
        try {
          const outcome = await importOneRow(row, ctx)
          return { i, outcome, err: null }
        } catch (err) {
          return { i, outcome: null, err }
        }
      })
    )

    for (const { i, outcome, err } of batchOutcomes) {
      if (err) {
        if (results.errors.length < maxErrors) {
          results.errors.push({ row: i + 1, reason: err.message })
        }
        results.skipped++
      } else {
        applyRowOutcome(results, i, outcome, maxErrors)
      }
      results.processedRows++
    }

    if (onProgress) await onProgress({ ...results })
  }

  if (onProgress) await onProgress({ ...results })

  if (ctx.bulkImport && results.created > 0) {
    await leadListSocket.emitBulkLeadImportComplete({
      totalCreated: results.created,
      assignmentCounts: ctx.assignCountByUser || new Map(),
      initiatedByUserId: ctx.createdByUserId,
    })
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
