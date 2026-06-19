const nodemailer = require('nodemailer')
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = require('../../config/env')
const { computeInvoiceDueDate } = require('../../utils/invoiceDueDate')
const path = require('path')
const fs = require('fs')
const { generateInvoicePdf } = require('./generateInvoiceHelper')
const {
  formatExceptionsForEmailHtml,
  formatExceptionsForEmailText,
} = require('../../utils/vendorUpload.util')
const {
  formatFreightLoadDetailsHtml,
  formatFreightLoadDetailsText,
} = require('../plant/freightLoadDetails.service')


const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  family: 4,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
})

const isSmtpConfigured = () => Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS)

const loadTemplate = (templateName) => {
  const filePath = path.join(__dirname, 'templates', `${templateName}.html`)
  return fs.readFileSync(filePath, 'utf-8')
}

/**
 * Replace {{KEY}} placeholders in template with values object
 */
const fillTemplate = (template, values = {}) => {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '')
}

const escapeHtml = (str) => {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const formatInvoiceMoney = (value) => {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const formatInvoiceDate = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toDateString()
}

const normalizeInvoiceValueType = (type) =>
  String(type || 'amount').trim().toLowerCase() === 'percentage' ? 'percentage' : 'amount'

const formatInvoiceRateCell = (li) => {
  const effectiveRate = li.effectiveRate != null ? li.effectiveRate : li.rate
  return formatInvoiceMoney(effectiveRate)
}

const formatInvoiceTaxCell = (li) => {
  const taxType = normalizeInvoiceValueType(li.taxType)
  const taxInput = li.tax
  const taxAmount =
    li.taxAmount != null
      ? li.taxAmount
      : taxType === 'amount'
        ? taxInput
        : null

  if (taxType === 'percentage' && taxInput != null && taxInput !== '') {
    const amountLine = taxAmount != null ? formatInvoiceMoney(taxAmount) : '—'
    return amountLine
  }

  return formatInvoiceMoney(taxAmount != null ? taxAmount : taxInput)
}

const buildInvoiceLineItemsRows = (lineItems = []) => {
  if (!lineItems.length) {
    return '<tr><td colspan="6" style="text-align:center;color:#888;padding:16px">No line items on this invoice</td></tr>'
  }

  return lineItems
    .map((li, index) => {
      const description =
        (li.description && String(li.description).trim())
          ? escapeHtml(li.description)
          : (li.items || []).filter(Boolean).map(escapeHtml).join('<br/>') || '—'
      const images = (li.images || []).filter(Boolean)
      const imagesHtml = images.length
        ? `<div style="margin-top:6px;font-size:11px">${images
            .map(
              (url, i) =>
                `<a href="${escapeHtml(url)}" style="color:#1a2e4a" target="_blank" rel="noopener">Image ${i + 1}</a>`
            )
            .join(' · ')}</div>`
        : ''

      return `<tr>
        <td style="padding:10px 6px;border-bottom:1px solid #eee;vertical-align:top;color:#666">${index + 1}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;vertical-align:top">${description}${imagesHtml}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatInvoiceRateCell(li)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;vertical-align:top">${li.quantity ?? '—'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatInvoiceTaxCell(li)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;vertical-align:top">${formatInvoiceMoney(li.total)}</td>
      </tr>`
    })
    .join('')
}

const buildInvoiceTotalsRows = (invoice) => {
  const rows = [
    ['Subtotal', invoice.subtotal, false],
    ['Discount', invoice.discount, true],
    ['Tax', invoice.tax, false],
    ['Deposit', invoice.depositAmount, false],
    ['Total due', invoice.totalAmount, false],
  ]

  return rows
    .map(([label, amount, isDiscount], i) => {
      const isGrand = i === rows.length - 1
      const rowClass = isGrand ? ' class="grand"' : ''
      const labelStyle = isGrand
        ? 'text-align:right;color:#1a2e4a;font-weight:700;padding:10px 8px 6px'
        : 'text-align:right;color:#666;padding:6px 8px'
      const valueStyle = isGrand
        ? 'text-align:right;font-weight:700;font-size:18px;color:#1a2e4a;width:120px;padding:10px 8px 6px'
        : 'text-align:right;font-weight:600;width:120px;padding:6px 8px'
      const displayAmount =
        isDiscount && amount != null && Number(amount) !== 0
          ? `−${formatInvoiceMoney(amount)}`
          : formatInvoiceMoney(amount)
      return `<tr${rowClass}>
          <td style="${labelStyle}">${label}</td>
          <td style="${valueStyle}">${displayAmount}</td>
        </tr>`
    })
    .join('')
}

const buildInvoicePaymentTerms = (invoice) => {
  if (invoice.daysToPay != null && invoice.daysToPay !== '') {
    return `${invoice.daysToPay} days from invoice date`
  }
  if (invoice.dueDate) {
    return `Payment due by ${formatInvoiceDate(invoice.dueDate)}`
  }
  return 'As agreed'
}

const resolveInvoiceDueDate = (invoice) =>
  invoice.dueDate || computeInvoiceDueDate(invoice.date, invoice.daysToPay)

const buildInvoiceDueDate = (invoice) => formatInvoiceDate(resolveInvoiceDueDate(invoice))

const sendQuotation = async ({ toEmail, customerName, quotation }) => {
  const template = loadTemplate('quotation')
  const html = fillTemplate(template, {
    CUSTOMER_NAME: customerName,
    BUILDING_TYPE: quotation.buildingType,
    QUOTE_NUMBER: quotation.quoteNumber || '',
    BASE_PRICE: quotation.basePrice?.toLocaleString() || '',
    FINAL_PRICE: quotation.finalPrice?.toLocaleString() || '',
    TOTAL_COGS: quotation.totalCOGS?.toLocaleString() || '',
    MARKUP_PERCENT: quotation.markupPercent || '',
    MARKUP_VALUE: quotation.markupValue?.toLocaleString() || '',
    PSF: quotation.psf?.toFixed(2) || '',
    CURRENCY: quotation.currency || 'USD',
    LOCATION: quotation.location || '',
    VALID_TILL: quotation.validTill ? new Date(quotation.validTill).toDateString() : 'N/A',
    COMPANY_NAME: quotation.companyName || '',
    ESTIMATED_DELIVERY: quotation.estimatedDelivery || '',
    SPECIAL_NOTE: quotation.specialNote || '',
    CLIENT_NOTES: quotation.clientNotes || '',
    PAYMENT_TERMS: quotation.paymentTerms || '',
    PROPOSAL_DATE: quotation.proposalDate ? new Date(quotation.proposalDate).toDateString() : '',
    PREPARED_BY: quotation.preparedBy || '',
    WIDTH: quotation.width || '',
    LENGTH: quotation.length || '',
    HEIGHT: quotation.height || '',
    ROOF_STYLE: quotation.roofStyle || '',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Your Quotation for ${quotation.buildingType || 'Construction Project'}`,
    html,
  })
}


const sendInvoice = async ({ toEmail, customerName, invoice }) => {
  const inv = invoice?.toObject ? invoice.toObject() : invoice
  const template = loadTemplate('invoice')
  const hasDeposit = inv.depositAmount != null && Number(inv.depositAmount) !== 0
  const html = fillTemplate(template, {
    CUSTOMER_NAME: escapeHtml(customerName),
    INVOICE_NUMBER: escapeHtml(inv.invoiceNumber || '—'),
    DATE: formatInvoiceDate(inv.date),
    DUE_DATE: buildInvoiceDueDate(inv),
    PAYMENT_TERMS: buildInvoicePaymentTerms(inv),
    DAYS_TO_PAY: inv.daysToPay != null && inv.daysToPay !== '' ? String(inv.daysToPay) : '—',
    PO_NUMBER: escapeHtml(inv.poNumber || '—'),
    SUBTOTAL: formatInvoiceMoney(inv.subtotal),
    MARKUP_TOTAL: formatInvoiceMoney(inv.markupTotal),
    TAX: formatInvoiceMoney(inv.tax),
    DISCOUNT: formatInvoiceMoney(inv.discount),
    DEPOSIT_AMOUNT: formatInvoiceMoney(inv.depositAmount),
    TOTAL_AMOUNT: formatInvoiceMoney(inv.totalAmount),
    LINE_ITEMS: buildInvoiceLineItemsRows(inv.lineItems),
    TOTALS_ROWS: buildInvoiceTotalsRows(inv),
    DEPOSIT_NOTE: hasDeposit ? ' (deposit shown separately)' : '',
  })

  // Generate PDF from the same HTML used for the email body
  const pdfBuffer = await generateInvoicePdf(html)
  const invoiceFilename = `Invoice-${inv.invoiceNumber || 'document'}.pdf`

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Invoice ${inv.invoiceNumber || ''}`,
    html,
    attachments: [
      {
        filename: invoiceFilename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })
}

const sendOtp = async ({ toEmail, name, otp, expiresInMinutes = 10 }) => {
  const template = loadTemplate('otp')
  const html = fillTemplate(template, {
    NAME: name,
    OTP: otp,
    EXPIRES_IN: expiresInMinutes,
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: 'Your Password Reset OTP',
    html,
  })
}

const sendEmployeeCredentials = async ({ toEmail, name, role, tempPassword }) => {
  const template = loadTemplate('employee-credentials')
  const html = fillTemplate(template, {
    EMPLOYEE_NAME: name,
    ROLE: role.charAt(0).toUpperCase() + role.slice(1),
    EMAIL: toEmail,
    TEMP_PASSWORD: tempPassword,
    LOGIN_URL: (process.env.APP_URL || '') + '/login',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: 'Your CRM Login Credentials',
    html,
  })
}

const sendConsolidatedBOMToVendor = async ({
  toEmail,
  vendorName,
  projectName,
  jobId,
  bomFileUrl,
  uploadUrl,
}) => {
  const template = loadTemplate('vendor-consolidated-bom')
  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || 'Vendor',
    PROJECT_NAME: projectName || '',
    JOB_ID: jobId || '',
    BOM_FILE_URL: bomFileUrl || '',
    UPLOAD_URL: uploadUrl || '',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Consolidated BOM for ${projectName || 'Project'}`,
    html,
  })
}

const sendShipperApprovalEmail = async ({ toEmail, vendorName, projectName, jobId }) => {
  const template = loadTemplate('vendor-shipper-approved')
  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || 'Vendor',
    PROJECT_NAME: projectName || '',
    JOB_ID: jobId || '',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Vendor Selection Update: ${projectName || 'Project'}`,
    html,
  })
}

const sendShipperRejectionEmail = async ({ toEmail, vendorName, projectName, jobId }) => {
  const template = loadTemplate('vendor-shipper-rejected')
  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || 'Vendor',
    PROJECT_NAME: projectName || '',
    JOB_ID: jobId || '',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Vendor Selection Update: ${projectName || 'Project'}`,
    html,
  })
}

const sendShipperResubmitRequestEmail = async ({
  toEmail,
  vendorName,
  projectName,
  jobId,
  note,
  uploadUrl,
  exceptionSummary = null,
}) => {
  const template = loadTemplate('vendor-shipper-resubmit')
  const summary = exceptionSummary?.comparisonSummary
  const exceptionLines = []
  if (summary) {
    if (summary.missingItems) exceptionLines.push(`${summary.missingItems} missing item(s)`)
    if (summary.extraItems) exceptionLines.push(`${summary.extraItems} extra item(s)`)
    if (summary.qtyMismatches) exceptionLines.push(`${summary.qtyMismatches} quantity mismatch(es)`)
    if (summary.lengthMismatches) exceptionLines.push(`${summary.lengthMismatches} length mismatch(es)`)
    if (summary.ambiguousMatches) exceptionLines.push(`${summary.ambiguousMatches} ambiguous match(es)`)
    if (summary.partMismatches) exceptionLines.push(`${summary.partMismatches} part mismatch(es)`)
  }
  const exceptionSummaryText = exceptionLines.length
    ? exceptionLines.join('; ')
    : 'See upload page for comparison details.'
  const exceptionDetailsHtml = formatExceptionsForEmailHtml(exceptionSummary)
  const exceptionDetailsText = formatExceptionsForEmailText(exceptionSummary)

  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || 'Vendor',
    PROJECT_NAME: projectName || '',
    JOB_ID: jobId || '',
    NOTE: note || '',
    UPLOAD_URL: uploadUrl || '',
    EXCEPTION_SUMMARY: exceptionSummaryText,
    EXCEPTION_DETAILS_HTML: exceptionDetailsHtml,
    PRIOR_QUOTE_VALUE:
      exceptionSummary?.priorQuoteValue != null ? String(exceptionSummary.priorQuoteValue) : 'N/A',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Action Required: Updated Quote Needed for ${projectName || 'Project'}`,
    html,
    text: [
      `Hello ${vendorName || 'Vendor'},`,
      '',
      `Project: ${projectName || ''}`,
      `Job ID: ${jobId || ''}`,
      '',
      `Plant note: ${note || ''}`,
      `Previous quote amount: ${exceptionSummary?.priorQuoteValue ?? 'N/A'}`,
      '',
      exceptionSummaryText,
      '',
      exceptionDetailsText,
      '',
      `Upload revised quote: ${uploadUrl || ''}`,
    ].join('\n'),
  })
}

const sendFreightBidRequestEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
  bidDeadline,
  bidUrl,
  loadDescription,
  loadWeight,
  pickupLocation,
  deliveryLocation,
  bundles = [],
  packingLists = [],
}) => {
  const safeCarrier = escapeHtml(carrierName || 'Carrier')
  const safeProject = escapeHtml(projectName || '')
  const safeJobId = escapeHtml(jobId || '')
  const safeDeliveryNumber = escapeHtml(deliveryNumber || '')
  const safeBidUrl = escapeHtml(bidUrl || '')
  const safeLoadDescription = escapeHtml(loadDescription || '')
  const safePickup = escapeHtml(pickupLocation || '')
  const safeDelivery = escapeHtml(deliveryLocation || '')
  const safeWeight = loadWeight != null ? `${formatInvoiceMoney(loadWeight)} lbs` : '—'
  const safeDeadline = formatInvoiceDate(bidDeadline)
  const loadDetailsHtml = formatFreightLoadDetailsHtml({ bundles, packingLists })
  const loadDetailsText = formatFreightLoadDetailsText({ bundles, packingLists })

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Freight Bid Request</h2>
      <p>Hi ${safeCarrier},</p>
      <p>You have received a freight bid request for the below project:</p>
      <ul>
        <li><strong>Project:</strong> ${safeProject}</li>
        <li><strong>Job ID:</strong> ${safeJobId}</li>
        <li><strong>Freight Request #:</strong> ${safeDeliveryNumber}</li>
        <li><strong>Load description:</strong> ${safeLoadDescription}</li>
        <li><strong>Load weight:</strong> ${safeWeight}</li>
        <li><strong>Pickup location:</strong> ${safePickup}</li>
        <li><strong>Delivery location:</strong> ${safeDelivery}</li>
        <li><strong>Bid deadline:</strong> ${safeDeadline}</li>
      </ul>
      ${loadDetailsHtml}
      <p>
        Submit your bid here:<br/>
        <a href="${safeBidUrl}" target="_blank" rel="noopener">${safeBidUrl}</a>
      </p>
      <p>Please submit before deadline. Late bids are automatically blocked.</p>
    </div>
  `

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Freight Bid Request: ${projectName || 'Project'}${deliveryNumber ? ` (${deliveryNumber})` : ''}`,
    html,
    text: [
      `Hi ${carrierName || 'Carrier'},`,
      '',
      'You have received a freight bid request:',
      `Project: ${projectName || ''}`,
      `Job ID: ${jobId || ''}`,
      `Freight Request #: ${deliveryNumber || ''}`,
      `Load description: ${loadDescription || ''}`,
      `Load weight: ${loadWeight != null ? `${loadWeight} lbs` : '—'}`,
      `Pickup: ${pickupLocation || ''}`,
      `Delivery: ${deliveryLocation || ''}`,
      `Bid deadline: ${safeDeadline}`,
      '',
      loadDetailsText,
      '',
      `Submit bid: ${bidUrl || ''}`,
    ].join('\n'),
  })
}

const sendFreightBidAwardedEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
  quotedAmount,
}) => {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Freight Bid Awarded</h2>
      <p>Hi ${escapeHtml(carrierName || 'Carrier')},</p>
      <p>Your freight bid has been selected for this request:</p>
      <ul>
        <li><strong>Project:</strong> ${escapeHtml(projectName || '')}</li>
        <li><strong>Job ID:</strong> ${escapeHtml(jobId || '')}</li>
        <li><strong>Freight Request #:</strong> ${escapeHtml(deliveryNumber || '')}</li>
        <li><strong>Awarded Amount:</strong> ${quotedAmount != null ? `${formatInvoiceMoney(quotedAmount)} USD` : '—'}</li>
      </ul>
      <p>Our team will coordinate next steps with you shortly.</p>
    </div>
  `

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Freight Bid Awarded: ${projectName || 'Project'}${deliveryNumber ? ` (${deliveryNumber})` : ''}`,
    html,
  })
}

const sendFreightBidRejectedEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
}) => {
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937">
      <h2 style="margin:0 0 12px">Freight Bid Update</h2>
      <p>Hi ${escapeHtml(carrierName || 'Carrier')},</p>
      <p>Thanks for submitting your freight bid. Another carrier was selected for this request:</p>
      <ul>
        <li><strong>Project:</strong> ${escapeHtml(projectName || '')}</li>
        <li><strong>Job ID:</strong> ${escapeHtml(jobId || '')}</li>
        <li><strong>Freight Request #:</strong> ${escapeHtml(deliveryNumber || '')}</li>
      </ul>
      <p>We appreciate your response and look forward to future opportunities.</p>
    </div>
  `

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Freight Bid Update: ${projectName || 'Project'}${deliveryNumber ? ` (${deliveryNumber})` : ''}`,
    html,
  })
}

