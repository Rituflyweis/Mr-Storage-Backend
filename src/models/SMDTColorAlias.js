const mongoose = require('mongoose')

const SMDTColorAliasSchema = new mongoose.Schema(
  {
    inputColor: { type: String, required: true, trim: true },
    inputColorNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    smdtColor: { type: String, required: true, trim: true },
    smdtColorNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    description: { type: String, default: '' },
    isActive: { type: Boolean, default: true, index: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

SMDTColorAliasSchema.index({ inputColorNormalized: 1, smdtColorNormalized: 1 }, { unique: true })

module.exports = mongoose.model('SMDTColorAlias', SMDTColorAliasSchema)
