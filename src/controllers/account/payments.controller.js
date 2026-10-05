const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound, badRequest } = require('../../utils/apiResponse')
const accountPaymentsService = require('../../services/accountPayments.service')

exports.getStats = asyncHandler(async (req, res) => {
  const stats = await accountPaymentsService.computePaymentStats(req.query)
  return success(res, stats)
})

/** Payment Overview — stats + optional legacy breakdown */
exports.getPaymentOverview = asyncHandler(async (req, res) => {
  const stats = await accountPaymentsService.computePaymentStats(req.query)
  return success(res, {
    summary: {
      totalOrderValue: stats.totalOrderValue,
      totalReceived: stats.totalReceived,
      outstanding: stats.outstanding,
      totalWipProfit: stats.totalWipProfit,
    },
    ...stats,
  })
})

/** Orders & payment summary table */
exports.getOrdersAndPayments = asyncHandler(async (req, res) => {
  const data = await accountPaymentsService.listOrders(req.query)
  return success(res, data)
})

exports.getOrderDetail = asyncHandler(async (req, res) => {
  const wip = await accountPaymentsService.resolveWip(req.params.orderId)
  if (!wip) return notFound(res, 'Order payment record not found')
  return success(res, accountPaymentsService.mapOrderDetail(wip))
})

exports.createOrderPayment = asyncHandler(async (req, res) => {
  const result = await accountPaymentsService.upsertOrder(req.body, req.user._id)
  if (result.error) return badRequest(res, result.error)
  return success(res, accountPaymentsService.mapOrderDetail(result.wip), 'Order payment saved')
})

exports.updateOrderPayment = asyncHandler(async (req, res) => {
  const wip = await accountPaymentsService.resolveWip(req.params.orderId)
  if (!wip) return notFound(res, 'Order payment record not found')

  const result = await accountPaymentsService.upsertOrder(
    {
      ...req.body,
      leadId: wip.leadId?._id || wip.leadId,
      quoteOrderId: req.body.quoteOrderId || wip.leadId?.jobId,
    },
    req.user._id
  )
  if (result.error) return badRequest(res, result.error)
  return success(res, accountPaymentsService.mapOrderDetail(result.wip), 'Payment updated')
})
