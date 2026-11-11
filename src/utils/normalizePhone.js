/**
 * Normalize phone values for Customer.phone.number lookup.
 * Chat stores digits only (e.g. "9876543210"); Twilio From is often E.164 ("+919876543210").
 */
const digitsOnly = (value) => String(value || '').replace(/\D/g, '')

/**
 * @param {string} raw - Twilio From or user input
 * @param {{ countryCode?: string }} [opts]
 * @returns {{ e164Digits: string, nationalNumber: string, lookupCandidates: string[] }}
 */
const normalizePhoneForLookup = (raw, opts = {}) => {
  const e164Digits = digitsOnly(raw)
  const countryDigits = digitsOnly(opts.countryCode || '')

  let nationalNumber = e164Digits
  if (countryDigits && e164Digits.startsWith(countryDigits) && e164Digits.length > countryDigits.length) {
    nationalNumber = e164Digits.slice(countryDigits.length)
  }

  // Common US/CA: strip leading 1 when we have 11 digits
  if (nationalNumber.length === 11 && nationalNumber.startsWith('1')) {
    nationalNumber = nationalNumber.slice(1)
  }
  // India-style: 12 digits starting with 91
  if (nationalNumber.length === 12 && nationalNumber.startsWith('91')) {
    nationalNumber = nationalNumber.slice(2)
  }

  const lookupCandidates = [...new Set([e164Digits, nationalNumber, raw && String(raw).trim()].filter(Boolean))]

  return { e164Digits, nationalNumber, lookupCandidates }
}

module.exports = {
  digitsOnly,
  normalizePhoneForLookup,
}
