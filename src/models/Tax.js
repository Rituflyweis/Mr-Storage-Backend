const mongoose = require('mongoose')

const TAX_STATUSES = ['pending', 'paid']
const FILING_FREQUENCIES = ['monthly', 'quarterly', 'annually', 'varies', 'local_only']
const TAX_SOURCES = ['manual', 'sync', 'avalara']

const TaxSchema = new mongoose.Schema(
  {
    state:            { type: String, required: true, trim: true },
    dueDate:          { type: Date, required: true },
    /** Legacy liability field — prefer taxDue; kept for backward compatibility. */
    amount:           { type: Number, required: true },
    taxableSales:     { type: Number, default: 0 },
    taxCollected:     { type: Number, default: 0 },
    /** Effective rate % (derived on sync from collected ÷ taxable, or from Returns). */
    salesTaxRate:     { type: Number, default: null },
    taxDue:           { type: Number, default: 0 },
    paidFiled:        { type: Number, default: 0 },
    payable:          { type: Number, default: 0 },
    periodStart:      { type: Date, default: null },
    periodEnd:        { type: Date, default: null },
    periodKey:        { type: String, default: '', trim: true },
    filingFrequency:  { type: String, enum: FILING_FREQUENCIES, default: 'monthly' },
    threshold:        { type: String, default: '', trim: true },
    websiteLink:      { type: String, default: null, trim: true },
    status:           { type: String, enum: TAX_STATUSES, default: 'pending' },
    source:           { type: String, enum: TAX_SOURCES, default: 'manual' },
    avalaraFilingId:  { type: String, default: '', trim: true },
    syncedAt:         { type: Date, default: null },
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt:      { type: Date, default: null },
    penalty:     { type: Number, default: 0 },
    interest:    { type: Number, default: 0 },
    providerMethod: { type: String, default: 'Avalara API', trim: true },
    confirmationNumber: { type: String, default: '', trim: true },
    paymentMethod: { type: String, default: '', trim: true },
    paymentStatus: { type: String, enum: ['none', 'processing', 'completed'], default: 'none' },
    receiptUrl:  { type: String, default: '', trim: true },
    activityLog: [
      {
        at: { type: Date, default: Date.now },
        type: { type: String, default: 'note', trim: true },
        amount: { type: Number, default: null },
        label: { type: String, default: '', trim: true },
      },
    ],
  },
  { timestamps: true }
)

TaxSchema.pre('validate', function syncAmountFields(next) {
  if (this.taxDue == null || this.taxDue === 0) {
    this.taxDue = this.amount
  }
  if (!this.amount && this.taxDue) {
    this.amount = this.taxDue
  }
  if (this.payable == null || this.payable === 0) {
    this.payable = Math.max(0, (this.taxDue || this.amount || 0) - (this.paidFiled || 0))
  }
  next()
})

TaxSchema.index({ dueDate: 1 })
TaxSchema.index({ status: 1 })
TaxSchema.index({ leadId: 1 })
TaxSchema.index({ customerId: 1 })
TaxSchema.index({ source: 1, state: 1, periodKey: 1 })

module.exports = mongoose.model('Tax', TaxSchema)
