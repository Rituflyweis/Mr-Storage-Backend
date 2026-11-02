const fs = require('fs')
const path = require('path')

const BRANDING_DIR = path.join(__dirname, '../../static/branding')

const LOCAL_INVOICE_LOGOS = {
  SBD: path.join(BRANDING_DIR, 'sbd-invoice-logo.png'),
}

let cache = {}

/** Inline PNG for invoice email/PDF (Gmail-safe; no hotlink). */
const getLocalInvoiceLogoDataUri = (companyKey) => {
  const key = String(companyKey || '').toUpperCase()
  const filePath = LOCAL_INVOICE_LOGOS[key]
  if (!filePath || !fs.existsSync(filePath)) return null
  if (cache[key]) return cache[key]
  const b64 = fs.readFileSync(filePath).toString('base64')
  cache[key] = `data:image/png;base64,${b64}`
  return cache[key]
}

module.exports = {
  getLocalInvoiceLogoDataUri,
  LOCAL_INVOICE_LOGOS,
}
