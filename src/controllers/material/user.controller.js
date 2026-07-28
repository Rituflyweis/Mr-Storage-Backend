const asyncHandler = require('../../utils/asyncHandler')
const bcrypt = require('bcryptjs')
const { NewsLetter, Quotes, Inquire, BuildingType } = require('../../models/material')
const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const auditService = require('../../services/audit.service')
const leadListSocket = require('../../services/leadListSocket.service')
const { syncLeadBuildings } = require('../../services/leadBuilding.service')
const mailer = require('../../services/email/mailer')
const generateCustomerId = require('../../utils/generateCustomerId')
const { AUDIT_ACTIONS, CLOSED_STAGES } = require('../../config/constants')

const resolveBuildingTypeName = async (buildingTypeId) => {
  const id = String(buildingTypeId || '').trim()
  if (!id) return ''

  const doc = await BuildingType.findById(id).select('title').lean()
  return String(doc?.title || '').trim()
}

exports.sendNewsLetterRequest = asyncHandler(async(req, res) => {
  const { email } = req.body
  if (!email) {
    return res.status(400).json({ status: 400, message: 'Email is required' })
  }

  const existing = await NewsLetter.findOne({ email })
  if (existing) {
    return res.status(200).json({ status: 200, message: 'Newsletter subscribed successfully', data: existing })
  }

  const created = await NewsLetter.create({ email })
  return res.status(200).json({ status: 200, message: 'Newsletter subscribed successfully', data: created })
})

