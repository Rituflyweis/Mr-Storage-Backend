const User = require('../models/User')
const auditService = require('./audit.service')
const { AUDIT_ACTIONS } = require('../config/constants')

const sortNotesNewestFirst = (entries = []) =>
  [...entries].sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt))

const populateAddedBy = async (entries = []) => {
  const ids = [...new Set(entries.map((e) => e.addedBy).filter(Boolean).map(String))]
  const users = ids.length
    ? await User.find({ _id: { $in: ids } }).select('_id name email role').lean()
    : []
  const userMap = new Map(users.map((u) => [String(u._id), u]))

  return entries.map((e) => ({
    _id: e._id,
    note: e.note,
    addedAt: e.addedAt,
    addedBy: e.addedBy
      ? userMap.get(String(e.addedBy)) || { _id: e.addedBy }
      : null,
  }))
}

const formatLeadNotes = async (lead) => {
  const sorted = sortNotesNewestFirst(lead.leadNotes || [])
  return populateAddedBy(sorted)
}

const appendLeadNote = async (lead, noteText, performedBy) => {
  const trimmed = String(noteText || '').trim()
  if (!trimmed) {
    const err = new Error('Note text is required')
    err.code = 'NOTE_REQUIRED'
    throw err
  }

  if (!lead.leadNotes) lead.leadNotes = []
  lead.leadNotes.push({
    note: trimmed,
    addedAt: new Date(),
    addedBy: performedBy,
  })
  await lead.save()

  const savedEntry = lead.leadNotes[lead.leadNotes.length - 1]

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_NOTE_ADDED,
    leadId: lead._id,
    customerId: lead.customerId,
    performedBy,
    metadata: {
      noteId: savedEntry._id,
      notePreview: trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed,
      projectName: lead.projectName || '',
    },
  })

  const [formatted] = await populateAddedBy([
    savedEntry.toObject ? savedEntry.toObject() : savedEntry,
  ])
  return formatted
}

module.exports = {
  formatLeadNotes,
  appendLeadNote,
}
