const { LEAD_TEMPERATURES, resolveLeadTemperatureFromScore } = require('../config/constants')

const PERMISSION_LABELS = {
  leadAccess: 'Lead Access',
  followupsAccess: 'Follow-ups Access',
  reportsAccess: 'Reports Access',
  aiSupportAccess: 'AI Support Access',
  settingsAccess: 'Settings Access',
  employees: 'Employees',
  taxReport: 'Tax Report',
  insights: 'Insights',
  addNewLead: 'Add New Lead',
  scheduleMeeting: 'Schedule Meeting',
  generateReport: 'Generate Report',
}

const LIFECYCLE_STATUS_LABELS = {
  initial_contact: 'Initial Contact',
  requirements_gathered: 'Requirements Gathered',
  requirements_collected: 'Requirements Collected',
  proposal_sent: 'Quotation Sent',
  negotiation: 'Negotiation',
  deal_closed: 'Deal Closed',
  payment_done: 'Payment Received',
  converted_to_po: 'Converted to PO',
  sent_to_admin: 'Sent to Admin',
  released_to_plant: 'Released to Plant',
  drawings_received: 'Drawings Received',
  bom_received: 'BOM Ready',
  bom_review: 'BOM Review',
  material_check: 'Material Check',
  production_planning: 'Production Planning',
  fabrication_started: 'Fabrication Started',
  quality_inspection: 'Quality Inspection',
  packing_bundling: 'Packing & Bundling',
  shipper_prepared: 'Shipper Prepared',
  ready_for_delivery: 'Ready for Delivery',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
}

const ROLE_DISPLAY = {
  sales: 'Sales',
  plant: 'Plant',
  construction: 'Construction',
  account: 'Account',
  admin: 'Admin',
}

const capitalize = (value) => {
  const s = String(value || '').trim()
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const formatLifecycleStatusLabel = (status) => {
  if (!status) return ''
  if (LIFECYCLE_STATUS_LABELS[status]) return LIFECYCLE_STATUS_LABELS[status]
  return String(status)
    .split('_')
    .map((part) => capitalize(part))
    .join(' ')
}

const buildPermissionTags = (permissions = {}) => {
  const tags = []
  for (const [key, label] of Object.entries(PERMISSION_LABELS)) {
    const entry = permissions[key]
    if (entry && (entry.view || entry.edit || entry.delete)) tags.push(label)
  }
  return tags
}

const formatRoleLabel = (role, department = '') => {
  const roleName = ROLE_DISPLAY[role] || capitalize(role)
  const dept = String(department || '').trim()
  if (dept) return `${dept} - ${roleName}`
  return `Manager - ${roleName}`
}

const resolveLeadTemperature = (lead = {}) => {
  const scoring = lead.leadScoring || {}
  if (scoring.temperature && LEAD_TEMPERATURES.includes(scoring.temperature)) {
    return scoring.temperature
  }
  return resolveLeadTemperatureFromScore(scoring.score)
}

const formatScoreStateLabel = (temperature) => {
  if (!temperature) return ''
  return capitalize(temperature)
}

const buildWorkSummary = (role, count) => {
  if (role === 'sales') {
    return { count, label: 'leads assigned', shortLabel: `${count} leads assigned` }
  }
  if (role === 'plant' || role === 'construction') {
    return { count, label: 'active projects', shortLabel: `${count} active projects` }
  }
  if (role === 'account') {
    return { count, label: 'invoices', shortLabel: `${count} invoices` }
  }
  return { count, label: 'assignments', shortLabel: `${count} assignments` }
}

module.exports = {
  PERMISSION_LABELS,
  formatLifecycleStatusLabel,
  buildPermissionTags,
  formatRoleLabel,
  resolveLeadTemperature,
  formatScoreStateLabel,
  buildWorkSummary,
  ROLE_DISPLAY,
}
