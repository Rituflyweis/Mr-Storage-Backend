const mongoose = require('mongoose')

const TaskSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    leadId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    assignedTo:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    priority:    { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    status:      { type: String, enum: ['todo', 'in_progress', 'done'], default: 'todo' },
    dueDate:     { type: Date, default: null },
    completedAt: { type: Date, default: null },
    notes:       { type: String, default: '' },
  },
  { timestamps: true }
)

TaskSchema.index({ leadId: 1, status: 1 })
TaskSchema.index({ assignedTo: 1, status: 1 })

module.exports = mongoose.models.Task || mongoose.model('Task', TaskSchema)
