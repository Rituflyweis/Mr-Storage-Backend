const asyncHandler = require('../../utils/asyncHandler')
const {
  ContactDetails,
  BuildingType,
  BuildingTypeData,
  Project,
  WhyUs,
  WhyUsData,
  ClientReview,
} = require('../../models/material')
const { uploadImage } = require('../../services/material/imageUpload.service')

const upsertContentSection = async(Model, req, res, sectionName) => {
  const { title, description } = req.body

  if (!title) {
    return res.status(400).json({ status: 400, message: 'All fields title are required.' })
  }

  const duplicate = await Model.findOne({ title })
  if (duplicate) {
    return res.status(409).json({ status: 409, message: `${sectionName} already exists.`, data: duplicate })
  }

  const image = await uploadImage(req.file)
  const created = await Model.create({ title, description, image })
  return res.status(200).json({ status: 200, message: `${sectionName} created successfully`, data: created })
}

const getAllContentSections = async(Model, res, sectionName) => {
  const records = await Model.find({})
  if (!records.length) {
    return res.status(404).json({ status: 404, message: `${sectionName} retrieved successfully`, data: {} })
  }
  return res.status(200).json({ status: 200, message: `${sectionName} retrieved successfully`, data: records })
}

const getContentSectionById = async(Model, id, res, sectionName) => {
  const record = await Model.findById(id)
  if (!record) return res.status(404).json({ status: 404, message: `${sectionName} not found` })
  return res.status(200).json({ status: 200, message: `${sectionName} retrieved successfully`, data: record })
}

const deleteContentSectionById = async(Model, id, res, sectionName) => {
  const record = await Model.findById(id)
  if (!record) return res.status(404).json({ status: 404, message: `${sectionName} not found` })
  await Model.findByIdAndDelete(id)
  return res.status(200).json({ status: 200, message: `${sectionName} deleted successfully` })
}

const updateContentSection = async(Model, req, res, sectionName) => {
  const record = await Model.findById(req.params.id)
  if (!record) return res.status(404).json({ status: 404, message: `${sectionName} not found` })

  const image = await uploadImage(req.file)
  record.title = req.body.title ?? record.title
  record.description = req.body.description ?? record.description
  if (image) record.image = image
  await record.save()

  return res.status(200).json({ status: 200, message: `${sectionName} retrieved successfully`, data: record })
}

exports.addContactDetails = asyncHandler(async(req, res) => {
  const current = await ContactDetails.findOne()

  if (!current) {
    const created = await ContactDetails.create(req.body)
    return res.status(200).json({ message: 'Contact detail add successfully.', status: 200, data: created })
  }

  const payload = {
    name: req.body.name ?? current.name,
    instagram: req.body.instagram ?? current.instagram,
    google: req.body.google ?? current.google,
    youtube: req.body.youtube ?? current.youtube,
    apple: req.body.apple ?? current.apple,
    fb: req.body.fb ?? current.fb,
    address: req.body.address ?? current.address,
    email: req.body.email ?? current.email,
    telePhone: req.body.telePhone ?? current.telePhone,
    phone: req.body.phone ?? current.phone,
    linkedIn: req.body.linkedIn ?? current.linkedIn,
    twitter: req.body.twitter ?? current.twitter,
    map: req.body.map ?? current.map,
    mapLink: req.body.mapLink ?? current.mapLink,
    compliancePhone: req.body.compliancePhone ?? current.compliancePhone,
    onboardingPhone: req.body.onboardingPhone ?? current.onboardingPhone,
    customerCarePhone: req.body.customerCarePhone ?? current.customerCarePhone,
    generalEnquiryPhone: req.body.generalEnquiryPhone ?? current.generalEnquiryPhone,
    copyRight: req.body.copyRight ?? current.copyRight,
  }

  const updated = await ContactDetails.findByIdAndUpdate(current._id, { $set: payload }, { new: true })
  return res.status(200).json({ message: 'Contact detail update successfully.', status: 200, data: updated })
})

exports.viewContactDetails = asyncHandler(async(req, res) => {
  const record = await ContactDetails.findOne({})
  if (!record) return res.status(404).json({ message: 'Contact detail not found.', status: 404, data: {} })
  return res.status(200).json({ message: 'Contact detail found successfully.', status: 200, data: record })
})

exports.createBuildingType = asyncHandler(async(req, res) => upsertContentSection(BuildingType, req, res, 'BuildingType'))
exports.getAllBuildingType = asyncHandler(async(req, res) => getAllContentSections(BuildingType, res, 'BuildingType'))
exports.getBuildingTypeById = asyncHandler(async(req, res) => getContentSectionById(BuildingType, req.params.id, res, 'BuildingType'))
exports.deleteBuildingType = asyncHandler(async(req, res) => deleteContentSectionById(BuildingType, req.params.id, res, 'BuildingType'))
exports.updateBuildingType = asyncHandler(async(req, res) => updateContentSection(BuildingType, req, res, 'BuildingType'))

