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

const SALES_LIFECYCLE_STAGES = [
  'initial_contact',
  'requirements_gathered',
  'proposal_sent',
  'negotiation',
  'deal_closed',
  'payment_done',
  'converted_to_po',
  'sent_to_admin',
]

/** Plant panel stages — set after PO assign; forward-only updates via plant API */
const PLANT_LIFECYCLE_STAGES = [
  'released_to_plant',
  'drawings_received',
  'bom_received',
  'bom_review',
  'material_check',
  'production_planning',
  'fabrication_started',
  'quality_inspection',
  'packing_bundling',
  'shipper_prepared',
  'ready_for_delivery',
  'dispatched',
  'delivered',
]

const LIFECYCLE_STAGES = [...SALES_LIFECYCLE_STAGES, ...PLANT_LIFECYCLE_STAGES]

const CLOSED_STAGES = ['deal_closed', 'payment_done', 'converted_to_po', 'sent_to_admin', 'delivered']

/** Lifecycle stages that allow sales to raise a PO order */
const PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES = [
  'proposal_sent',
  'negotiation',
  'deal_closed',
  'payment_done',
]

/** Minimum lifecycle stage required to create an invoice on a lead */
const INVOICE_CREATE_MIN_LIFECYCLE_STAGE = 'proposal_sent'

const PRIORITY_LEVELS = ['low', 'medium', 'high', 'urgent']
const QUOTATION_STATUSES = ['draft', 'sent', 'accepted', 'rejected']
const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'cancelled']
/** Line-item markup/tax input mode: percentage (of rate / line subtotal) or flat amount */
const INVOICE_VALUE_TYPES = ['percentage', 'amount']
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
  'plant', 'smdt',
]

const AUDIT_ACTIONS = {
  LEAD_CREATED:             'lead.created',
  LEAD_ASSIGNED_AUTO:       'lead.assigned.auto',
  LEAD_ASSIGNED_MANUAL:     'lead.assigned.manual',
  LEAD_QUOTE_READY:         'lead.quote_ready',
  LEAD_HANDED_TO_SALES:     'lead.handed_to_sales',
  LEAD_LIFECYCLE_UPDATED:   'lead.lifecycle_updated',
  LEAD_RELEASED_TO_PLANT:   'lead.released_to_plant',
  LEAD_ESCALATED:           'lead.escalated',
  LEAD_PO_RAISED:           'lead.po_raised',
  LEAD_PO_APPROVED:         'lead.po_approved',
  LEAD_PO_REJECTED:         'lead.po_rejected',
  LEAD_EDITED:              'lead.edited',
  LEAD_TEMPERATURE_UPDATED: 'lead.temperature_updated',
  LEAD_TERMINATED:          'lead.terminated',
  LEAD_NOTE_ADDED:          'lead.note_added',
  BUILDINGS_CREATED:        'lead.buildings_created',
  BUILDINGS_SYNCED:         'lead.buildings_synced',
  DRAWING_UPLOADED:         'drawing.uploaded',
  DRAWING_REVIEWED:         'drawing.reviewed',
  BOM_APPROVED:             'bom.approved',
  BOM_REJECTED:             'bom.rejected',
  BOM_JOB_STARTED:          'bom.job_started',
  BOM_JOB_COMPLETED:        'bom.job_completed',
  BOM_JOB_FAILED:           'bom.job_failed',
  BOM_CONFIRMED:            'bom.confirmed',
  CONSOLIDATED_BOM_GENERATED: 'consolidated_bom.generated',
  CONSOLIDATED_BOM_SENT:    'consolidated_bom.sent',
  SHIPPER_FILE_SUBMITTED:   'shipper.file_submitted',
  ALL_SHIPPERS_SUBMITTED:   'shipper.all_submitted',
  SHIPPER_REQUEST_APPROVED:  'shipper.request_approved',
  SHIPPER_REQUEST_REJECTED:  'shipper.request_rejected',
  SHIPPER_RESUBMIT_REQUESTED:'shipper.resubmit_requested',
  BUNDLE_PLAN_GENERATED:     'bundle_plan.generated',
  QUOTATION_CREATED:        'quotation.created',
  QUOTATION_SENT:           'quotation.sent',
  QUOTATION_ACCEPTED:       'quotation.accepted',
  QUOTATION_REJECTED:       'quotation.rejected',
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
  CHAT_ENDED:               'chat.ended',
  CHAT_REOPENED:            'chat.reopened',
  CHAT_STAFF_TAKEOVER:      'chat.staff_takeover',

  VENDOR_CREATED:            'vendor.created',
  VENDOR_UPDATED:            'vendor.updated',
  CARRIER_CREATED:           'carrier.created',
  CARRIER_UPDATED:           'carrier.updated',
  DELIVERY_CREATED:          'delivery.created',
  DELIVERY_EDITED:           'delivery.edited',
  DELIVERY_RESCHEDULED:      'delivery.rescheduled',
  DELIVERY_CALLBACK_REQUESTED: 'delivery.callback_requested',
  DELIVERY_CONFIRMATION_SENT: 'delivery.confirmation_sent',
  FREIGHT_BIDS_SENT:         'freight_bids.sent',
  FREIGHT_BID_SUBMITTED:     'freight_bid.submitted',
  ALL_FREIGHT_BIDS_SUBMITTED: 'freight_bids.all_submitted',
  FREIGHT_BID_SELECTED:      'freight_bid.selected',
  FREIGHT_BID_RESUBMIT_REQUESTED: 'freight_bid.resubmit_requested',

  SMDT_BULK_UPLOADED:        'smdt.bulk_uploaded',
  SMDT_ITEM_ADDED:           'smdt.item_added',
  SMDT_ITEM_UPDATED:         'smdt.item_updated',
  SMDT_ITEM_DELETED:         'smdt.item_deleted',

  // Backward-compatible alias; remove after payment schedule migration is complete.
  PAYMENT_MARKED_PAID:      'payment.stage_paid',
}

