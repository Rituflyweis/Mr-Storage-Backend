const { VENDOR_TYPES } = require('../config/constants')

const normalizeVendorType = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return undefined
  const lower = s.toLowerCase()
  const matched = VENDOR_TYPES.find((t) => t.toLowerCase() === lower)
  return matched || lower
}

const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (Number.isNaN(n)) return undefined
  return n
}

const parseOptionalCoord = (value) => {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const normalizeVendorRequestBody = (body = {}) => {
  const b = { ...body }

  if (!b.vendorName) {
    b.vendorName =
      b.carrierName ||
      b.shipperName ||
      b.carriersName ||
      b.name ||
      b.vendor_name
  }
  if (!b.vendorCode) {
    b.vendorCode = b.shipperId || b.shippersId || b.shippersID || b.vendor_code
  }
  if (!b.contactName && b.contact_name) b.contactName = b.contact_name
  if (!b.serviceCategory && b.service_category) b.serviceCategory = b.service_category
  if (b.vendorType !== undefined) {
    b.vendorType = normalizeVendorType(b.vendorType)
  }

  const years = parseOptionalNumber(b.yearsWithCompany)
  if (years === undefined) delete b.yearsWithCompany
  else b.yearsWithCompany = years

  if (b.address && typeof b.address === 'object') {
    const addr = { ...b.address }
    if (addr.gpsCoordinates && typeof addr.gpsCoordinates === 'object') {
      addr.gpsCoordinates = {
        lat: parseOptionalCoord(addr.gpsCoordinates.lat),
        lng: parseOptionalCoord(addr.gpsCoordinates.lng),
      }
    }
    b.address = addr
  }

  if (Array.isArray(b.documents)) {
    b.documents = b.documents.filter(
      (doc) => doc && String(doc.name || '').trim() && String(doc.url || '').trim()
    )
  }

  if (b.email !== undefined && b.email !== null && String(b.email).trim() === '') {
    delete b.email
  }

  return b
}

module.exports = {
  normalizeVendorRequestBody,
  normalizeVendorType,
  parseOptionalNumber,
}
