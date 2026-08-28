const mongoose = require('mongoose')

// One document per calendar day — the plant's fabrication output for that day, entered by
// plant staff. Backs the Dashboard's "Production Overview (Today)" planned/produced tonnage
// and utilization %, none of which had any real tracking before this.
const DailyProductionLogSchema = new mongoose.Schema(
  {
    date:            { type: Date, required: true, index: true },
    plannedTonnage:  { type: Number, default: 0 },
    producedTonnage: { type: Number, default: 0 },
    // Utilization is entered directly (equipment/shift-hours tracking doesn't exist to derive
    // it from) rather than computed, so it can reflect things tonnage alone doesn't capture.
    utilizationPct:  { type: Number, default: 0 },
    loggedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

DailyProductionLogSchema.index({ date: 1 }, { unique: true })

module.exports = mongoose.model('DailyProductionLog', DailyProductionLogSchema)
