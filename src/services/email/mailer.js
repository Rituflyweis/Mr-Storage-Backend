const nodemailer = require('nodemailer')
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = require('../../config/env')
const { computeInvoiceDueDate } = require('../../utils/invoiceDueDate')
const path = require('path')
const fs = require('fs')

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
})

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

const buildInvoiceLineItemsRows = (lineItems = []) => {
  if (!lineItems.length) {
    return '<tr><td colspan="7" style="text-align:center;color:#888;padding:16px">No line items on this invoice</td></tr>'
  }

  return lineItems
    .map((li, index) => {
      const description = (li.items || []).filter(Boolean).map(escapeHtml).join('<br/>') || '—'
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
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatInvoiceMoney(li.rate)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatInvoiceMoney(li.markup)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:center;vertical-align:top">${li.quantity ?? '—'}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;vertical-align:top">${formatInvoiceMoney(li.tax)}</td>
        <td style="padding:10px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600;vertical-align:top">${formatInvoiceMoney(li.total)}</td>
      </tr>`
    })
    .join('')
}

const buildInvoiceTotalsRows = (invoice) => {
  const rows = [
    ['Subtotal', invoice.subtotal],
    ['Markup total', invoice.markupTotal],
    ['Discount', invoice.discount],
    ['Deposit', invoice.depositAmount],
    ['Total due', invoice.totalAmount],
  ]

  return rows
    .map(([label, amount], i) => {
      const isGrand = i === rows.length - 1
      const rowClass = isGrand ? ' class="grand"' : ''
      const labelStyle = isGrand
        ? 'text-align:right;color:#1a2e4a;font-weight:700;padding:10px 8px 6px'
        : 'text-align:right;color:#666;padding:6px 8px'
      const valueStyle = isGrand
        ? 'text-align:right;font-weight:700;font-size:18px;color:#1a2e4a;width:120px;padding:10px 8px 6px'
        : 'text-align:right;font-weight:600;width:120px;padding:6px 8px'
      const displayAmount =
        label === 'Discount' && amount != null && Number(amount) !== 0
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
    DISCOUNT: formatInvoiceMoney(inv.discount),
    DEPOSIT_AMOUNT: formatInvoiceMoney(inv.depositAmount),
    TOTAL_AMOUNT: formatInvoiceMoney(inv.totalAmount),
    LINE_ITEMS: buildInvoiceLineItemsRows(inv.lineItems),
    TOTALS_ROWS: buildInvoiceTotalsRows(inv),
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Invoice ${inv.invoiceNumber || ''}`,
    html,
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
}) => {
  const template = loadTemplate('vendor-shipper-resubmit')
  const html = fillTemplate(template, {
    VENDOR_NAME: vendorName || 'Vendor',
    PROJECT_NAME: projectName || '',
    JOB_ID: jobId || '',
    NOTE: note || '',
    UPLOAD_URL: uploadUrl || '',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Action Required: Updated Quote Needed for ${projectName || 'Project'}`,
    html,
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

module.exports = {
  sendQuotation,
  sendInvoice,
  sendOtp,
  sendEmployeeCredentials,
  sendConsolidatedBOMToVendor,
  sendShipperApprovalEmail,
  sendShipperRejectionEmail,
  sendShipperResubmitRequestEmail,
  sendFreightBidRequestEmail,
  sendFreightBidAwardedEmail,
  sendFreightBidRejectedEmail,
}
