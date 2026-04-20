const mongoose = require('mongoose')
const { AUDIT_TYPES } = require('../config/constants')

// INSERT ONLY — never update documents in this collection
const AuditLogSchema = new mongoose.Schema(
  {
    type:        { type: String, enum: AUDIT_TYPES, required: true },
    action:      { type: String, required: true },
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = AI
    metadata:    { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt:   { type: Date, default: Date.now },
  }
  // No timestamps option — we manage createdAt manually and never update
)

AuditLogSchema.index({ leadId: 1, createdAt: -1 })
AuditLogSchema.index({ type: 1, createdAt: -1 })
AuditLogSchema.index({ customerId: 1, createdAt: -1 })

module.exports = mongoose.model('AuditLog', AuditLogSchema)
