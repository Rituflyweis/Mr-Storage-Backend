const { PO_PROJECT_MATCH } = require('./customerPoFilter')

const CUSTOMER_SCOPES = ['total', 'active']
const PROJECT_SCOPES = ['total', 'active', 'completed', 'not-assigned']

/** PO-raised projects that are still active (not terminated, not delivered, not deleted). */
const ACTIVE_PROJECT_MATCH = {
  ...PO_PROJECT_MATCH,
  isDeleted: { $ne: true },
  isTerminated: false,
  lifecycleStatus: { $ne: 'delivered' },
}

const COMPLETED_PROJECT_MATCH = {
  ...PO_PROJECT_MATCH,
  isDeleted: { $ne: true },
  lifecycleStatus: 'delivered',
}

const NOT_ASSIGNED_PROJECT_MATCH = {
  ...PO_PROJECT_MATCH,
  isDeleted: { $ne: true },
  assignedSales: null,
  isTerminated: false,
}

const getProjectScopeFilter = (scope) => {
  switch (scope) {
    case 'active':
      return ACTIVE_PROJECT_MATCH
    case 'completed':
      return COMPLETED_PROJECT_MATCH
    case 'not-assigned':
      return NOT_ASSIGNED_PROJECT_MATCH
    case 'total':
    default:
      return PO_PROJECT_MATCH
  }
}

const mapCustomerListRow = (customer, totalProjects) => ({
  _id: customer._id,
  customerId: customer.customerId,
  customerName: customer.firstName,
  email: customer.email,
  phone: customer.phone,
  totalProjects,
  status: customer.isActive ? 'active' : 'inactive',
})

const mapProjectListRow = (lead, customer, { includePoRaisedAt = false, poRaisedAt = null } = {}) => {
  const row = {
    leadId: lead._id,
    projectName: lead.projectName || '',
    jobId: lead.jobId || '',
    customerId: lead.customerId,
    customerName: customer?.firstName || '',
    quoteValue: lead.quoteValue || 0,
    lifecycleStatus: lead.lifecycleStatus,
  }
  if (includePoRaisedAt) row.poRaisedAt = poRaisedAt
  return row
}

module.exports = {
  CUSTOMER_SCOPES,
  PROJECT_SCOPES,
  ACTIVE_PROJECT_MATCH,
  COMPLETED_PROJECT_MATCH,
  NOT_ASSIGNED_PROJECT_MATCH,
  getProjectScopeFilter,
  mapCustomerListRow,
  mapProjectListRow,
}
