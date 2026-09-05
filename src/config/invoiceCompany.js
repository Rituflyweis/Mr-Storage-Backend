const {
  INVOICE_COMPANY_NAME,
  INVOICE_COMPANY_ADDRESS,
  INVOICE_COMPANY_EMAIL,
  INVOICE_COMPANY_WEBSITE,
  INVOICE_LOGO_URL,
} = require('./env')

const DEFAULT_ADDRESS_LINES = [
  '1851 Madison Ave Suite 300',
  'Council Bluffs, IA',
  '51503',
  'United States',
]

const parseAddressLines = (raw) => {
  if (!raw || !String(raw).trim()) return DEFAULT_ADDRESS_LINES
  return String(raw)
    .split('|')
    .map((line) => line.trim())
    .filter(Boolean)
}

const getInvoiceCompany = () => ({
  name: INVOICE_COMPANY_NAME || 'STEEL BUILDING DEPOT',
  addressLines: parseAddressLines(INVOICE_COMPANY_ADDRESS),
  email: INVOICE_COMPANY_EMAIL || 'info@steelbuildingdepot.com',
  website: INVOICE_COMPANY_WEBSITE || 'www.steelbuildingdepot.com',
  logoUrl: INVOICE_LOGO_URL || '',
})

module.exports = {
  getInvoiceCompany,
}
