const {
  INVOICE_COMPANY_NAME,
  INVOICE_COMPANY_ADDRESS,
  INVOICE_COMPANY_EMAIL,
  INVOICE_COMPANY_WEBSITE,
  INVOICE_LOGO_URL,
  INVOICE_BANK_NAME,
  INVOICE_BANK_ACCOUNT_NAME,
  INVOICE_BANK_ACCOUNT_NUMBER,
  INVOICE_BANK_ROUTING_NUMBER,
  INVOICE_BANK_SWIFT,
  INVOICE_BANK_IBAN,
  INVOICE_BANK_BRANCH_ADDRESS,
  INVOICE_BANK_PAYMENT_INSTRUCTIONS,
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

const getDefaultBankDetails = () => ({
  bankName: INVOICE_BANK_NAME || '',
  accountName: INVOICE_BANK_ACCOUNT_NAME || '',
  accountNumber: INVOICE_BANK_ACCOUNT_NUMBER || '',
  routingNumber: INVOICE_BANK_ROUTING_NUMBER || '',
  swiftCode: INVOICE_BANK_SWIFT || '',
  iban: INVOICE_BANK_IBAN || '',
  branchAddress: INVOICE_BANK_BRANCH_ADDRESS || '',
  paymentInstructions: INVOICE_BANK_PAYMENT_INSTRUCTIONS || '',
})

module.exports = {
  getInvoiceCompany,
  getDefaultBankDetails,
}
