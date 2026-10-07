const Customer = require('../../models/Customer')
const asyncHandler = require('../../utils/asyncHandler')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const customerDirectChat = require('../../services/customerDirectChat.service')

exports.getCustomerDirectSummary = asyncHandler(async (req, res) => {
  const summary = await customerDirectChat.getCustomerDirectSummary(req.customer._id)
  return success(res, summary)
})

exports.getCustomerDirectMessages = asyncHandler(async (req, res) => {
  const data = await customerDirectChat.listMessages(req.customer._id, {
    ...req.query,
    markReadFor: 'customer',
  })
  return success(res, data)
})

exports.sendCustomerDirectMessage = asyncHandler(async (req, res) => {
  const { content } = req.body
  if (!content?.trim()) return badRequest(res, 'content is required')

  const customer = await Customer.findById(req.customer._id).lean()
  if (!customer) return notFound(res, 'Customer not found')

  const message = await customerDirectChat.sendCustomerMessage(customer, content)
  return created(res, { message }, 'Message sent')
})

exports.listStaffDirectConversations = asyncHandler(async (req, res) => {
  const data = await customerDirectChat.listStaffConversations(req.query)
  return success(res, data)
})

exports.getStaffDirectMessages = asyncHandler(async (req, res) => {
  const { customerId } = req.params
  const customer = await Customer.findById(customerId).select('_id firstName lastName email').lean()
  if (!customer) return notFound(res, 'Customer not found')

  const data = await customerDirectChat.listMessages(customerId, {
    ...req.query,
    markReadFor: 'staff',
  })
  return success(res, { customer, ...data })
})

exports.sendStaffDirectMessage = asyncHandler(async (req, res) => {
  const { customerId } = req.params
  const { content } = req.body
  if (!content?.trim()) return badRequest(res, 'content is required')

  const result = await customerDirectChat.sendStaffMessage(customerId, req.user, content)
  if (result.error) return notFound(res, result.error)
  return created(res, { message: result.message }, 'Message sent')
})
