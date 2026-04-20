const mongoose = require('mongoose')
const { MEETING_MODES, MEETING_STATUSES } = require('../config/constants')

const MeetingSchema = new mongoose.Schema(
  {
    customerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    title:       { type: String, required: true, trim: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    meetingTime: { type: Date, required: true },
    duration:    { type: Number, default: null }, // minutes
    mode:        { type: String, enum: MEETING_MODES, required: true },
    meetingLink: { type: String, default: '' },   // required when mode=online — validated in service
    notes:       { type: String, default: '' },
    status:      { type: String, enum: MEETING_STATUSES, default: 'scheduled' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

MeetingSchema.index({ customerId: 1 })
MeetingSchema.index({ assignedTo: 1, meetingTime: 1 })

module.exports = mongoose.model('Meeting', MeetingSchema)
