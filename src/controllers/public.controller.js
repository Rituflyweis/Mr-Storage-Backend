const bcrypt = require('bcryptjs')
const Customer = require('../models/Customer')
const Lead = require('../models/Lead')
const Message = require('../models/Message')
const auditService = require('../services/audit.service')
const generateCustomerId = require('../utils/generateCustomerId')
const { success, badRequest } = require('../utils/apiResponse')
const asyncHandler = require('../utils/asyncHandler')
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../config/constants')

exports.chatInit = asyncHandler(async (req, res) => {
  const { firstName, email, phone, countryCode } = req.body

  const normalizedEmail = email.toLowerCase().trim()
  const normalizedPhone = phone.trim()

  // 1. Try to find existing customer by email or phone
  let customer = await Customer.findOne({
    $or: [
      { email: normalizedEmail },
      { 'phone.number': normalizedPhone },
    ],
  })

  let isNewCustomer = false

  if (!customer) {
    // 2. Create new customer
    const customerId = await generateCustomerId()
    const hashedPassword = await bcrypt.hash(normalizedPhone, 12)

    customer = await Customer.create({
      customerId,
      firstName: firstName.trim(),
      email: normalizedEmail,
      phone: { number: normalizedPhone, countryCode: countryCode.trim() },
      password: hashedPassword,
      source: 'chat',
    })
    isNewCustomer = true
  }

  // 3. Check for any existing active (non-delivered) lead for this customer
  // This handles the case where a manually-added or imported lead matches
  const existingLead = await Lead.findOne({
    customerId: customer._id,
    lifecycleStatus: { $nin: CLOSED_STAGES },
  }).sort({ createdAt: -1 })

  let lead = existingLead

  if (!lead) {
    // 4. Create new lead
    lead = await Lead.create({
      customerId: customer._id,
      source: 'chat',
      lifecycleStatus: 'initial_contact',
    })

    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_CREATED,
      leadId: lead._id,
      customerId: customer._id,
      performedBy: null,
      metadata: { source: 'chat', isNewCustomer },
    })

    // Notify admin panel of new lead
    if (global.io) {
      global.io.of('/admin').to('admin_room').emit('new_lead', {
        leadId: lead._id,
        customerId: customer._id,
        customerName: customer.firstName,
      })
    }
  }

  return success(res, {
    customerId: customer._id,
    leadId: lead._id,
    customerName: customer.firstName,
    isReturning: !isNewCustomer,
  })
})

exports.getChatHistory = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const messages = await Message.find({ leadId })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt isRead')
    .lean()

  return success(res, { messages })
})
