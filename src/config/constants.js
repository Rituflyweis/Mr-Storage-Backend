const USER_ROLES = ['admin', 'sales', 'construction', 'plant', 'account']
const LEAD_SOURCES = ['chat', 'manual', 'import', 'customer_portal']
const LEAD_TEMPERATURES = ['hot', 'warm', 'cold']

/** Score 0–100 → hot (≥70), warm (40–69), cold (<40). */
const resolveLeadTemperatureFromScore = (score = 0) => {
  const n = Math.min(100, Math.max(0, Number(score) || 0))
  if (n >= 70) return 'hot'
  if (n >= 40) return 'warm'
  return 'cold'
}

const LIFECYCLE_STAGES = [
  'initial_contact',
  'requirements_gathered',
  'proposal_sent',
  'negotiation',
  'deal_closed',
  'payment_done',
  'converted_to_po',
  'sent_to_admin',
]

const CLOSED_STAGES = ['deal_closed', 'payment_done', 'converted_to_po', 'sent_to_admin']

const PRIORITY_LEVELS = ['low', 'medium', 'high', 'urgent']
const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected']
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled']
const FOLLOW_UP_STATUSES = ['pending', 'completed']
const FOLLOW_UP_MODES = ['call', 'email', 'meeting']
const MEETING_MODES = ['online', 'offline']
const MEETING_STATUSES = ['scheduled', 'completed', 'cancelled', 'rescheduled']
const ESCALATION_STATUSES = ['pending', 'resolved']
const PO_STATUSES = ['pending', 'approved', 'rejected']
const PAYMENT_AMOUNT_TYPES = ['percentage', 'fixed']
const PAYMENT_STAGE_STATUSES = ['pending', 'invoiced', 'paid', 'overdue']
const ASSIGN_METHODS = ['auto', 'manual']

const AUDIT_TYPES = [
  'lead', 'invoice', 'quotation', 'meeting',
  'followup', 'user', 'escalation', 'po', 'chat', 'activity',
]

const AUDIT_ACTIONS = {
  LEAD_CREATED:             'lead.created',
  LEAD_ASSIGNED_AUTO:       'lead.assigned.auto',
  LEAD_ASSIGNED_MANUAL:     'lead.assigned.manual',
  LEAD_QUOTE_READY:         'lead.quote_ready',
  LEAD_HANDED_TO_SALES:     'lead.handed_to_sales',
  LEAD_LIFECYCLE_UPDATED:   'lead.lifecycle_updated',
  LEAD_ESCALATED:           'lead.escalated',
  LEAD_PO_RAISED:           'lead.po_raised',
  LEAD_PO_APPROVED:         'lead.po_approved',
  LEAD_PO_REJECTED:         'lead.po_rejected',
  LEAD_EDITED:              'lead.edited',
  LEAD_TEMPERATURE_UPDATED: 'lead.temperature_updated',
  LEAD_TERMINATED:          'lead.terminated',
  BUILDINGS_CREATED:        'lead.buildings_created',
  BOM_APPROVED:             'bom.approved',
  BOM_REJECTED:             'bom.rejected',
  QUOTATION_CREATED:        'quotation.created',
  QUOTATION_SENT:           'quotation.sent',
  QUOTATION_ACCEPTED:       'quotation.accepted',
  QUOTATION_EDITED:         'quotation.edited',
  INVOICE_CREATED:          'invoice.created',
  INVOICE_SENT:             'invoice.sent',
  INVOICE_PAID:             'invoice.paid',
  INVOICE_EDITED:           'invoice.edited',
  PAYMENT_STAGE_INVOICED:   'payment.stage_invoiced',
  PAYMENT_STAGE_PAID:       'payment.stage_paid',
  MEETING_CREATED:          'meeting.created',
  MEETING_EDITED:           'meeting.edited',
  MEETING_COMPLETED:        'meeting.completed',
  FOLLOWUP_CREATED:         'followup.created',
  FOLLOWUP_COMPLETED:       'followup.completed',
  ESCALATION_CREATED:       'escalation.created',
  ESCALATION_RESOLVED:      'escalation.resolved',
  USER_CREATED:             'user.created',
  USER_UPDATED:             'user.updated',
  DOCUMENT_ADDED:           'lead.document_added',
  DOCUMENT_REMOVED:         'lead.document_removed',
  BUDGET_SET:               'lead.budget_set',
  CUSTOMER_CREATED:         'customer.created',
  CUSTOMER_UPDATED:         'customer.updated',
  CUSTOMER_DEACTIVATED:     'customer.deactivated',
  CUSTOMER_ACTIVATED:       'customer.activated',
  CUSTOMER_PROJECT_CREATED: 'customer.project_created',
  ACTIVITY_LOGGED:          'activity.logged',

  // Backward-compatible alias; remove after payment schedule migration is complete.
  PAYMENT_MARKED_PAID:      'payment.stage_paid',
}

const BUILDING_STATUSES = [
  'pending', 'drawing_pending', 'drawing_uploaded',
  'drawing_approved', 'drawing_rejected',
  'bom_pending', 'bom_approved', 'completed',
]

// Backward-compatible alias for old model/controller usage during migration.
const PAYMENT_ITEM_STATUSES = PAYMENT_STAGE_STATUSES

module.exports = {
  USER_ROLES,
  LEAD_SOURCES,
  LEAD_TEMPERATURES,
  resolveLeadTemperatureFromScore,
  LIFECYCLE_STAGES,
  CLOSED_STAGES,
  PRIORITY_LEVELS,
  QUOTATION_STATUSES,
  INVOICE_STATUSES,
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_MODES,
  MEETING_MODES,
  MEETING_STATUSES,
  ESCALATION_STATUSES,
  PO_STATUSES,
  PAYMENT_AMOUNT_TYPES,
  PAYMENT_STAGE_STATUSES,
  PAYMENT_ITEM_STATUSES,
  ASSIGN_METHODS,
  AUDIT_TYPES,
  AUDIT_ACTIONS,
  BUILDING_STATUSES,
}
