const mongoose = require('mongoose')

const TaxComplianceSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },
    avalaraCompanyId: { type: String, default: '' },
    returnsAccountStatus: {
      type: String,
      default: 'NOTYETFILING',
      trim: true,
    },
    registeredRegions: [
      {
        country: { type: String, default: 'US' },
        region: { type: String, default: '' },
      },
    ],
    lastReturnsSyncAt: { type: Date, default: null },
    lastReturnsSyncError: { type: String, default: '' },
    syncStatus: {
      type: String,
      enum: ['not_configured', 'empty', 'synced', 'error'],
      default: 'not_configured',
    },
    onboardingCompleteAt: { type: Date, default: null },
    provider: { type: String, default: 'avalara', trim: true },
    /** Account Tax & Filing — "Manage Notifications" (Figma). */
    taxFilingNotifications: {
      emailReminders: { type: Boolean, default: true },
      deadlineAlerts: { type: Boolean, default: true },
      daysBeforeDue: { type: Number, default: 7 },
      recipientEmail: { type: String, default: '', trim: true },
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('TaxComplianceSettings', TaxComplianceSettingsSchema)
