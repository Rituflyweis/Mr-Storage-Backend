const mongoose = require('mongoose')

const WorkLogSchema = new mongoose.Schema(
  {
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    taskId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    loggedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date:        { type: Date, required: true },
    progress:    { type: Number, min: 0, max: 100, default: 0 },
    description: { type: String, default: '' },
    photos:      { type: [String], default: [] },
    issues:      { type: String, default: '' },
  },
  { timestamps: true }
)

module.exports = mongoose.models.WorkLog || mongoose.model('WorkLog', WorkLogSchema)