exports.createBuildingTypeData = asyncHandler(async(req, res) => {
  const { title, description, heading1, headingDescription, heading2, heading2Description } = req.body
  if (!title) {
    return res.status(400).json({ status: 400, message: 'All fields title are required.' })
  }

  const existing = await BuildingTypeData.findOne({})
  const image = await uploadImage(req.file)

  if (existing) {
    existing.title = title ?? existing.title
    existing.description = description ?? existing.description
    existing.heading1 = heading1 ?? existing.heading1
    existing.headingDescription = headingDescription ?? existing.headingDescription
    existing.heading2 = heading2 ?? existing.heading2
    existing.heading2Description = heading2Description ?? existing.heading2Description
    if (image) existing.image = image
    await existing.save()
    return res.status(200).json({ status: 200, message: 'BuildingTypeData retrieved successfully', data: existing })
  }

  const created = await BuildingTypeData.create({
    title,
    description,
    heading1,
    headingDescription,
    heading2,
    heading2Description,
    image,
  })
  return res.status(200).json({ status: 200, message: 'BuildingTypeData created successfully', data: created })
})

exports.getAllBuildingTypeData = asyncHandler(async(req, res) => getAllContentSections(BuildingTypeData, res, 'BuildingTypeData'))
exports.getBuildingTypeDataById = asyncHandler(async(req, res) => getContentSectionById(BuildingTypeData, req.params.id, res, 'BuildingTypeData'))
exports.deleteBuildingTypeData = asyncHandler(async(req, res) => deleteContentSectionById(BuildingTypeData, req.params.id, res, 'BuildingTypeData'))

exports.addDatainBuildingTypeData = asyncHandler(async(req, res) => {
  const record = await BuildingTypeData.findOne({})
  if (!record) return res.status(404).json({ status: 404, message: 'data not found.', data: {} })

  const image = await uploadImage(req.file)
  record.data.push({
    title: req.body.title,
    image,
  })
  await record.save()
  return res.status(200).json({ status: 200, message: 'data update successfully', data: record })
})

exports.updateDatainBuildingTypeData = asyncHandler(async(req, res) => {
  const { title, dataId } = req.body
  const record = await BuildingTypeData.findOne({})
  if (!record) return res.status(404).json({ status: 404, message: 'User not found.' })

  const existing = record.data.id(dataId)
  if (!existing) return res.status(404).json({ status: 404, message: 'Policy not found.' })

  const image = await uploadImage(req.file)
  existing.title = title ?? existing.title
  if (image) existing.image = image

  await record.save()
  return res.status(200).json({ status: 200, message: 'Policy updated successfully.', data: record })
})

exports.deleteDatainBuildingTypeData = asyncHandler(async(req, res) => {
  const record = await BuildingTypeData.findOne({})
  if (!record) return res.status(200).send({ status: 200, message: 'No Data Found ', cart: [] })

  const existing = record.data.id(req.params.id)
  if (!existing || record.data.length <= 1) {
    return res.status(200).send({ status: 200, message: 'No Data Found ', data: [] })
  }

  record.data.pull(req.params.id)
  await record.save()
  return res.status(200).send({ message: 'Content delete from Permanent JobRegistration.', data: record })
})

exports.createProject = asyncHandler(async(req, res) => upsertContentSection(Project, req, res, 'Project'))
exports.getAllProject = asyncHandler(async(req, res) => getAllContentSections(Project, res, 'Project'))
exports.getProjectById = asyncHandler(async(req, res) => getContentSectionById(Project, req.params.id, res, 'Project'))
exports.deleteProject = asyncHandler(async(req, res) => deleteContentSectionById(Project, req.params.id, res, 'Project'))
exports.updateProject = asyncHandler(async(req, res) => updateContentSection(Project, req, res, 'Project'))

exports.createwhyUs = asyncHandler(async(req, res) => upsertContentSection(WhyUs, req, res, 'whyUs'))
exports.getAllwhyUs = asyncHandler(async(req, res) => getAllContentSections(WhyUs, res, 'whyUs'))
exports.getwhyUsById = asyncHandler(async(req, res) => getContentSectionById(WhyUs, req.params.id, res, 'whyUs'))
exports.deletewhyUs = asyncHandler(async(req, res) => deleteContentSectionById(WhyUs, req.params.id, res, 'whyUs'))
exports.updatewhyUs = asyncHandler(async(req, res) => updateContentSection(WhyUs, req, res, 'whyUs'))

exports.createwhyUsData = asyncHandler(async(req, res) => {
  const { title, description, heading1, heading2 } = req.body
  if (!title) {
    return res.status(400).json({ status: 400, message: 'All fields title are required.' })
  }

  const existing = await WhyUsData.findOne({})
  const image = await uploadImage(req.file)

  if (existing) {
    existing.title = title ?? existing.title
    existing.description = description ?? existing.description
    existing.heading1 = heading1 ?? existing.heading1
    existing.heading2 = heading2 ?? existing.heading2
    if (image) existing.image = image
    await existing.save()
    return res.status(200).json({ status: 200, message: 'whyUsData retrieved successfully', data: existing })
  }

  const created = await WhyUsData.create({
    title,
    description,
    heading1,
    heading2,
    image,
  })
  return res.status(200).json({ status: 200, message: 'whyUsData created successfully', data: created })
})

