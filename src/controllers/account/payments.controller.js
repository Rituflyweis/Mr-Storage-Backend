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

/** Quote / order dropdown for Add Order Payment (POST body quoteOrderId or leadId) */
exports.getOrderOptions = asyncHandler(async (req, res) => {
  const data = await accountPaymentsService.listOrderOptions(req.query)
  return success(res, data)
})

/** Orders & payment summary table */
exports.getOrdersAndPayments = asyncHandler(async (req, res) => {
  const data = await accountPaymentsService.listOrders(req.query)
  return success(res, data)
})

exports.getOrderDetail = asyncHandler(async (req, res) => {
  const row = await accountPaymentsService.resolveWip(req.params.orderId)
  if (!row) return notFound(res, 'Order / project not found')
  return success(res, accountPaymentsService.mapOrderDetail(row))
})

exports.createOrderPayment = asyncHandler(async (req, res) => {
  const result = await accountPaymentsService.upsertOrder(req.body, req.user._id)
  if (result.error) return badRequest(res, result.error)
  return success(res, accountPaymentsService.mapOrderDetail(result.wip), 'Order payment saved')
})

exports.updateOrderPayment = asyncHandler(async (req, res) => {
  // Overview is derived — updates are not stored. Detail still loads by leadId.
  const row = await accountPaymentsService.resolveWip(req.params.orderId)
  if (!row) return notFound(res, 'Order / project not found')
  const result = await accountPaymentsService.upsertOrder(req.body, req.user._id)
  if (result.error) return badRequest(res, result.error)
  return success(res, accountPaymentsService.mapOrderDetail(row), 'Payment updated')
})

exports.exportOrders = asyncHandler(async (req, res) => {
  const { generateWIPProfitsExcel } = require('../../utils/exportFinancialAdmin')
  const orders = await accountPaymentsService.listOrdersForExport(req.query)
  const rows = orders.map((o) => ({
    projectName: o.orderDetails?.customerName || '',
    jobId: o.orderDetails?.orderId || '',
    customerName: o.orderDetails?.customerName || '',
    orderValue: o.orderValue,
    currentCost: o.currentCost,
    totalReceived: o.totalReceived,
    outstanding: o.outstanding,
    wipProfit: o.profit,
    marginPct: o.marginPct,
    status: o.status,
  }))
  const buffer = await generateWIPProfitsExcel(rows)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="payment-overview-orders.xlsx"')
  return res.send(buffer)
})
