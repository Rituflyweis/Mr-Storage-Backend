const fs = require('fs')
const path = require('path')

const BRANDING_DIR = path.join(__dirname, '../../static/branding')

const LOCAL_INVOICE_LOGOS = {
  SBD: path.join(BRANDING_DIR, 'sbd-invoice-logo.png'),
}

/** SendGrid / Gmail inline image reference (see `<img src="cid:…">`). */
const INVOICE_BRAND_LOGO_CID = 'mr-invoice-brand-logo'

let dataUriCache = {}

const readLocalInvoiceLogoBuffer = (companyKey) => {
  const key = String(companyKey || '').toUpperCase()
  const filePath = LOCAL_INVOICE_LOGOS[key]
  if (!filePath || !fs.existsSync(filePath)) return null
  return fs.readFileSync(filePath)
}

/** Inline PNG for invoice PDF HTML (Puppeteer; no CID). */
const getLocalInvoiceLogoDataUri = (companyKey) => {
  const key = String(companyKey || '').toUpperCase()
  if (dataUriCache[key]) return dataUriCache[key]
  const buf = readLocalInvoiceLogoBuffer(key)
  if (!buf) return null
  dataUriCache[key] = `data:image/png;base64,${buf.toString('base64')}`
  return dataUriCache[key]
}

module.exports = {
  INVOICE_BRAND_LOGO_CID,
  getLocalInvoiceLogoDataUri,
  readLocalInvoiceLogoBuffer,
  LOCAL_INVOICE_LOGOS,
}
