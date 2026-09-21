const mongoose = require('mongoose')
const { AUDIT_TYPES } = require('../config/constants')

// INSERT ONLY — never update documents in this collection
const AuditLogSchema = new mongoose.Schema(
  {
    type:        { type: String, enum: AUDIT_TYPES, required: true },
    action:      { type: String, required: true },
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = AI / customer
    actorType:   { type: String, enum: ['staff', 'customer', 'system', 'anonymous'], default: null },
    actorId:     { type: mongoose.Schema.Types.ObjectId, default: null },
    panel:       { type: String, default: null },
    entityType:  { type: String, default: null },
    entityId:    { type: mongoose.Schema.Types.ObjectId, default: null },
    httpMethod:  { type: String, default: null },
    path:        { type: String, default: null },
    metadata:    { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt:   { type: Date, default: Date.now },
  }
  // No timestamps option — we manage createdAt manually and never update
)

AuditLogSchema.index({ leadId: 1, createdAt: -1 })
AuditLogSchema.index({ type: 1, createdAt: -1 })
AuditLogSchema.index({ customerId: 1, createdAt: -1 })
AuditLogSchema.index({ performedBy: 1, createdAt: -1 })
AuditLogSchema.index({ panel: 1, createdAt: -1 })
AuditLogSchema.index({ action: 1, createdAt: -1 })
AuditLogSchema.index({ actorId: 1, createdAt: -1 })
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 })

module.exports = mongoose.model('AuditLog', AuditLogSchema)
