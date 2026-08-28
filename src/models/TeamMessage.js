const mongoose = require('mongoose')

const CHANNEL_TYPES = ['department', 'direct', 'group']

const AttachmentSchema = new mongoose.Schema(
  { url: { type: String, required: true }, name: { type: String, default: '' }, type: { type: String, default: '' } },
  { _id: false }
)

const TeamMessageSchema = new mongoose.Schema(
  {
    channelType: { type: String, enum: CHANNEL_TYPES, required: true },
    // department channel: role key ('admin' | 'sales' | 'construction' | 'plant' | 'account')
    department:  { type: String, default: '', trim: true },
    // direct channel: sorted "userIdA_userIdB" for fast lookup
    directKey:   { type: String, default: '', trim: true },
    // group channel: TeamGroup._id
    groupId:     { type: mongoose.Schema.Types.ObjectId, ref: 'TeamGroup', default: null, index: true },
    participants:{ type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },

    senderId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderName:  { type: String, default: '' },
    senderRole:  { type: String, default: '' },
    content:     { type: String, default: '', trim: true },
    attachments: { type: [AttachmentSchema], default: [] },
    readBy:      { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
  },
  { timestamps: true }
)

TeamMessageSchema.index({ channelType: 1, department: 1, createdAt: -1 })
TeamMessageSchema.index({ channelType: 1, directKey: 1, createdAt: -1 })
TeamMessageSchema.index({ channelType: 1, groupId: 1, createdAt: -1 })

const buildDirectKey = (userIdA, userIdB) => [String(userIdA), String(userIdB)].sort().join('_')

module.exports = mongoose.model('TeamMessage', TeamMessageSchema)
module.exports.CHANNEL_TYPES = CHANNEL_TYPES
module.exports.buildDirectKey = buildDirectKey
