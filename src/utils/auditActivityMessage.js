const { AUDIT_ACTIONS } = require('../config/constants')

const ROLE_PANEL_LABELS = {
  admin: 'Admin',
  sales: 'Sales',
  construction: 'Construction',
  plant: 'Plant',
  account: 'Accounts',
}

const ACTIVITY_TYPE_LABELS = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  note: 'Note',
}

const pick = (...values) => {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

const formatAuditActivityMessage = (log, context = {}) => {
  const action = log?.action || ''
  const meta = log?.metadata || {}
  const customer = pick(
    context.customerName,
    meta.customerName,
    meta.firstName,
    log?.customerId?.firstName,
    meta.email,
    log?.customerId?.email
  )
  const project = pick(
    context.projectName,
    meta.projectName,
    log?.leadId?.projectName
  )
  const forCustomer = customer ? ` for ${customer}` : ''
  const forProject = project ? ` for ${project}` : ''
  const ctx = `${forCustomer}${forProject}`.replace(/^ for /, ' for ')

  switch (action) {
    case AUDIT_ACTIONS.QUOTATION_CREATED:
      return `Quotation created${ctx}`
    case AUDIT_ACTIONS.QUOTATION_SENT:
      return `Quotation sent${ctx}`
    case AUDIT_ACTIONS.QUOTATION_ACCEPTED:
      return `Quotation accepted${ctx}`
    case AUDIT_ACTIONS.QUOTATION_EDITED:
      return `Quotation updated${ctx}`

    case AUDIT_ACTIONS.INVOICE_CREATED:
      return meta.invoiceNumber
        ? `Invoice ${meta.invoiceNumber} created${forProject || forCustomer}`
        : `Invoice created${ctx}`
    case AUDIT_ACTIONS.INVOICE_SENT:
      return meta.invoiceNumber
        ? `Invoice ${meta.invoiceNumber} sent${forProject || forCustomer}`
        : `Invoice sent${ctx}`
    case AUDIT_ACTIONS.INVOICE_PAID:
      return meta.invoiceNumber
        ? `Invoice ${meta.invoiceNumber} marked paid${forProject || forCustomer}`
        : `Invoice marked paid${ctx}`
    case AUDIT_ACTIONS.INVOICE_EDITED:
      return `Invoice updated${ctx}`
    case AUDIT_ACTIONS.PAYMENT_STAGE_INVOICED:
      return `Payment stage invoiced${forProject}`
    case AUDIT_ACTIONS.PAYMENT_STAGE_PAID:
    case AUDIT_ACTIONS.PAYMENT_MARKED_PAID:
      return `Payment stage marked paid${forProject}`
    case AUDIT_ACTIONS.PAYMENT_SCHEDULE_UPDATED:
      return `Payment schedule updated${forProject}`

    case AUDIT_ACTIONS.LEAD_CREATED:
      return `Lead created${ctx}`
    case AUDIT_ACTIONS.CUSTOMER_PROJECT_CREATED:
      return `Project created${ctx}`
    case AUDIT_ACTIONS.LEAD_EDITED:
      return `Lead updated${forProject || forCustomer}`
    case AUDIT_ACTIONS.LEAD_ASSIGNED_MANUAL:
      return meta.employeeName
        ? `Lead assigned to ${meta.employeeName}${forProject}`
        : `Lead assigned${forProject}`
    case AUDIT_ACTIONS.LEAD_ASSIGNED_AUTO:
      return `Lead auto-assigned${forProject}`
    case AUDIT_ACTIONS.LEAD_QUOTE_READY:
      return `Quote ready${forProject || forCustomer}`
    case AUDIT_ACTIONS.LEAD_HANDED_TO_SALES:
      return `Lead handed to sales${forProject || forCustomer}`
    case AUDIT_ACTIONS.LEAD_LIFECYCLE_UPDATED:
      return meta.lifecycleStatus
        ? `Lifecycle updated to ${meta.lifecycleStatus}${forProject}`
        : `Lifecycle updated${forProject}`
    case AUDIT_ACTIONS.LEAD_RELEASED_TO_PLANT:
      return meta.assignedToName
        ? `Project released to plant (${meta.assignedToName})${forProject}`
        : `Project released to plant${forProject}`
    case AUDIT_ACTIONS.LEAD_TEMPERATURE_UPDATED:
      return meta.temperature
        ? `Lead temperature set to ${meta.temperature}${forProject}`
        : `Lead temperature updated${forProject}`
    case AUDIT_ACTIONS.LEAD_TERMINATED:
      return `Lead terminated${forProject}`
    case AUDIT_ACTIONS.LEAD_NOTE_ADDED:
      return meta.notePreview
        ? `Note added${forProject}: ${meta.notePreview}`
        : `Note added${forProject}`
    case AUDIT_ACTIONS.LEAD_ESCALATED:
      return `Lead escalated${forProject}`
    case AUDIT_ACTIONS.LEAD_PO_RAISED:
      return meta.poNumber
        ? `PO ${meta.poNumber} raised${forProject}`
        : `PO order raised${forProject}`
    case AUDIT_ACTIONS.LEAD_PO_APPROVED:
      return `PO order approved${forProject}`
    case AUDIT_ACTIONS.LEAD_PO_REJECTED:
      return `PO order rejected${forProject}`
    case AUDIT_ACTIONS.BUILDINGS_CREATED:
      return meta.numberOfBuildings
        ? `Buildings created (${meta.numberOfBuildings})${forProject}`
        : `Buildings created${forProject}`
    case AUDIT_ACTIONS.BOM_APPROVED:
      return meta.buildingNumber
        ? `BOM approved for building ${meta.buildingNumber}${forProject}`
        : `BOM approved${forProject}`
    case AUDIT_ACTIONS.BOM_REJECTED:
      return meta.buildingNumber
        ? `BOM rejected for building ${meta.buildingNumber}${forProject}`
        : `BOM rejected${forProject}`
    case AUDIT_ACTIONS.BUDGET_SET:
      return `Project budget set${forProject}`
    case AUDIT_ACTIONS.DOCUMENT_ADDED:
      return meta.documentType === 'contract'
        ? `Agreement uploaded${forProject}`
        : meta.name
          ? `Document "${meta.name}" added${forProject}`
          : `Document added${forProject}`
    case AUDIT_ACTIONS.DOCUMENT_REMOVED:
      return meta.name
        ? `Document "${meta.name}" removed${forProject}`
        : `Document removed${forProject}`

    case AUDIT_ACTIONS.MEETING_CREATED:
      return meta.title
        ? `Meeting scheduled: ${meta.title}${forCustomer}`
        : `Meeting scheduled${ctx}`
    case AUDIT_ACTIONS.MEETING_EDITED:
      return `Meeting updated${ctx}`
    case AUDIT_ACTIONS.MEETING_COMPLETED:
      return `Meeting completed${ctx}`

    case AUDIT_ACTIONS.FOLLOWUP_CREATED:
      return `Follow-up created${forProject || forCustomer}`
    case AUDIT_ACTIONS.FOLLOWUP_COMPLETED:
      return `Follow-up completed${forProject || forCustomer}`

    case AUDIT_ACTIONS.ESCALATION_CREATED:
      return `Escalation created${forProject}`
    case AUDIT_ACTIONS.ESCALATION_RESOLVED:
      return meta.employeeName
        ? `Escalation resolved — assigned to ${meta.employeeName}${forProject}`
        : `Escalation resolved${forProject}`

    case AUDIT_ACTIONS.CUSTOMER_CREATED:
      return customer
        ? `Customer created: ${customer}`
        : 'Customer created'
    case AUDIT_ACTIONS.CUSTOMER_UPDATED:
      return customer
        ? `Customer updated: ${customer}`
        : 'Customer updated'
    case AUDIT_ACTIONS.CUSTOMER_DEACTIVATED:
      return customer
        ? `Customer deactivated: ${customer}`
        : 'Customer deactivated'
    case AUDIT_ACTIONS.CUSTOMER_ACTIVATED:
      return customer
        ? `Customer activated: ${customer}`
        : 'Customer activated'

    case AUDIT_ACTIONS.USER_CREATED:
      return meta.name
        ? `Employee created: ${meta.name}${meta.role ? ` (${meta.role})` : ''}`
        : 'Employee created'
    case AUDIT_ACTIONS.USER_UPDATED:
      return 'Employee updated'

    case AUDIT_ACTIONS.ACTIVITY_LOGGED: {
      const typeLabel = ACTIVITY_TYPE_LABELS[meta.activityType] || 'Activity'
      return `${typeLabel} logged${ctx}`
    }

    default: {
      const label = action.replace(/\./g, ' ').replace(/_/g, ' ')
      return label.charAt(0).toUpperCase() + label.slice(1) + ctx
    }
  }
}

const resolveRolePanel = (role) => ROLE_PANEL_LABELS[role] || role || 'Unknown'

module.exports = {
  formatAuditActivityMessage,
  resolveRolePanel,
  ROLE_PANEL_LABELS,
}
