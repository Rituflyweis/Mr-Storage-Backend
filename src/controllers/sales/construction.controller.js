const Lead = require('../../models/Lead')
const { PLANT_LIFECYCLE_STAGES } = require('../../config/constants')
const { success } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const { businessUnitFields, applyBusinessUnitFilter } = require('../../utils/businessUnit')
const {
  buildConstructionDeliveryCalendar,
  resolveConstructionCalendarLeadIds,
} = require('../../utils/constructionProjectCalendar')

const PROJECT_SELECT = 'projectName jobId businessUnit location lifecycleStatus endDate plannedStartDate'

exports.getProjectCalendar = asyncHandler(async (req, res) => {
  const now = new Date()
  const m = Number(req.query.month) || now.getMonth() + 1
  const y = Number(req.query.year) || now.getFullYear()
  const { leadId } = req.query

  const leadIds = await resolveConstructionCalendarLeadIds({
    stages: PLANT_LIFECYCLE_STAGES,
    businessUnit: req.query.businessUnit,
    assignedSalesId: req.user._id,
  })

  const payload = await buildConstructionDeliveryCalendar({
    leadIds,
    month: m,
    year: y,
    filterLeadId: leadId,
    businessUnit: req.query.businessUnit,
  })

  return success(res, { ...payload, scope: 'sales_assigned_construction' })
})

exports.getProjects = asyncHandler(async (req, res) => {
  const filter = {
    assignedSales: req.user._id,
    isTerminated: { $ne: true },
    isArchived: { $ne: true },
    lifecycleStatus: { $in: PLANT_LIFECYCLE_STAGES },
  }
  applyBusinessUnitFilter(filter, req.query.businessUnit)

  const leads = await Lead.find(filter)
    .select(PROJECT_SELECT)
    .sort({ projectName: 1 })
    .lean()

  return success(res, {
    projects: leads.map((l) => ({ ...l, ...businessUnitFields(l) })),
    total: leads.length,
    scope: 'sales_assigned_construction',
  })
})
