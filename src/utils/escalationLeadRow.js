const Escalation = require('../models/Escalation')
const { withProjectIdFields } = require('./leadProjectId')
const { mapProjectNameFallbackFields } = require('./plantProjectListFields')

const buildUserSummary = (user) => {
  if (!user) return null
  if (typeof user !== 'object') return null

  const name = String(user.name || '').trim()
  const email = String(user.email || '').trim()
  const role = String(user.role || '').trim()

  // Unpopulated ObjectId ref — no display fields available
  if (!name && !email && !role) return null

  const nameParts = name.split(/\s+/).filter(Boolean)

  return {
    _id: user._id,
    name,
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
    email,
    role,
  }
}

const buildCustomerSummary = (customer) => {
  if (!customer || typeof customer !== 'object') return null

  const customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim()

  return {
    _id: customer._id,
    customerId: customer.customerId || '',
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    customerName,
    email: customer.email || '',
    phone: customer.phone || null,
    company: customer.company || '',
    location: customer.location || '',
  }
}

const mapEscalationLeadRow = (escalation) => {
  const lead = escalation.leadId && typeof escalation.leadId === 'object'
    ? escalation.leadId
    : null
  const customer = escalation.customerId && typeof escalation.customerId === 'object'
    ? escalation.customerId
    : null

  const customerSummary = buildCustomerSummary(customer)
  const escalatedBy = buildUserSummary(escalation.raisedBy)
  const assignedTo = buildUserSummary(lead?.assignedSales)
  const isResolved = escalation.status === 'resolved'
  const resolvedBy = buildUserSummary(escalation.resolvedBy)
  const resolvedAssignedTo = buildUserSummary(
    escalation.resolvedAssignedTo || (isResolved ? lead?.assignedSales : null)
  )

  return withProjectIdFields({
    _id: lead?._id,
    projectName: lead?.projectName || '',
    lifecycleStatus: lead?.lifecycleStatus || '',
    quoteValue: lead?.quoteValue || 0,
    customerId: customerSummary,
    customerName: customerSummary?.customerName || '',
    assignedTo,
    escalatedBy,
    resolvedBy,
    resolvedAssignedTo,
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
      resolvedAt: escalation.resolvedAt || null,
      escalatedBy,
      resolvedBy,
      resolvedAssignedTo,
    },
  }, lead?.jobId)
}

const ESCALATION_LEAD_POPULATE = [
  {
    path: 'leadId',
    select: '_id jobId projectName lifecycleStatus quoteValue buildingType location customerId assignedSales',
    populate: {
      path: 'assignedSales',
      select: '_id name email role',
    },
  },
  {
    path: 'customerId',
    select: 'customerId firstName lastName email phone company location',
  },
  {
    path: 'raisedBy',
    select: '_id name email role',
  },
  {
    path: 'resolvedBy',
    select: '_id name email role',
  },
  {
    path: 'resolvedAssignedTo',
    select: '_id name email role',
  },
]

module.exports = {
  mapEscalationLeadRow,
  ESCALATION_LEAD_POPULATE,
  loadEscalationWithRelations: async (escalationId) =>
    Escalation.findById(escalationId).populate(ESCALATION_LEAD_POPULATE).lean(),
}
