const mongoose = require('mongoose')

const SIGNATURE_STATUSES = [
  'not_sent',
  'sent',
  'delivered',
  'viewed',
  'completed',
  'declined',
  'voided',
  'expired',
]

const SignerSchema = new mongoose.Schema(
  {
    role: { type: String, default: 'customer' },
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    recipientId: { type: String, default: '' },
    status: { type: String, default: '' },
  },
  { _id: false }
)

const ContractEnvelopeSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    envelopeId: { type: String, default: '', index: true },
    status: { type: String, enum: SIGNATURE_STATUSES, default: 'not_sent' },
    signerName: { type: String, default: '' },
    signerEmail: { type: String, default: '' },
    ccEmails: { type: [String], default: [] },
    companySignerName: { type: String, default: '' },
    companySignerEmail: { type: String, default: '' },
    message: { type: String, default: '' },
    signers: { type: [SignerSchema], default: [] },
    documentName: { type: String, default: 'Fabrication & Supply Agreement' },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    declinedAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
    declineReason: { type: String, default: '' },
    voidReason: { type: String, default: '' },
    signedPdfUrl: { type: String, default: '' },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

ContractEnvelopeSchema.index({ leadId: 1, createdAt: -1 })

module.exports = mongoose.model('ContractEnvelope', ContractEnvelopeSchema)
module.exports.SIGNATURE_STATUSES = SIGNATURE_STATUSES