const BUILDING_STATUSES = [
  'pending', 'drawing_pending', 'drawing_uploaded',
  'drawing_approved', 'drawing_rejected',
  'bom_pending', 'bom_approved', 'bom_confirmed',
  'completed',
]

const DRAWING_STATUSES = ['pending_review', 'approved', 'rejected']

const VENDOR_STATUSES = ['active', 'inactive']
const VENDOR_TYPES = ['steel', 'insulation', 'panels', 'trim', 'hardware', 'other']
const SHIPPER_REQUEST_STATUSES = [
  'sent', 'submitted',
  'comparison_processing', 'comparison_completed', 'comparison_failed',
  'approved', 'rejected', 'resubmit_requested',
]
const ACTIVE_SHIPPER_REQUEST_STATUSES = [
  'sent', 'submitted',
  'comparison_processing', 'comparison_completed', 'comparison_failed',
  'resubmit_requested',
]

const CARRIER_STATUSES = ['active', 'inactive']
const FREIGHT_BID_STATUSES = ['sent', 'submitted', 'resubmit_requested', 'selected', 'rejected', 'expired']
const ACTIVE_FREIGHT_BID_STATUSES = ['sent', 'submitted', 'resubmit_requested']
const BUNDLE_PLAN_STATUSES = ['draft', 'generated', 'confirmed', 'cancelled']
const BUNDLE_STATUSES = ['draft', 'confirmed', 'assigned_to_truck', 'staged', 'loaded']
const PACKING_LIST_PLAN_STATUSES = ['draft', 'generated', 'confirmed', 'cancelled']
const PACKING_LIST_STATUSES = ['draft', 'confirmed', 'ready', 'loading', 'delivery_created', 'dispatched', 'delivered', 'cancelled']
const TRUCK_TYPES = ['SEMI_53', 'HOTSHOT_40']
const DELIVERY_STATUSES = [
  'draft', 'bidding_sent', 'carrier_selected', 'scheduled',
  'confirmed', 'in_transit', 'delayed', 'staged', 'delivered',
  'partial_received', 'received', 'cancelled',
]

const SMDT_COST_UNITS = ['FT', 'LB', 'EA']

const SMDT_CATEGORIES = [
  'Insulation', 'Joist', 'Panels', 'TRIM', 'Mastic', 'Screws',
  'ABolts', 'CLIPS', 'Cable', 'Flange_Brace', 'Jambs', 'DCOL',
  'ZGIRT', 'OPEN CHANNEL', 'EaveStruts', 'ACCESSORIES', 'SKTLIGHT',
  'ANGL1', 'TS_PANEL', 'frames',
]

const BOM_JOB_STATUSES = ['queued', 'processing', 'completed', 'failed']
const BOM_FILE_FORMATS = ['ods', 'xlsx', 'xls', 'out', 'txt']
const BOM_MATCH_STATUSES = ['matched', 'unmatched', 'ambiguous', 'skipped']
const BOM_MATCH_CONFIDENCE = ['exact', 'part_alias', 'color_fallback', 'part_only', 'none']
const BOM_ITEM_FILTERS = ['all', 'unpriced', 'frames', 'matched', 'bom_priced']
const BOM_PRICE_SOURCES = ['smdt', 'bom', 'manual']

const CONSOLIDATED_BOM_STATUSES = ['draft', 'sent_to_vendor', 'vendor_submitted', 'approved']

// Backward-compatible alias for old model/controller usage during migration.
const PAYMENT_ITEM_STATUSES = PAYMENT_STAGE_STATUSES

module.exports = {
  USER_ROLES,
  LEAD_SOURCES,
  LEAD_TEMPERATURES,
  resolveLeadTemperatureFromScore,
  SALES_LIFECYCLE_STAGES,
  PLANT_LIFECYCLE_STAGES,
  LIFECYCLE_STAGES,
  CLOSED_STAGES,
  PO_RAISE_ELIGIBLE_LIFECYCLE_STAGES,
  INVOICE_CREATE_MIN_LIFECYCLE_STAGE,
  PRIORITY_LEVELS,
  QUOTATION_STATUSES,
  INVOICE_STATUSES,
  INVOICE_VALUE_TYPES,
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
  DRAWING_STATUSES,
  VENDOR_STATUSES,
  VENDOR_TYPES,
  SHIPPER_REQUEST_STATUSES,
  ACTIVE_SHIPPER_REQUEST_STATUSES,
  CARRIER_STATUSES,
  FREIGHT_BID_STATUSES,
  ACTIVE_FREIGHT_BID_STATUSES,
  BUNDLE_PLAN_STATUSES,
  BUNDLE_STATUSES,
  PACKING_LIST_PLAN_STATUSES,
  PACKING_LIST_STATUSES,
  TRUCK_TYPES,
  DELIVERY_STATUSES,
  SMDT_COST_UNITS,
  SMDT_CATEGORIES,
  BOM_JOB_STATUSES,
  BOM_FILE_FORMATS,
  BOM_MATCH_STATUSES,
  BOM_MATCH_CONFIDENCE,
  BOM_ITEM_FILTERS,
  BOM_PRICE_SOURCES,
  CONSOLIDATED_BOM_STATUSES,
}
