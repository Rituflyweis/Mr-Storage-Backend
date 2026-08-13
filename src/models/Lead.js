const mongoose = require('mongoose')
const {
  LEAD_SOURCES,
  LIFECYCLE_STAGES,
  ASSIGN_METHODS,
  PO_STATUSES,
  LEAD_TEMPERATURES,
  resolveLeadTemperatureFromScore,
} = require('../config/constants')

const AssigningHistorySchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAt: { type: Date, default: Date.now },
    method:     { type: String, enum: ASSIGN_METHODS, required: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
)

const ScoreBreakdownSchema = new mongoose.Schema(
  {
    projectSize:    { points: { type: Number, default: 0 }, reason: { type: String, default: '' } },
    budgetSignals:  { points: { type: Number, default: 0 }, reason: { type: String, default: '' } },
    timeline:       { points: { type: Number, default: 0 }, reason: { type: String, default: '' } },
    decisionMaker:  { points: { type: Number, default: 0 }, reason: { type: String, default: '' } },
    projectClarity: { points: { type: Number, default: 0 }, reason: { type: String, default: '' } },
  },
  { _id: false }
)

const LeadScoringSchema = new mongoose.Schema(
  {
    scoreBreakdown: { type: ScoreBreakdownSchema, default: () => ({}) },
    score:          { type: Number, default: 0, min: 0, max: 100 },
    temperature:         { type: String, enum: LEAD_TEMPERATURES, default: 'cold' },
    temperatureManual:   { type: Boolean, default: false },
    requirements:   { type: String, default: '' },
    lastScoredAt:   { type: Date, default: null },
  },
  { _id: false }
)

const DOCUMENT_TYPES = ['drawing', 'approval', 'general', 'contract', 'photo', 'other']

