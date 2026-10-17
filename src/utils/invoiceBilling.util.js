const {
  getInvoiceCompany,
  getDefaultBankDetails: getCompanyDefaultBankDetails,
} = require('../config/invoiceCompany')

const emptyAddress = () => ({
  companyName: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  lines: [],
})

const emptyBankDetails = () => ({
  bankName: '',
  accountName: '',
  accountNumber: '',
  routingNumber: '',
  swiftCode: '',
  iban: '',
  branchAddress: '',
  paymentInstructions: '',
})

const normalizeAddress = (input) => {
  if (!input || typeof input !== 'object') return emptyAddress()
  const lines = Array.isArray(input.lines)
    ? input.lines.map((l) => String(l || '').trim()).filter(Boolean)
    : []
  return {
    companyName: String(input.companyName || '').trim(),
    line1: String(input.line1 || '').trim(),
    line2: String(input.line2 || '').trim(),
    city: String(input.city || '').trim(),
    state: String(input.state || '').trim(),
    postalCode: String(input.postalCode || '').trim(),
    country: String(input.country || '').trim(),
    lines,
  }
}

const normalizeBankDetails = (input) => {
  if (!input || typeof input !== 'object') return emptyBankDetails()
  return {
    bankName: String(input.bankName || '').trim(),
    accountName: String(input.accountName || '').trim(),
    accountNumber: String(input.accountNumber || '').trim(),
    routingNumber: String(input.routingNumber || '').trim(),
    swiftCode: String(input.swiftCode || '').trim(),
    iban: String(input.iban || '').trim(),
    branchAddress: String(input.branchAddress || '').trim(),
    paymentInstructions: String(input.paymentInstructions || '').trim(),
  }
}

const addressHasContent = (addr) => {
  if (!addr) return false
  return Boolean(
    addr.companyName ||
      addr.line1 ||
      addr.line2 ||
      addr.city ||
      addr.state ||
      addr.postalCode ||
      addr.country ||
      (addr.lines && addr.lines.length)
  )
}

const bankHasContent = (bank) => {
  if (!bank) return false
  return Boolean(
    bank.bankName ||
      bank.accountName ||
      bank.accountNumber ||
      bank.routingNumber ||
      bank.swiftCode ||
      bank.iban ||
      bank.branchAddress ||
      bank.paymentInstructions
  )
}

exports.getDefaultBillingAddress = () => {
  const company = getInvoiceCompany()
  const lines = company.addressLines || []
  return normalizeAddress({
    companyName: company.name,
    lines,
    line1: lines[0] || '',
    line2: lines[1] || '',
    city: lines[2] || '',
    state: '',
    postalCode: '',
    country: lines[lines.length - 1] || '',
  })
}

exports.getDefaultBankDetails = () => normalizeBankDetails(getCompanyDefaultBankDetails())

exports.applyInvoiceBillingFields = (target, body = {}) => {
  if (body.billingAddress !== undefined) {
    target.billingAddress = normalizeAddress(body.billingAddress)
  }
  if (body.recipientAddress !== undefined) {
    target.recipientAddress = normalizeAddress(body.recipientAddress)
  }
  if (body.bankDetails !== undefined) {
    target.bankDetails = normalizeBankDetails(body.bankDetails)
  }
}

exports.ensureInvoiceBillingDefaultsOnCreate = (target, { invoiceType } = {}) => {
  if (!addressHasContent(target.billingAddress)) {
    target.billingAddress = exports.getDefaultBillingAddress()
  } else {
    target.billingAddress = normalizeAddress(target.billingAddress)
  }
  if (!bankHasContent(target.bankDetails)) {
    target.bankDetails = exports.getDefaultBankDetails()
  } else {
    target.bankDetails = normalizeBankDetails(target.bankDetails)
  }
  if (target.recipientAddress !== undefined) {
    target.recipientAddress = normalizeAddress(target.recipientAddress)
  }
  if (invoiceType !== 'customer' && !addressHasContent(target.recipientAddress)) {
    target.recipientAddress = emptyAddress()
  }
}

exports.resolveInvoiceBillingForResponse = (invoiceLike) => {
  const billingAddress = addressHasContent(invoiceLike?.billingAddress)
    ? normalizeAddress(invoiceLike.billingAddress)
    : exports.getDefaultBillingAddress()
  const bankDetails = bankHasContent(invoiceLike?.bankDetails)
    ? normalizeBankDetails(invoiceLike.bankDetails)
    : exports.getDefaultBankDetails()
  const recipientAddress = normalizeAddress(invoiceLike?.recipientAddress)
  return { billingAddress, bankDetails, recipientAddress }
}

exports.formatAddressLines = (addr) => {
  const a = normalizeAddress(addr)
  if (a.lines.length) return a.lines
  return [a.companyName, a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), a.postalCode, a.country]
    .filter(Boolean)
}

exports.formatBankDetailsLines = (bank) => {
  const b = normalizeBankDetails(bank)
  const lines = []
  if (b.bankName) lines.push(b.bankName)
  if (b.accountName) lines.push(`Account: ${b.accountName}`)
  if (b.accountNumber) lines.push(`Account #: ${b.accountNumber}`)
  if (b.routingNumber) lines.push(`Routing: ${b.routingNumber}`)
  if (b.swiftCode) lines.push(`SWIFT: ${b.swiftCode}`)
  if (b.iban) lines.push(`IBAN: ${b.iban}`)
  if (b.branchAddress) lines.push(b.branchAddress)
  if (b.paymentInstructions) lines.push(b.paymentInstructions)
  return lines
}

exports.pickBillingFieldsForListRow = (invoiceLike) => {
  const resolved = exports.resolveInvoiceBillingForResponse(invoiceLike)
  return {
    billingAddress: resolved.billingAddress,
    bankDetails: resolved.bankDetails,
    recipientAddress: resolved.recipientAddress,
  }
}
