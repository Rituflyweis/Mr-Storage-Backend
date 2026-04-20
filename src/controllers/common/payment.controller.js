const PaymentSchedule = require('../../models/PaymentSchedule')
const Invoice = require('../../models/Invoice')
const auditService = require('../../services/audit.service')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { AUDIT_ACTIONS } = require('../../config/constants')

exports.createSchedule = asyncHandler(async (req, res) => {
  const { invoiceId, payments } = req.body

  const invoice = await Invoice.findById(invoiceId)
  if (!invoice) return notFound(res, 'Invoice not found')

  // Derive IDs from the invoice — never trust client-supplied values
  const leadId = invoice.leadId
  const customerId = invoice.customerId

  // Validate payment amounts
  const allPercentage = payments.every(p => p.amountType === 'percentage')
  const allFixed = payments.every(p => p.amountType === 'fixed')

  if (!allPercentage && !allFixed) {
    return badRequest(res, 'All payment items must use the same amountType (percentage or fixed)')
  }

  const sum = payments.reduce((acc, p) => acc + p.amount, 0)

  if (allPercentage && Math.abs(sum - 100) > 0.01) {
    return badRequest(res, `Percentage payments must sum to 100. Got ${sum}`)
  }
  if (allFixed && Math.abs(sum - invoice.totalAmount) > 0.01) {
    return badRequest(res, `Fixed payments must sum to invoice total (${invoice.totalAmount}). Got ${sum}`)
  }

  const schedule = await PaymentSchedule.create({
    customerId,
    leadId,
    invoiceId,
    payments,
    totalAmount: invoice.totalAmount,
  })

  // Link schedule back to invoice
  await Invoice.findByIdAndUpdate(invoiceId, { paymentScheduleId: schedule._id })

  return created(res, { schedule })
})

exports.getSchedule = asyncHandler(async (req, res) => {
  const schedule = await PaymentSchedule.findOne({ invoiceId: req.params.invoiceId }).lean()
  if (!schedule) return notFound(res, 'Payment schedule not found')
  return success(res, { schedule })
})

exports.markPaymentPaid = asyncHandler(async (req, res) => {
  const { scheduleId, paymentId } = req.params

  const schedule = await PaymentSchedule.findById(scheduleId)
  if (!schedule) return notFound(res, 'Payment schedule not found')

  const payment = schedule.payments.id(paymentId)
  if (!payment) return notFound(res, 'Payment item not found')
  if (payment.status === 'paid') return badRequest(res, 'Payment already marked as paid')

  payment.status = 'paid'
  payment.paidAt = new Date()
  payment.paidBy = req.user._id
  await schedule.save()

  // Roll up to invoice if every scheduled payment is now paid
  if (schedule.payments.every(p => p.status === 'paid')) {
    const invoice = await Invoice.findById(schedule.invoiceId)
    if (invoice && invoice.status !== 'paid') {
      invoice.status = 'paid'
      invoice.paidAt = new Date()
      invoice.paidBy = req.user._id
      await invoice.save()
    }
  }

  await auditService.log({
    type: 'invoice',
    action: AUDIT_ACTIONS.PAYMENT_MARKED_PAID,
    leadId: schedule.leadId,
    customerId: schedule.customerId,
    performedBy: req.user._id,
    metadata: {
      scheduleId,
      paymentId,
      paymentName: payment.name,
      amount: payment.amount,
      amountType: payment.amountType,
    },
  })

  return success(res, { schedule }, 'Payment marked as paid')
})
