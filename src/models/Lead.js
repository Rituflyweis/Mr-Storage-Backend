const mongoose = require('mongoose')
const { LEAD_SOURCES, LIFECYCLE_STAGES, ASSIGN_METHODS, PO_STATUSES } = require('../config/constants')

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

const LeadSchema = new mongoose.Schema(
  {
    customerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    buildingType:    { type: String, default: '' },
    location:        { type: String, default: '' },
    roofStyle:       { type: String, default: '' },
    sqft:            { type: String, default: '' },
    width:           { type: Number, default: null },
    length:          { type: Number, default: null },
    source:          { type: String, enum: LEAD_SOURCES, default: 'chat' },

    assignedSales:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    assigningHistory: { type: [AssigningHistorySchema], default: [] },

    quoteValue:      { type: Number, default: 0 },
    lifecycleStatus: { type: String, enum: LIFECYCLE_STAGES, default: 'initial_contact' },

    leadScoring: { type: LeadScoringSchema, default: () => ({}) },

    isQuoteReady:    { type: Boolean, default: false },
    isHandedToSales: { type: Boolean, default: false },
    isRaisedToPO:    { type: Boolean, default: false },
    // poStatus: only validated when non-null — mongoose enum won't run on null
    poStatus:        { type: String, enum: PO_STATUSES, default: null },

    notes:     { type: String, default: '' },
    documents: { type: [DocumentSchema], default: [] },

    aiQuoteData:               { type: mongoose.Schema.Types.Mixed, default: null },
    aiContextSummary:          { type: String, default: '' },
    aiContextSummaryUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

LeadSchema.index({ customerId: 1 })
LeadSchema.index({ assignedSales: 1 })
LeadSchema.index({ lifecycleStatus: 1 })
LeadSchema.index({ 'leadScoring.lastScoredAt': -1 })
LeadSchema.index({ isQuoteReady: 1 })
LeadSchema.index({ createdAt: -1 })

module.exports = mongoose.model('Lead', LeadSchema)
