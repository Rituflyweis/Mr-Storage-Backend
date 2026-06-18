/** Fields for FE project title fallback when projectName is empty. */
const mapProjectNameFallbackFields = (lead) => {
  if (!lead) {
    return {
      customerName: '',
      buildingType: '',
      location: '',
    }
  }

  const customer = lead.customerId
  const customerName =
    customer && typeof customer === 'object'
      ? `${customer.firstName || ''} ${customer.lastName || ''}`.trim()
      : ''

  return {
    customerName,
    buildingType: lead.buildingType || '',
    location: lead.location || '',
  }
}

const LEAD_PROJECT_LIST_SELECT = 'projectName jobId buildingType location customerId'

const LEAD_PROJECT_LIST_POPULATE = {
  path: 'customerId',
  select: 'firstName lastName',
}

module.exports = {
  mapProjectNameFallbackFields,
  LEAD_PROJECT_LIST_SELECT,
  LEAD_PROJECT_LIST_POPULATE,
}
