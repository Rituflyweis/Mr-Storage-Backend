const avatax = require('../services/avalara/avataxClient')
const { getInvoiceCompany } = require('../config/invoiceCompany')
const {
  normalizeStructuredAddress,
  isTaxAddressReady,
} = require('../models/schemas/structuredAddress')

const parseCityStateLine = (line = '') => {
  const text = String(line).trim()
  const comma = text.match(/^(.+?),\s*([A-Za-z]{2})\s*$/)
  if (comma) {
    return { city: comma[1].trim(), state: comma[2].toUpperCase() }
  }
  return { city: text, state: '' }
}

/** Parse invoice PDF company address lines into a structured tax address. */
const structuredAddressFromCompanyLines = (lines = []) => {
  if (!lines.length) return null
  const line1 = lines[0] || ''
  let city = ''
  let state = ''
  let postalCode = ''
  let country = 'US'

  if (lines.length >= 4) {
    const cs = parseCityStateLine(lines[1])
    city = cs.city
    state = cs.state
    postalCode = String(lines[2] || '').trim()
    country = avatax.toIsoCountryCode(lines[lines.length - 1])
  } else if (lines.length === 3) {
    const cs = parseCityStateLine(lines[1])
    city = cs.city
    state = cs.state
    postalCode = String(lines[2] || '').trim()
  } else if (lines.length === 2) {
    const cs = parseCityStateLine(lines[1])
    city = cs.city
    state = cs.state
  }

  return normalizeStructuredAddress({
    line1,
    city,
    state,
    postalCode,
    country,
  })
}

const addressFromEnv = () => {
  if (!process.env.AVATAX_SHIP_FROM_LINE1) return null
  return normalizeStructuredAddress({
    line1: process.env.AVATAX_SHIP_FROM_LINE1 || '',
    line2: process.env.AVATAX_SHIP_FROM_LINE2 || '',
    city: process.env.AVATAX_SHIP_FROM_CITY || '',
    state: process.env.AVATAX_SHIP_FROM_STATE || '',
    postalCode: process.env.AVATAX_SHIP_FROM_POSTAL || '',
    country: process.env.AVATAX_SHIP_FROM_COUNTRY || 'US',
  })
}

const addressFromInvoiceBilling = (invoice = {}) => {
  const billing = invoice.billingAddress
  if (!billing?.line1) return null
  return normalizeStructuredAddress({
    line1: billing.line1,
    line2: billing.line2 || '',
    city: billing.city,
    state: billing.state,
    postalCode: billing.postalCode,
    country: billing.country || 'US',
  })
}

/** Company origin for AvaTax — env, then structured billing, then parsed company lines. */
const resolveShipFromAddress = (invoice = {}) => {
  const candidates = [
    addressFromEnv(),
    addressFromInvoiceBilling(invoice),
    structuredAddressFromCompanyLines(getInvoiceCompany().addressLines || []),
  ].filter(Boolean)

  for (const addr of candidates) {
    if (isTaxAddressReady(addr)) return addr
  }
  return candidates[0] || normalizeStructuredAddress({})
}

const getShipFromTaxReadiness = (invoice = {}) => {
  const address = resolveShipFromAddress(invoice)
  if (isTaxAddressReady(address)) {
    return { ready: true, address }
  }
  const envConfigured = Boolean(process.env.AVATAX_SHIP_FROM_LINE1)
  return {
    ready: false,
    address,
    error: envConfigured
      ? 'AVATAX_SHIP_FROM_* is set but incomplete (line1, city, state, postalCode, country required)'
      : 'AvaTax ship-from origin is not configured. Set AVATAX_SHIP_FROM_LINE1, _CITY, _STATE, _POSTAL (and optional _COUNTRY=US) on the server, or use a structured invoice billing address with city/state/ZIP.',
  }
}

const toAvaShipFrom = (invoice) => {
  const { address } = getShipFromTaxReadiness(invoice)
  return avatax.toAvaAddress(address)
}

module.exports = {
  resolveShipFromAddress,
  getShipFromTaxReadiness,
  structuredAddressFromCompanyLines,
  toAvaShipFrom,
}
