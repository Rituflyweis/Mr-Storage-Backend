const mongoose = require('mongoose')

const SMDTPartAliasSchema = new mongoose.Schema(
  {
    inputPart: { type: String, required: true, trim: true },
    inputPartNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    smdtPartName: { type: String, required: true, trim: true },
    smdtPartNameNormalized: { type: String, required: true, trim: true, uppercase: true, index: true },
    category: { type: String, default: null, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

SMDTPartAliasSchema.index({ inputPartNormalized: 1, category: 1 }, { unique: true })

module.exports = mongoose.model('SMDTPartAlias', SMDTPartAliasSchema)