exports.sendQuotesRequest = asyncHandler(async(req, res) => {
  console.info('[material.sendQuotesRequest] request received', {
    ip: req.ip,
    hasEmail: Boolean(req.body.email),
    hasPhoneNumber: Boolean(req.body.phoneNumber),
    hasBuildingTypeId: Boolean(req.body.buildingTypeId),
    at: new Date().toISOString(),
  })

  const firstName = String(req.body.firstName || '').trim()
  const lastName = String(req.body.lastName || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const rawPhone = String(req.body.phoneNumber || '').trim()
  const phone = rawPhone.replace(/\D/g, '').trim() || rawPhone
  const countryCode = String(req.body.countryCode || '+1').trim() || '+1'

  if (!firstName || !phone) {
    return res.status(400).json({
      status: 400,
      message: 'firstName and phoneNumber are required to create lead from quote request',
    })
  }

  const customerQuery = { $or: [{ 'phone.number': phone }] }
  if (email) customerQuery.$or.push({ email })
  let customer = await Customer.findOne(customerQuery)

  let isNewCustomer = false
  if (!customer) {
    if (!email) {
      return res.status(400).json({
        status: 400,
        message: 'email is required to create a new customer',
      })
    }

    const customerId = await generateCustomerId()
    const hashedPassword = await bcrypt.hash(phone, 12)
    customer = await Customer.create({
      customerId,
      firstName,
      lastName,
      email,
      phone: { number: phone, countryCode },
      password: hashedPassword,
      source: 'chat',
    })
    isNewCustomer = true

    if (mailer.isEnquiryNotificationConfigured()) {
      try {
        await mailer.sendNewCustomerEnquiryNotification({
          toEmail: 'info@steelbuildingdepot.com',
          customerName: firstName,
          customerEmail: email,
          customerPhone: phone,
          countryCode,
          source: 'form',
        })
      } catch (err) {
        console.warn('[sendQuotesRequest] Failed to send new customer enquiry notification:', err.message)
      }
    }
  }

  let lead = await Lead.findOne({
    customerId: customer._id,
    lifecycleStatus: { $nin: CLOSED_STAGES },
  }).sort({ createdAt: -1 })

  const quoteNotes = String(req.body.notes || '').trim()
  const buildingTypeName = await resolveBuildingTypeName(req.body.buildingTypeId)

  if (!lead) {
    lead = await Lead.create({
      customerId: customer._id,
      source: 'chat',
      lifecycleStatus: 'initial_contact',
      lifecycleHistory: [
        { stage: 'initial_contact', changedAt: new Date(), changedBy: null },
      ],
      buildingType: buildingTypeName,
      width: req.body.width ? Number(req.body.width) : null,
      length: req.body.length ? Number(req.body.length) : null,
      height: req.body.height ? Number(req.body.height) : null,
      location: [req.body.siteAddress, req.body.city, req.body.state, req.body.country, req.body.zip || req.body.zipCode]
        .filter(Boolean)
        .join(', '),
      projectName: String(req.body.intendedUse || ''),
      notes: quoteNotes,
    })

    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_CREATED,
      leadId: lead._id,
      customerId: customer._id,
      performedBy: null,
      metadata: { source: 'chat', isNewCustomer, via: 'material_quote' },
    })

    await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'material_quote' })
    await syncLeadBuildings(lead, { createdBy: null })
  } else {
    if (req.body.width) lead.width = Number(req.body.width)
    if (req.body.length) lead.length = Number(req.body.length)
    if (req.body.height) lead.height = Number(req.body.height)
    if (req.body.buildingTypeId) lead.buildingType = buildingTypeName

    const mergedLocation = [req.body.siteAddress, req.body.city, req.body.state, req.body.country, req.body.zip || req.body.zipCode]
      .filter(Boolean)
      .join(', ')
    if (mergedLocation) lead.location = mergedLocation
    if (req.body.intendedUse) lead.projectName = String(req.body.intendedUse)

    if (quoteNotes) {
      const existingNotes = String(lead.notes || '').trim()
      lead.notes = existingNotes ? `${existingNotes}\n\n${quoteNotes}` : quoteNotes
    }

    await lead.save()
  }

  const payload = {
    buildingTypeId: req.body.buildingTypeId,
    customerId: customer._id,
    leadId: lead._id,
    width: req.body.width,
    length: req.body.length,
    height: req.body.height,
    roofPitch: req.body.roofPitch,
    zipCode: req.body.zipCode,
    firstName,
    lastName,
    email,
    phoneNumber: phone,
    company: req.body.company,
    siteAddress: req.body.siteAddress,
    city: req.body.city,
    state: req.body.state,
    country: req.body.country,
    zip: req.body.zip,
    notes: req.body.notes,
    intendedUse: req.body.intendedUse,
  }

  const created = await Quotes.create(payload)
  const inquiryMessageParts = [
    req.body.notes ? `Notes: ${String(req.body.notes).trim()}` : '',
    req.body.intendedUse ? `Intended Use: ${String(req.body.intendedUse).trim()}` : '',
    buildingTypeName ? `Building Type: ${buildingTypeName}` : '',
    req.body.width ? `Width: ${String(req.body.width).trim()}` : '',
    req.body.length ? `Length: ${String(req.body.length).trim()}` : '',
    req.body.height ? `Height: ${String(req.body.height).trim()}` : '',
    req.body.roofPitch ? `Roof Pitch: ${String(req.body.roofPitch).trim()}` : '',
    req.body.siteAddress ? `Site Address: ${String(req.body.siteAddress).trim()}` : '',
    req.body.city ? `City: ${String(req.body.city).trim()}` : '',
    req.body.state ? `State: ${String(req.body.state).trim()}` : '',
    req.body.country ? `Country: ${String(req.body.country).trim()}` : '',
    req.body.zip || req.body.zipCode ? `Zip: ${String(req.body.zip || req.body.zipCode).trim()}` : '',
  ].filter(Boolean)

  await Inquire.create({
    name: firstName,
    lastName,
    email,
    phone,
    message: inquiryMessageParts.join(' | '),
    customerId: customer._id,
    leadId: lead._id,
  })

  return res.status(200).json({ status: 200, message: 'Quote request send successfully', data: created })
})

