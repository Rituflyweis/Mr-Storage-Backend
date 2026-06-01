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
  const { firstName, email, phone } = req.body
  const countryCode = String(req.body.countryCode || '+1').trim() || '+1'

  const normalizedEmail = email.toLowerCase().trim()
  const normalizedPhone = phone.replace(/\D/g, '').trim() || phone.trim()

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
      phone: { number: normalizedPhone, countryCode },
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
      lifecycleHistory: [
        { stage: 'initial_contact', changedAt: new Date(), changedBy: null },
      ],
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
    isHandedToSales: lead.isHandedToSales || false,
    isQuoteReady: lead.isQuoteReady || false,
  })
})

exports.getChatHistory = asyncHandler(async (req, res) => {
  const { leadId } = req.params

  const messages = await Message.find({ leadId })
    .sort({ createdAt: 1 })
    .populate('senderId', 'name')
    .select('senderType senderId content createdAt isRead')
    .lean()

  const rows = messages.map((m) => ({
    senderType: m.senderType,
    content: m.content,
    createdAt: m.createdAt,
    isRead: m.isRead,
    senderName: m.senderType === 'sales'
      ? m.senderId?.name || 'Sales'
      : m.senderType === 'admin'
        ? m.senderId?.name || 'Admin'
        : undefined,
  }))

  return success(res, { messages: rows })
})
