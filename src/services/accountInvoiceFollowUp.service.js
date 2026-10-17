const Invoice = require('../models/Invoice')
const Lead = require('../models/Lead')
const Customer = require('../models/Customer')
const PaymentFollowUp = require('../models/PaymentFollowUp')
const mailer = require('./email/mailer')
const customerNotification = require('./customerNotification.service')
const auditService = require('./audit.service')
const { AUDIT_ACTIONS } = require('../config/constants')
const { isInvoiceOverdue } = require('../utils/invoiceScope')
const { computeInvoiceDueDate } = require('../utils/invoiceDueDate')

const formatCustomerName = (customer) =>
  [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim() || 'there'

const resolveDueDate = (invoice) => {
  if (invoice.dueDate) return new Date(invoice.dueDate)
  return computeInvoiceDueDate(invoice.date, invoice.daysToPay)
}

const defaultFollowUpMessage = (invoice, lead, dueDate) => {
  const amt = Number(invoice.totalAmount || 0).toFixed(2)
  const invNo = invoice.invoiceNumber || 'your invoice'
  const project = lead?.projectName || lead?.jobId || 'your project'
  const dueStr = dueDate ? dueDate.toLocaleDateString('en-US') : 'the due date'
  return (
    `This is a friendly reminder regarding invoice ${invNo} for $${amt} on ${project}. ` +
    `Payment was due by ${dueStr}. Please contact us if you have already sent payment or need assistance.`
  )
}

/**
 * Account panel — manual payment follow-up on a customer AR invoice (overdue / pending).
 */
exports.sendInvoiceFollowUp = async (invoiceId, user, body = {}) => {
  const invoice = await Invoice.findById(invoiceId).lean()
  if (!invoice) return { error: 'Invoice not found', code: 404 }

  if (['vendor', 'freight_carrier'].includes(invoice.invoiceType)) {
    return { error: 'Follow-up applies to customer invoices only', code: 400 }
  }
  if (invoice.status === 'paid') return { error: 'Invoice is already paid', code: 400 }
  if (invoice.status === 'cancelled') return { error: 'Cannot follow up on a cancelled invoice', code: 400 }

  const [lead, customer] = await Promise.all([
    Lead.findById(invoice.leadId).select('projectName jobId customerId assignedSales').lean(),
    Customer.findById(invoice.customerId).select('email firstName lastName').lean(),
  ])
  if (!lead) return { error: 'Project not found for this invoice', code: 404 }
  if (!customer) return { error: 'Customer not found for this invoice', code: 404 }

  const dueDate = resolveDueDate(invoice)
  const overdue = isInvoiceOverdue(invoice, new Date())
  const message =
    (body.message && String(body.message).trim()) ||
    defaultFollowUpMessage(invoice, lead, dueDate)
  const subject =
    (body.subject && String(body.subject).trim()) ||
    `Payment reminder: Invoice ${invoice.invoiceNumber || ''}`.trim()

  const channels = { email: false, inApp: false }

  if (customer.email && mailer.isEmailConfigured()) {
    try {
      await mailer.sendFollowUpNudgeEmail({
        toEmail: customer.email,
        customerName: formatCustomerName(customer),
        subject,
        message,
      })
      channels.email = true
    } catch (err) {
      console.error('[accountInvoiceFollowUp] email failed:', err.message)
    }
  }

  try {
    await customerNotification.notifyCustomer({
      customerId: customer._id,
      leadId: lead._id,
      title: overdue ? 'Invoice payment overdue' : 'Invoice payment reminder',
      body: message.slice(0, 500),
      type: 'payment',
      priority: overdue ? 'high' : 'medium',
      refId: invoice._id,
      refModel: 'Invoice',
    })
    channels.inApp = true
  } catch (err) {
    console.error('[accountInvoiceFollowUp] in-app notification failed:', err.message)
  }

  if (!channels.email && !channels.inApp) {
    return {
      error: 'Could not deliver follow-up (configure email or ensure customer record exists)',
      code: 400,
    }
  }

  const nextFollowUp = body.nextFollowUp ? new Date(body.nextFollowUp) : null
  const paymentFollowUp = await PaymentFollowUp.create({
    invoiceId: invoice._id,
    leadId: lead._id,
    createdBy: user._id,
    nextFollowUp: nextFollowUp && !Number.isNaN(nextFollowUp.getTime()) ? nextFollowUp : null,
    notes: message,
    status: 'pending',
  })

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.INVOICE_FOLLOWUP_SENT,
    leadId: lead._id,
    customerId: customer._id,
    performedBy: user._id,
    metadata: {
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      channels,
      paymentFollowUpId: paymentFollowUp._id,
    },
  })

  return {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    leadId: lead._id,
    statusLabel: overdue ? 'Overdue' : 'Pending',
    channels,
    paymentFollowUpId: paymentFollowUp._id,
    sentAt: new Date().toISOString(),
  }
}