const DocumentSchema = new mongoose.Schema(
  {
    url:        { type: String, required: true },
    name:       { type: String, required: true },
    type:       { type: String, enum: DOCUMENT_TYPES, default: 'general' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
)

const LeadNoteSchema = new mongoose.Schema(
  {
    note:    { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: true }
)

const LeadSchema = new mongoose.Schema(
  {
    customerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buildingType:    { type: String, default: '' },
    location:        { type: String, default: '' },
    city:            { type: String, default: '' },
    state:           { type: String, default: '' },
    pincode:         { type: String, default: '' },
    roofStyle:       { type: String, default: '' },
    sqft:            { type: String, default: '' },
    width:           { type: Number, default: null },
    length:          { type: Number, default: null },
    height:          { type: Number, default: null },
    doors:           { type: Number, default: null },
    windows:         { type: Number, default: null },
    insulation:      { type: Number, default: null },
    source:          { type: String, enum: LEAD_SOURCES, default: 'chat' },
    jobId:           { type: String, default: null },
    projectName:     { type: String, default: '' },
    endDate:           { type: Date, default: null },
    plannedStartDate:  { type: Date, default: null },
    numberOfBuildings: { type: Number, default: 1, min: 1 },
    isTerminated:    { type: Boolean, default: false },
    terminationReason: { type: String, default: '' },
    terminatedAt:    { type: Date, default: null },
    isDeleted:       { type: Boolean, default: false },
    deletedAt:       { type: Date, default: null },
    deletedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    assignedSales:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assigningHistory: { type: [AssigningHistorySchema], default: [] },

    quoteValue:      { type: Number, default: 0 },
    lifecycleStatus: { type: String, enum: LIFECYCLE_STAGES, default: 'initial_contact' },
    lifecycleHistory: [
      {
        stage:     { type: String, required: true },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      },
    ],

    numDoors:      { type: Number, default: null },
    numWindows:    { type: Number, default: null },
    numInsulation: { type: Number, default: null },

    leadScoring: { type: LeadScoringSchema, default: () => ({}) },

    isQuoteReady:       { type: Boolean, default: false },
    isHandedToSales:    { type: Boolean, default: false },
    isStaffChatActive:  { type: Boolean, default: false },
    isOnline:        { type: Boolean, default: false, index: true },
    onlineAt:        { type: Date, default: null },
    lastSeenAt:      { type: Date, default: null },
    isChatEnded:     { type: Boolean, default: false },
    chatEndedAt:     { type: Date, default: null },
    chatEndedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isRaisedToPO:    { type: Boolean, default: false },
    poNumber:        { type: String, default: null },
    // poStatus: only validated when non-null — mongoose enum won't run on null
    poStatus:        { type: String, enum: PO_STATUSES, default: null },

    notes:     { type: String, default: '' },
    leadNotes: { type: [LeadNoteSchema], default: [] },
    documents: { type: [DocumentSchema], default: [] },

    aiQuoteData:               { type: mongoose.Schema.Types.Mixed, default: null },
    aiContextSummary:          { type: String, default: '' },
    aiContextSummaryUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

LeadSchema.index({ jobId: 1 }, { unique: true, sparse: true })
LeadSchema.index({ customerId: 1 })
LeadSchema.index({ assignedSales: 1 })
LeadSchema.index({ lifecycleStatus: 1 })
LeadSchema.index({ isTerminated: 1 })
LeadSchema.index({ isDeleted: 1 })
LeadSchema.index({ 'leadScoring.lastScoredAt': -1 })
LeadSchema.index({ isQuoteReady: 1 })
LeadSchema.index({ createdAt: -1 })
LeadSchema.index({ updatedAt: -1 })
LeadSchema.index({ 'leadScoring.temperature': 1 })

const syncLeadScoringTemperature = (leadScoring) => {
  if (!leadScoring || leadScoring.temperatureManual) return
  leadScoring.temperature = resolveLeadTemperatureFromScore(leadScoring.score)
}

/** Soft-delete: exclude deleted leads from reads unless opted in. */
const shouldIncludeDeleted = (queryOrAggregate) => {
  const options = typeof queryOrAggregate.getOptions === 'function'
    ? queryOrAggregate.getOptions()
    : queryOrAggregate.options || {}
  return options.includeDeleted === true
}

const applySoftDeleteFindFilter = function (next) {
  if (shouldIncludeDeleted(this)) return next()
  const q = this.getQuery()
  // Respect explicit isDeleted filters (e.g. admin deleted-leads lists)
  if (Object.prototype.hasOwnProperty.call(q, 'isDeleted')) return next()
  this.where({ isDeleted: { $ne: true } })
  next()
}

LeadSchema.pre(/^find/, applySoftDeleteFindFilter)
LeadSchema.pre('countDocuments', applySoftDeleteFindFilter)

LeadSchema.pre('aggregate', function (next) {
  if (shouldIncludeDeleted(this)) return next()
  const pipeline = this.pipeline()
  const hasExplicitDeletedFilter = pipeline.some(
    (stage) => stage.$match && Object.prototype.hasOwnProperty.call(stage.$match, 'isDeleted')
  )
  if (!hasExplicitDeletedFilter) {
    pipeline.unshift({ $match: { isDeleted: { $ne: true } } })
  }
  next()
})

LeadSchema.pre('save', async function (next) {
  syncLeadScoringTemperature(this.leadScoring)

  if (this.isNew && !this.jobId) {
    // Include soft-deleted leads so jobId sequence never collides
    const last = await this.constructor
      .findOne({ jobId: { $exists: true, $ne: null } }, { jobId: 1 })
      .sort({ createdAt: -1 })
      .setOptions({ includeDeleted: true })
      .lean()
    const num = last?.jobId ? parseInt(last.jobId.split('-')[1], 10) + 1 : 1
    this.jobId = `PRO-${String(num).padStart(3, '0')}`
  }
  next()
})

// Existing leads without `temperature` — derive on read (no DB migration; respects manual override)
LeadSchema.post('init', function () {
  if (!this.leadScoring?.temperature && !this.leadScoring?.temperatureManual) {
    syncLeadScoringTemperature(this.leadScoring)
  }
})

module.exports = mongoose.model('Lead', LeadSchema)
