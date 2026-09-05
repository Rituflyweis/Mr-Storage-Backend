const FollowUpTemplate = require('../../models/FollowUpTemplate')
const auditService = require('../../services/audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')
const { success, created, badRequest, notFound } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null) return undefined
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return undefined
}

const parseNumber = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

exports.listTemplates = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200)
  const skip = (page - 1) * limit
  const search = String(req.query.search || '').trim()
  const isActive = parseBoolean(req.query.isActive)
  const includeDeleted = parseBoolean(req.query.includeDeleted) === true

  const filter = {}
  if (!includeDeleted) filter.isDeleted = { $ne: true }
  if (isActive !== undefined) filter.isActive = isActive
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ title: regex }, { message: regex }, { category: regex }]
  }

  const [templates, total] = await Promise.all([
    FollowUpTemplate.find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email role')
      .populate('updatedBy', 'name email role')
      .lean(),
    FollowUpTemplate.countDocuments(filter),
  ])

  return success(res, {
    templates,
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(Math.ceil(total / limit), 1),
    },
  })
})

exports.getTemplate = asyncHandler(async (req, res) => {
  const template = await FollowUpTemplate.findOne({
    _id: req.params.templateId,
    isDeleted: { $ne: true },
  })
    .populate('createdBy', 'name email role')
    .populate('updatedBy', 'name email role')
    .lean()
  if (!template) return notFound(res, 'Template not found')
  return success(res, { template })
})

exports.createTemplate = asyncHandler(async (req, res) => {
  const title = String(req.body.title || '').trim()
  const message = String(req.body.message || '').trim()
  const category = String(req.body.category || 'general').trim().toLowerCase()

  if (!title) return badRequest(res, 'title is required')
  if (!message) return badRequest(res, 'message is required')

  const duplicate = await FollowUpTemplate.findOne({
    isDeleted: { $ne: true },
    title,
    message,
  }).select('_id')
  if (duplicate) return badRequest(res, 'A template with same title and message already exists')

  const parsedIsActive =
    req.body.isActive !== undefined ? parseBoolean(req.body.isActive) : true
  if (parsedIsActive === undefined) return badRequest(res, 'isActive must be boolean')

  const template = await FollowUpTemplate.create({
    title,
    message,
    category,
    sortOrder: parseNumber(req.body.sortOrder, 0),
    isActive: parsedIsActive,
    createdBy: req.user?._id || null,
    updatedBy: req.user?._id || null,
  })

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_TEMPLATE_CREATED,
    performedBy: req.user?._id || null,
    metadata: {
      templateId: String(template._id),
      title: template.title,
      category: template.category,
      isActive: template.isActive,
    },
  })

  return created(res, { template }, 'Follow-up template created')
})

exports.updateTemplate = asyncHandler(async (req, res) => {
  const template = await FollowUpTemplate.findOne({
    _id: req.params.templateId,
    isDeleted: { $ne: true },
  })
  if (!template) return notFound(res, 'Template not found')

  const updates = {}
  if (req.body.title !== undefined) {
    const title = String(req.body.title || '').trim()
    if (!title) return badRequest(res, 'title cannot be empty')
    template.title = title
    updates.title = title
  }
  if (req.body.message !== undefined) {
    const message = String(req.body.message || '').trim()
    if (!message) return badRequest(res, 'message cannot be empty')
    template.message = message
    updates.message = true
  }
  if (req.body.category !== undefined) {
    const category = String(req.body.category || '').trim().toLowerCase()
    template.category = category || 'general'
    updates.category = template.category
  }
  if (req.body.sortOrder !== undefined) {
    template.sortOrder = parseNumber(req.body.sortOrder, template.sortOrder)
    updates.sortOrder = template.sortOrder
  }
  if (req.body.isActive !== undefined) {
    const nextActive = parseBoolean(req.body.isActive)
    if (nextActive === undefined) return badRequest(res, 'isActive must be boolean')
    template.isActive = nextActive
    updates.isActive = nextActive
  }

  const duplicate = await FollowUpTemplate.findOne({
    _id: { $ne: template._id },
    isDeleted: { $ne: true },
    title: template.title,
    message: template.message,
  }).select('_id')
  if (duplicate) return badRequest(res, 'A template with same title and message already exists')

  template.updatedBy = req.user?._id || template.updatedBy
  await template.save()

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_TEMPLATE_UPDATED,
    performedBy: req.user?._id || null,
    metadata: {
      templateId: String(template._id),
      updates,
    },
  })

  return success(res, { template }, 'Follow-up template updated')
})

exports.deleteTemplate = asyncHandler(async (req, res) => {
  const template = await FollowUpTemplate.findOne({
    _id: req.params.templateId,
    isDeleted: { $ne: true },
  })
  if (!template) return notFound(res, 'Template not found')

  template.isDeleted = true
  template.deletedAt = new Date()
  template.deletedBy = req.user?._id || null
  template.updatedBy = req.user?._id || null
  await template.save()

  await auditService.log({
    type: 'followup',
    action: AUDIT_ACTIONS.FOLLOWUP_TEMPLATE_DELETED,
    performedBy: req.user?._id || null,
    metadata: {
      templateId: String(template._id),
      title: template.title,
    },
  })

  return success(res, { template }, 'Follow-up template deleted')
})
