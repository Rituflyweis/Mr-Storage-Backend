const mongoose = require('mongoose')
const { LEAD_TEMPERATURES } = require('../config/constants')

const TEMPERATURE_TRANSITION_SOURCES = ['manual_override', 'ai_scoring', 'system']

const LeadTemperatureTransitionSchema = new mongoose.Schema(
  {
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    fromTemperature: {
      type: String,
      enum: LEAD_TEMPERATURES,
      required: true,
    },
    toTemperature: {
      type: String,
      enum: LEAD_TEMPERATURES,
      required: true,
    },
    source: {
      type: String,
      enum: TEMPERATURE_TRANSITION_SOURCES,
      default: 'system',
      index: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    changedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
)

LeadTemperatureTransitionSchema.index({ changedAt: -1, source: 1 })
LeadTemperatureTransitionSchema.index({ fromTemperature: 1, toTemperature: 1, changedAt: -1 })

module.exports = mongoose.model('LeadTemperatureTransition', LeadTemperatureTransitionSchema)
