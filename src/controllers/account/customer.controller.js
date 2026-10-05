const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound } = require('../../utils/apiResponse')
const accountCustomerService = require('../../services/accountCustomer.service')

exports.getStats = asyncHandler(async (req, res) => {
  const stats = await accountCustomerService.computeCustomerStats(req.query)
  return success(res, stats)
})

exports.listCustomers = asyncHandler(async (req, res) => {
  const data = await accountCustomerService.listCustomers(req.query)
  return success(res, data)
})

exports.getCustomerDetail = asyncHandler(async (req, res) => {
  const detail = await accountCustomerService.getCustomerDetail(req.params.customerId, req.query)
  if (!detail) return notFound(res, 'Customer not found')
  return success(res, detail)
})
