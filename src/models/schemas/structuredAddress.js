const mongoose = require('mongoose')
const { normalizeUsStateCode, isUsStateCodeValid } = require('../../utils/usState.util')
const { toIsoCountryCode } = require('../../services/avalara/avataxClient')

/** Shared US-style address used for AvaTax ship-to / bill-to. */
const StructuredAddressSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: '', trim: true },
    line1: { type: String, default: '', trim: true },
    line2: { type: String, default: '', trim: true },
    city: { type: String, default: '', trim: true },
    state: { type: String, default: '', trim: true },
    postalCode: { type: String, default: '', trim: true },
    country: { type: String, default: 'US', trim: true },
    lines: { type: [String], default: [] },
  },
  { _id: false }
)

const normalizeStructuredAddress = (input = {}) => {
  const country = toIsoCountryCode(input.country || 'US')
  return {
    companyName: String(input.companyName || '').trim(),
    line1: String(input.line1 || '').trim(),
    line2: String(input.line2 || '').trim(),
    city: String(input.city || '').trim(),
    state: normalizeUsStateCode(input.state, country),
    postalCode: String(input.postalCode || input.pincode || '').trim(),
    country,
    lines: Array.isArray(input.lines) ? input.lines.map((l) => String(l).trim()).filter(Boolean) : [],
  }
}

const isTaxAddressReady = (addr = {}) => {
  const a = normalizeStructuredAddress(addr)
  const usStateOk = a.country !== 'US' || isUsStateCodeValid(a.state)
  return Boolean(
    a.line1 &&
      a.city &&
      a.state &&
      a.postalCode &&
      a.country &&
      usStateOk &&
      a.postalCode.replace(/\D/g, '').length >= 5
  )
}

const buildInstallAddressFromLead = (lead = {}) => {
  if (lead.installAddress && (lead.installAddress.line1 || lead.installAddress.postalCode)) {
    return normalizeStructuredAddress(lead.installAddress)
  }
  return normalizeStructuredAddress({
    line1: lead.location || '',
    city: lead.city || '',
    state: lead.state || '',
    postalCode: lead.pincode || '',
    country: 'US',
  })
}

module.exports = {
  StructuredAddressSchema,
  normalizeStructuredAddress,
  isTaxAddressReady,
  buildInstallAddressFromLead,
}