exports.sendInquire = asyncHandler(async(req, res) => {
  const firstName = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  const rawPhone = String(req.body.phone || '').trim()
  const phone = rawPhone.replace(/\D/g, '').trim() || rawPhone
  const countryCode = String(req.body.countryCode || '+1').trim() || '+1'

  if (!firstName || !email || !phone) {
    return res.status(400).json({
      status: 400,
      message: 'name, email and phone are required to create lead enquiry',
    })
  }

  let customer = await Customer.findOne({
    $or: [
      { email },
      { 'phone.number': phone },
    ],
  })

  let isNewCustomer = false
  if (!customer) {
    const customerId = await generateCustomerId()
    const hashedPassword = await bcrypt.hash(phone, 12)
    customer = await Customer.create({
      customerId,
      firstName,
      lastName: String(req.body.lastName || '').trim(),
      email,
      phone: { number: phone, countryCode },
      password: hashedPassword,
      source: 'chat',
    })
    isNewCustomer = true

    if (mailer.isEnquiryNotificationConfigured()) {
      try {
        await mailer.sendNewCustomerEnquiryNotification({
          toEmail: 'info@steelbuildingdepot.com',
          customerName: firstName,
          customerEmail: email,
          customerPhone: phone,
          countryCode,
          source: 'form',
        })
      } catch (err) {
        console.warn('[sendInquire] Failed to send new customer enquiry notification:', err.message)
      }
    }
  }

  let lead = await Lead.findOne({
    customerId: customer._id,
    lifecycleStatus: { $nin: CLOSED_STAGES },
  }).sort({ createdAt: -1 })

  if (!lead) {
    lead = await Lead.create({
      customerId: customer._id,
      source: 'chat',
      lifecycleStatus: 'initial_contact',
      lifecycleHistory: [
        { stage: 'initial_contact', changedAt: new Date(), changedBy: null },
      ],
      notes: String(req.body.message || '').trim(),
    })

    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_CREATED,
      leadId: lead._id,
      customerId: customer._id,
      performedBy: null,
      metadata: { source: 'chat', isNewCustomer, via: 'material_inquiry' },
    })

    await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'material_inquiry' })
    await syncLeadBuildings(lead, { createdBy: null })
  } else if (req.body.message) {
    const nextNote = String(req.body.message).trim()
    if (nextNote) {
      const existingNotes = String(lead.notes || '').trim()
      lead.notes = existingNotes ? `${existingNotes}\n\n${nextNote}` : nextNote
      await lead.save()
    }
  }

  const created = await Inquire.create({
    ...req.body,
    email,
    phone,
    name: firstName,
    customerId: customer._id,
    leadId: lead._id,
  })
  return res.status(200).send({ message: 'send Inquire successfully ', data: created })
})

exports.getAllInquire = asyncHandler(async(req, res) => {
  const query = {}
  if (req.query.search) {
    query.$or = [
      { message: { $regex: req.query.search, $options: 'i' } },
      { email: { $regex: req.query.search, $options: 'i' } },
      { phone: { $regex: req.query.search, $options: 'i' } },
      { name: { $regex: req.query.search, $options: 'i' } },
      { lastName: { $regex: req.query.search, $options: 'i' } },
    ]
  }

  if (req.query.fromDate && req.query.toDate) {
    query.createdAt = {
      $gte: new Date(req.query.fromDate),
      $lte: new Date(req.query.toDate),
    }
  } else if (req.query.fromDate) {
    query.createdAt = { $gte: new Date(req.query.fromDate) }
  } else if (req.query.toDate) {
    query.createdAt = { $lte: new Date(req.query.toDate) }
  }

  const page = parseInt(req.query.page || '1', 10)
  const limit = parseInt(req.query.limit || '10', 10)

  const data = await Inquire.paginate(query, {
    page,
    limit,
    sort: { createdAt: -1 },
  })

  if (!data.docs.length) {
    return res.status(200).json({ status: 200, message: 'No data found', data: [] })
  }

  return res.status(200).send({ status: 200, message: 'Inquire data fetch successfully.', data })
})
