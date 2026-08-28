const mongoose = require('mongoose')

// Singleton — only ever ONE document in this collection
const RoundRobinTrackerSchema = new mongoose.Schema(
  {
    lastAssignedIndex: { type: Number, default: -1 },
    activeEmployees:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  }
)

module.exports = mongoose.model('RoundRobinTracker', RoundRobinTrackerSchema)
