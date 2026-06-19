const { withProjectIdFields } = require('./leadProjectId')
const { mapProjectNameFallbackFields } = require('./plantProjectListFields')

const buildAssignedTo = (assignedSales) => {
  if (!assignedSales) return null

  const name = String(assignedSales.name || '').trim()
  const nameParts = name.split(/\s+/).filter(Boolean)

  return {
    _id: assignedSales._id,
    firstName: assignedSales.firstName || nameParts[0] || '',
    lastName: assignedSales.lastName || nameParts.slice(1).join(' ') || '',
    email: assignedSales.email || '',
  }
}

const buildCustomerSummary = (customer) => {
  if (!customer) return null

  const customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim()

  return {
    _id: customer._id,
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    customerName,
    email: customer.email || '',
  }
}

const mapEscalationLeadRow = (escalation) => {
  const lead = escalation.leadId && typeof escalation.leadId === 'object'
    ? escalation.leadId
    : null
  const customer = escalation.customerId && typeof escalation.customerId === 'object'
    ? escalation.customerId
    : null

  return withProjectIdFields({
    _id: lead?._id,
    projectName: lead?.projectName || '',
    lifecycleStatus: lead?.lifecycleStatus || '',
    quoteValue: lead?.quoteValue || 0,
    customerId: buildCustomerSummary(customer),
    assignedTo: buildAssignedTo(lead?.assignedSales),
    ...mapProjectNameFallbackFields({
      buildingType: lead?.buildingType,
      location: lead?.location,
      customerId: customer,
    }),
    escalation: {
      _id: escalation._id,
      note: escalation.note,
      status: escalation.status,
      createdAt: escalation.createdAt,
    },
  }, lead?.jobId)
}

const ESCALATION_LEAD_POPULATE = [
  {
    path: 'leadId',
    select: '_id jobId projectName lifecycleStatus quoteValue buildingType location customerId assignedSales',
    populate: {
      path: 'assignedSales',
      select: '_id name email',
    },
  },
  {
    path: 'customerId',
    select: 'firstName lastName email',
  },
]

module.exports = {
  mapEscalationLeadRow,
  ESCALATION_LEAD_POPULATE,
}
