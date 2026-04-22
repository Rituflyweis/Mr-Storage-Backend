const nodemailer = require('nodemailer')
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = require('../../config/env')
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

const sendQuotation = async ({ toEmail, customerName, quotation }) => {
  const template = loadTemplate('quotation')
  const html = fillTemplate(template, {
    CUSTOMER_NAME: customerName,
    BUILDING_TYPE: quotation.buildingType,
    BASE_PRICE: quotation.basePrice?.toLocaleString() || '',
    MAX_PRICE: quotation.maxPrice?.toLocaleString() || '',
    CURRENCY: quotation.currency || 'USD',
    LOCATION: quotation.location || '',
    VALID_TILL: quotation.validTill ? new Date(quotation.validTill).toDateString() : 'N/A',
    COMPANY_NAME: quotation.companyName || '',
    ESTIMATED_DELIVERY: quotation.estimatedDelivery || '',
    SPECIAL_NOTE: quotation.specialNote || '',
    PAYMENT_TERMS: quotation.paymentTerms || '',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Your Quotation for ${quotation.buildingType || 'Construction Project'}`,
    html,
  })
}

const sendInvoice = async ({ toEmail, customerName, invoice }) => {
  const template = loadTemplate('invoice')
  const html = fillTemplate(template, {
    CUSTOMER_NAME: customerName,
    INVOICE_NUMBER: invoice.invoiceNumber,
    DATE: new Date(invoice.date).toDateString(),
    TOTAL_AMOUNT: invoice.totalAmount?.toLocaleString() || '',
    DAYS_TO_PAY: invoice.daysToPay || '',
    PO_NUMBER: invoice.poNumber || '',
  })

  await transporter.sendMail({
    from: MAIL_FROM,
    to: toEmail,
    subject: `Invoice ${invoice.invoiceNumber}`,
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

module.exports = { sendQuotation, sendInvoice, sendOtp }