exports.getAllwhyUsData = asyncHandler(async(req, res) => getAllContentSections(WhyUsData, res, 'whyUsData'))
exports.getwhyUsDataById = asyncHandler(async(req, res) => getContentSectionById(WhyUsData, req.params.id, res, 'whyUsData'))
exports.deletewhyUsData = asyncHandler(async(req, res) => deleteContentSectionById(WhyUsData, req.params.id, res, 'whyUsData'))

exports.addFeatureDatainwhyUsData = asyncHandler(async(req, res) => {
  const record = await WhyUsData.findOne({})
  if (!record) return res.status(404).json({ status: 404, message: 'whyUsData not found.', data: {} })

  record.featureData.push({
    feature: req.body.feature,
    steelBuilding: req.body.steelBuilding,
    wordConcerte: req.body.wordConcerte,
  })
  await record.save()
  return res.status(200).json({ status: 200, message: 'whyUsData update successfully', data: record })
})

exports.updateFeatureDataInwhyUsData = asyncHandler(async(req, res) => {
  const { feature, steelBuilding, featureDataId, wordConcerte } = req.body
  const record = await WhyUsData.findOne({})
  if (!record) return res.status(404).json({ status: 404, message: 'User not found.' })

  const existing = record.featureData.id(featureDataId)
  if (!existing) return res.status(404).json({ status: 404, message: 'Policy not found.' })

  existing.feature = feature ?? existing.feature
  existing.steelBuilding = steelBuilding ?? existing.steelBuilding
  existing.wordConcerte = wordConcerte ?? existing.wordConcerte
  await record.save()

  return res.status(200).json({ status: 200, message: 'Policy updated successfully.', data: record })
})

exports.deleteFeatureDataInwhyUsData = asyncHandler(async(req, res) => {
  const record = await WhyUsData.findOne({})
  if (!record) return res.status(200).send({ status: 200, message: 'No Data Found ', cart: [] })

  const existing = record.featureData.id(req.params.id)
  if (!existing || record.featureData.length <= 1) {
    return res.status(200).send({ status: 200, message: 'No Data Found ', data: [] })
  }

  record.featureData.pull(req.params.id)
  await record.save()
  return res.status(200).send({ message: 'Content delete from whyUsData.', data: record })
})

exports.createClientReview = asyncHandler(async(req, res) => {
  const image = await uploadImage(req.file)
  if (!image) {
    return res.status(403).json({ status: 403, message: 'Please select image.', data: {} })
  }

  const created = await ClientReview.create({
    userName: req.body.userName,
    title: req.body.title,
    description: req.body.description,
    rating: req.body.rating,
    image,
  })
  return res.status(200).json({ status: 200, message: 'ClientReview add successfully.', data: created })
})

exports.updateClientReview = asyncHandler(async(req, res) => {
  const review = await ClientReview.findById(req.params.id)
  if (!review) return res.status(404).json({ message: 'News Not Found', status: 404, data: {} })

  const image = await uploadImage(req.file)
  review.userName = req.body.userName ?? review.userName
  review.title = req.body.title ?? review.title
  review.description = req.body.description ?? review.description
  review.rating = req.body.rating ?? review.rating
  if (image) review.image = image

  const updated = await review.save()
  return res.status(200).json({ message: 'Updated Successfully', data: updated })
})

exports.getAllClientReviews = asyncHandler(async(req, res) => {
  const records = await ClientReview.find({ rating: { $gt: 4 } })
  if (!records.length) return res.status(201).json({ message: 'clientReview not Found', status: 404, data: [] })
  return res.status(201).json({ message: 'clientReview Found', status: 200, data: records })
})

exports.getClientReviewById = asyncHandler(async(req, res) => {
  const record = await ClientReview.findById(req.params.id)
  if (!record) return res.status(201).json({ message: 'clientReview not Found', status: 404, data: {} })
  return res.status(201).json({ message: 'clientReview Found', status: 200, data: record })
})

exports.removeClientReview = asyncHandler(async(req, res) => {
  const record = await ClientReview.findById(req.params.id)
  if (!record) return res.status(404).json({ message: 'clientReview Not Found', status: 404, data: {} })
  await ClientReview.findByIdAndDelete(record._id)
  return res.status(200).json({ message: 'clientReview Deleted Successfully !' })
})

exports.getAllClientReviewsForAdmin = asyncHandler(async(req, res) => {
  const records = await ClientReview.find()
  if (!records.length) return res.status(201).json({ message: 'clientReview not Found', status: 404, data: [] })
  return res.status(201).json({ message: 'clientReview Found', status: 200, data: records })
})
