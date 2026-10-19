const mongoose = require('mongoose')

/**
 * audit_log for tax-mapping changes (spec §6 Table 3, §10 "audit all mapping changes").
 * Immutable record of before/after on every create/update/approve.
 */
const TaxMappingAuditSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '', trim: true },
    mappingId: { type: mongoose.Schema.Types.ObjectId, ref: 'TaxCategoryMapping', default: null, index: true },
    action: { type: String, required: true, trim: true }, // create | update | approve | revert
    mapping_before: { type: mongoose.Schema.Types.Mixed, default: null },
    mapping_after: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: '', trim: true },
  },
  { timestamps: { createdAt: 'timestamp', updatedAt: false } }
)

TaxMappingAuditSchema.index({ timestamp: -1 })

module.exports = mongoose.model('TaxMappingAudit', TaxMappingAuditSchema)
