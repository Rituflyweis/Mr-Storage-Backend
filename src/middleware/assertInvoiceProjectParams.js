const Invoice = require('../models/Invoice')
const { notFound, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')

const assertInvoiceMatchesProjectParams = asyncHandler(async (req, res, next) => {
  const invoice = await Invoice.findById(req.params.invoiceId).select('leadId customerId')
  if (!invoice) return notFound(res, 'Invoice not found')

  if (req.params.leadId && String(invoice.leadId) !== String(req.params.leadId)) {
    return badRequest(res, 'Invoice does not belong to this project')
  }
  if (req.params.customerId && String(invoice.customerId) !== String(req.params.customerId)) {
    return badRequest(res, 'Invoice does not belong to this customer')
  }

  next()
})

module.exports = assertInvoiceMatchesProjectParams
