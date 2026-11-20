const mongoose = require('mongoose')
const { LEAD_SOURCES, CUSTOMER_DOCUMENT_CATEGORIES } = require('../config/constants')

const CustomerDocumentSchema = new mongoose.Schema(
  {
    name:       { type: String, required: true, trim: true },
    fileUrl:    { type: String, required: true, trim: true },
    fileType:   { type: String, default: '', trim: true },
    fileSize:   { type: Number, default: 0 },
    category:   { type: String, enum: CUSTOMER_DOCUMENT_CATEGORIES, default: 'other' },
    notes:      { type: String, default: '', trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
)

const CustomerSchema = new mongoose.Schema(
  {
    customerId:        { type: String, unique: true },
    firstName:         { type: String, required: true, trim: true },
    lastName:          { type: String, default: '' },
    email:             { type: String, lowercase: true, trim: true },
    phone: {
      number:          { type: String, trim: true },
      countryCode:     { type: String, trim: true },
    },
    mobile:            { type: String, default: '', trim: true },
    password:          { type: String },
    passwordChangedAt: { type: Date, default: null },
    photo:             { type: String, default: null },
    isActive:          { type: Boolean, default: true },
    isOnline:          { type: Boolean, default: false, index: true },
    onlineAt:          { type: Date, default: null },
    lastSeenAt:        { type: Date, default: null },
    source:            { type: String, enum: LEAD_SOURCES, default: 'chat' },
    /** Facebook Page-scoped id. Omitted unless the lead actually came from Messenger. */
    facebookPsid:      { type: String, trim: true },
    /** Set when they reply STOP. Outbound calls and follow-up texts are skipped. */
    voiceOptOut:       { type: Boolean, default: false },
    /** Set when sales creates customer via POST /api/sales/customers/basic (no lead yet). */
    createdBySales:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    company:           { type: String, default: '', trim: true },
    location:          { type: String, default: '', trim: true },
    /**
     * Optional default sales-tax exemption (spec §3). Seeded onto new invoices when
     * the invoice body does not specify its own. Never assume exemption — default off.
     */
    taxExemption: {
      isExempt:       { type: Boolean, default: false },
      entityUseCode:  { type: String, default: '', trim: true },
      exemptionNo:    { type: String, default: '', trim: true },
      certificateRef: { type: String, default: '', trim: true },
    },
    resetOtp:          { type: String,  default: null },
    resetOtpExpiry:    { type: Date,    default: null },
    resetOtpVerified:  { type: Boolean, default: false },
    documents:         { type: [CustomerDocumentSchema], default: [] },
  },
  { timestamps: true, autoIndex: false }
)

CustomerSchema.index({ 'phone.number': 1 })
// Unique only when an email is stored, so many imported leads can omit it.
CustomerSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
)
// Unique only when a real PSID is stored. A missing id must not collide with other customers.
CustomerSchema.index(
  { facebookPsid: 1 },
  { unique: true, partialFilterExpression: { facebookPsid: { $type: 'string' } } },
)

CustomerSchema.pre('save', function stripBlankContactFields() {
  if (this.facebookPsid == null || String(this.facebookPsid).trim() === '') {
    this.facebookPsid = undefined
  }
  if (this.email == null || String(this.email).trim() === '') {
    this.email = undefined
  }
  if (!String(this.phone?.number || '').trim()) {
    this.phone = undefined
  }
})

CustomerSchema.methods.toJSON = function () {
  const obj = this.toObject()
  delete obj.password
  return obj
}

module.exports = mongoose.model('Customer', CustomerSchema)
