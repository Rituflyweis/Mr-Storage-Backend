const mongoose = require('mongoose')

const AIScriptSessionSchema = new mongoose.Schema(
  {
    salesEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    leadId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    messages: [
      {
        role:      { type: String, enum: ['user', 'assistant'], required: true },
        content:   { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
)

AIScriptSessionSchema.index({ salesEmployeeId: 1, createdAt: -1 })
AIScriptSessionSchema.index({ leadId: 1 })

module.exports = mongoose.model('AIScriptSession', AIScriptSessionSchema)
