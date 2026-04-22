const USER_ROLES = ['admin', 'sales', 'construction', 'plant', 'account']

const LEAD_SOURCES = ['chat', 'manual', 'import', 'customer_portal']

const LIFECYCLE_STAGES = [
  'initial_contact',
  'requirements_collected',
  'proposal_sent',
  'negotiation',
  'deal_closed',
  'payment_done',
  'delivered',
]

// Stages that count as "closed" for conversion rate / performance stats
const CLOSED_STAGES = ['deal_closed', 'payment_done', 'delivered']

const PRIORITY_LEVELS = ['low', 'medium', 'high', 'urgent']

const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected']

const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled']

const FOLLOW_UP_STATUSES = ['pending', 'completed']

const MEETING_MODES = ['online', 'offline']

const MEETING_STATUSES = ['scheduled', 'completed', 'cancelled']

const ESCALATION_STATUSES = ['pending', 'resolved']

const PO_STATUSES = ['pending', 'approved', 'rejected']

const PAYMENT_AMOUNT_TYPES = ['percentage', 'fixed']

const PAYMENT_ITEM_STATUSES = ['pending', 'paid', 'overdue']

const ASSIGN_METHODS = ['auto', 'manual']

const AUDIT_TYPES = [
  'lead', 'invoice', 'quotation', 'meeting',
  'followup', 'user', 'escalation', 'po', 'chat',
]

// Canonical audit actions — use these everywhere, never freehand strings
const AUDIT_ACTIONS = {
  LEAD_CREATED:           'lead.created',
  LEAD_ASSIGNED_AUTO:     'lead.assigned.auto',
  LEAD_ASSIGNED_MANUAL:   'lead.assigned.manual',
  LEAD_QUOTE_READY:       'lead.quote_ready',
  LEAD_HANDED_TO_SALES:   'lead.handed_to_sales',
  LEAD_LIFECYCLE_UPDATED: 'lead.lifecycle_updated',
  LEAD_ESCALATED:         'lead.escalated',
  LEAD_PO_RAISED:         'lead.po_raised',
  LEAD_PO_APPROVED:       'lead.po_approved',
  LEAD_PO_REJECTED:       'lead.po_rejected',
  LEAD_EDITED:            'lead.edited',
  QUOTATION_CREATED:      'quotation.created',
  QUOTATION_SENT:         'quotation.sent',
  QUOTATION_ACCEPTED:     'quotation.accepted',
  QUOTATION_EDITED:       'quotation.edited',
  INVOICE_CREATED:        'invoice.created',
  INVOICE_SENT:           'invoice.sent',
  INVOICE_PAID:           'invoice.paid',
  INVOICE_EDITED:         'invoice.edited',
  MEETING_CREATED:        'meeting.created',
  MEETING_EDITED:         'meeting.edited',
  MEETING_COMPLETED:      'meeting.completed',
  FOLLOWUP_CREATED:       'followup.created',
  FOLLOWUP_COMPLETED:     'followup.completed',
  ESCALATION_CREATED:     'escalation.created',
  ESCALATION_RESOLVED:    'escalation.resolved',
  USER_CREATED:           'user.created',
  USER_UPDATED:           'user.updated',
  DOCUMENT_ADDED:           'lead.document_added',
  DOCUMENT_REMOVED:         'lead.document_removed',
  PAYMENT_MARKED_PAID:      'payment.item_paid',
  CUSTOMER_PROJECT_CREATED: 'customer.project_created',
}

module.exports = {
  USER_ROLES,
  LEAD_SOURCES,
  LIFECYCLE_STAGES,
  CLOSED_STAGES,
  PRIORITY_LEVELS,
  QUOTATION_STATUSES,
  INVOICE_STATUSES,
  FOLLOW_UP_STATUSES,
  MEETING_MODES,
  MEETING_STATUSES,
  ESCALATION_STATUSES,
  PO_STATUSES,
  PAYMENT_AMOUNT_TYPES,
  PAYMENT_ITEM_STATUSES,
  ASSIGN_METHODS,
  AUDIT_TYPES,
  AUDIT_ACTIONS,
}
