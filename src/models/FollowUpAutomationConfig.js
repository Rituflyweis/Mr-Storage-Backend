const mongoose = require('mongoose')

const ChatDropOffSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    inactivityMinutes: { type: Number, default: 30 },
    maxAttempts: { type: Number, default: 3 },
    attemptIntervalsMinutes: { type: [Number], default: [30, 180, 1440] },
    requireNotQuoteReady: { type: Boolean, default: true },
    requireNotHandedToSales: { type: Boolean, default: true },
  },
  { _id: false }
)

const ColdLeadSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    intervalsDays: { type: [Number], default: [1, 3, 7, 14] },
    maxAttempts: { type: Number, default: 4 },
  },
  { _id: false }
)

const LeadCadenceSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    preset: { type: String, default: '' },
    intervalsDays: { type: [Number], default: [1, 3, 7, 14] },
    maxAttempts: { type: Number, default: 4 },
  },
  { _id: false }
)

const LeadFollowUpSchema = new mongoose.Schema(
  {
    warm: { type: LeadCadenceSchema, default: () => ({ enabled: true, intervalsDays: [3, 7, 10, 14], maxAttempts: 4 }) },
    cold: { type: LeadCadenceSchema, default: () => ({ enabled: true, intervalsDays: [7, 15, 30], maxAttempts: 4 }) },
  },
  { _id: false }
)

const InvoiceReminderSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    intervalsHours: { type: [Number], default: [24, 72, 168] },
    maxAttempts: { type: Number, default: 3 },
  },
  { _id: false }
)

const ManualReminderSchema = new mongoose.Schema(
  {
    defaultReminderMinutes: { type: Number, default: 30 },
    sendDueNowReminder: { type: Boolean, default: true },
  },
  { _id: false }
)

const FollowUpAutomationConfigSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: 'global' },
    chatDropOff: { type: ChatDropOffSchema, default: () => ({}) },
    coldLead: { type: ColdLeadSchema, default: () => ({}) },
    leadFollowUp: { type: LeadFollowUpSchema, default: () => ({}) },
    invoiceReminder: { type: InvoiceReminderSchema, default: () => ({}) },
    manualReminder: { type: ManualReminderSchema, default: () => ({}) },
    timezone: { type: String, default: 'UTC' },
    channels: {
      sms: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

module.exports = mongoose.model('FollowUpAutomationConfig', FollowUpAutomationConfigSchema)
