const Lead = require('../models/Lead')
const Delivery = require('../models/Delivery')
const { businessUnitFields, applyBusinessUnitFilter } = require('./businessUnit')

const buildConstructionDeliveryCalendar = async ({
  leadIds,
  month,
  year,
  filterLeadId,
  businessUnit,
}) => {
  const m = Number(month)
  const y = Number(year)
  const startOfMonth = new Date(y, m - 1, 1)
  const endOfMonth = new Date(y, m, 0, 23, 59, 59)

  if (!leadIds.length) {
    return { month: m, year: y, calendar: {}, totalDeliveries: 0 }
  }

  const allowedSet = new Set(leadIds.map(String))
  if (filterLeadId && !allowedSet.has(String(filterLeadId))) {
    return { month: m, year: y, calendar: {}, totalDeliveries: 0 }
  }

  const deliveryFilter = {
    leadId: filterLeadId || { $in: leadIds },
    deliveryDate: { $gte: startOfMonth, $lte: endOfMonth },
    status: { $ne: 'draft' },
  }

  const deliveries = await Delivery.find(deliveryFilter)
    .select('deliveryDate deliveryNumber status description loadDescription leadId')
    .populate('leadId', 'projectName jobId businessUnit location lifecycleStatus assignedSales')
    .lean()

  const calendarMap = {}
  for (const d of deliveries) {
    if (!d.deliveryDate) continue
    const dateKey = new Date(d.deliveryDate).toISOString().split('T')[0]
    if (!calendarMap[dateKey]) calendarMap[dateKey] = []
    calendarMap[dateKey].push({
      deliveryId: d._id,
      deliveryNumber: d.deliveryNumber,
      status: d.status,
      description: d.loadDescription || d.description || '',
      project: {
        leadId: d.leadId?._id,
        projectName: d.leadId?.projectName,
        jobId: d.leadId?.jobId,
        ...businessUnitFields(d.leadId),
        location: d.leadId?.location,
        lifecycleStatus: d.leadId?.lifecycleStatus,
      },
    })
  }

  return {
    month: m,
    year: y,
    calendar: calendarMap,
    totalDeliveries: deliveries.length,
  }
}

const resolveConstructionCalendarLeadIds = async ({ stages, businessUnit, assignedSalesId }) => {
  const filter = {
    isTerminated: { $ne: true },
    isArchived: { $ne: true },
    lifecycleStatus: { $in: stages },
  }
  if (assignedSalesId) filter.assignedSales = assignedSalesId
  applyBusinessUnitFilter(filter, businessUnit)
  const rows = await Lead.find(filter).select('_id').lean()
  return rows.map((r) => r._id)
}

module.exports = {
  buildConstructionDeliveryCalendar,
  resolveConstructionCalendarLeadIds,
}