const sendFreightBidResubmitRequestEmail = async ({
  toEmail,
  carrierName,
  projectName,
  jobId,
  deliveryNumber,
  note,
  bidUrl,
  bidDeadline,
  priorQuotedAmount,
}) => {
  const template = loadTemplate('carrier-freight-bid-resubmit')
  const priorAmountText =
    priorQuotedAmount != null && Number.isFinite(Number(priorQuotedAmount))
      ? formatInvoiceMoney(priorQuotedAmount)
      : 'N/A'

  const html = fillTemplate(template, {
    CARRIER_NAME: carrierName || 'Carrier',
    PROJECT_NAME: projectName || '',
    JOB_ID: jobId || '',
    DELIVERY_NUMBER: deliveryNumber || '',
    NOTE: note || '',
    BID_URL: bidUrl || '',
    BID_DEADLINE: formatInvoiceDate(bidDeadline),
    PRIOR_QUOTED_AMOUNT: priorAmountText,
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Action Required: Revised Freight Bid for ${projectName || 'Project'}`,
    html,
    text: [
      `Hello ${carrierName || 'Carrier'},`,
      '',
      `Project: ${projectName || ''}`,
      `Job ID: ${jobId || ''}`,
      `Freight Request #: ${deliveryNumber || ''}`,
      '',
      `Plant note: ${note || ''}`,
      `Previous bid amount: ${priorAmountText}`,
      '',
      `Submit revised bid: ${bidUrl || ''}`,
      `Bid deadline: ${formatInvoiceDate(bidDeadline)}`,
    ].join('\n'),
  })
}

module.exports = {
  isSmtpConfigured,
  sendQuotation,
  sendInvoice,
  sendOtp,
  sendEmployeeCredentials,
  sendConsolidatedBOMToVendor,
  sendShipperApprovalEmail,
  sendShipperRejectionEmail,
  sendShipperResubmitRequestEmail,
  sendFreightBidRequestEmail,
  sendFreightBidResubmitRequestEmail,
  sendFreightBidAwardedEmail,
  sendFreightBidRejectedEmail,
}
