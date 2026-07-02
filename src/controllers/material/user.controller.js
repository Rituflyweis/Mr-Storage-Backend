const asyncHandler = require('../../utils/asyncHandler')
const { NewsLetter, Quotes, Inquire } = require('../../models/material')

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
  const payload = {
    buildingTypeId: req.body.buildingTypeId,
    width: req.body.width,
    length: req.body.length,
    height: req.body.height,
    roofPitch: req.body.roofPitch,
    zipCode: req.body.zipCode,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    email: req.body.email,
    phoneNumber: req.body.phoneNumber,
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
  return res.status(200).json({ status: 200, message: 'Quote request send successfully', data: created })
})

exports.sendInquire = asyncHandler(async(req, res) => {
  const created = await Inquire.create(req.body)
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
