const mongoose = require('mongoose')

const CalendarEventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    kind: { type: String, enum: ['meeting', 'followup'], required: true, index: true },
    sourceModel: { type: String, enum: ['Meeting', 'FollowUp'], required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, default: null },
    reminderMinutes: { type: Number, default: 30 },
    reminderSms: { type: Boolean, default: true },
    reminderEmail: { type: Boolean, default: true },
    status: { type: String, enum: ['scheduled', 'completed', 'cancelled'], default: 'scheduled', index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

CalendarEventSchema.index({ userId: 1, startsAt: 1 })
CalendarEventSchema.index({ sourceModel: 1, sourceId: 1, userId: 1 }, { unique: true })

module.exports = mongoose.model('CalendarEvent', CalendarEventSchema)
