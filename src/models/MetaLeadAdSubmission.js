const mongoose = require('mongoose')

const MetaLeadFieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    values: { type: [String], default: [] },
  },
  { _id: false }
)

const MetaLeadAdSubmissionSchema = new mongoose.Schema(
  {
    leadgenId: { type: String, required: true, unique: true, trim: true, index: true },
    formId: { type: String, default: '', trim: true },
    adId: { type: String, default: '', trim: true },
    adgroupId: { type: String, default: '', trim: true },
    pageId: { type: String, default: '', trim: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    fieldData: { type: [MetaLeadFieldSchema], default: [] },
    metaCreatedTime: { type: Date, default: null },
  },
  { timestamps: true }
)

module.exports = mongoose.model('MetaLeadAdSubmission', MetaLeadAdSubmissionSchema)