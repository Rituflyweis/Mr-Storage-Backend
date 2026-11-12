const asyncHandler = require('../../utils/asyncHandler')
const { success, notFound, forbidden, badRequest } = require('../../utils/apiResponse')
const Lead = require('../../models/Lead')
const Message = require('../../models/Message')
const CallSession = require('../../models/CallSession')
const CallTurn = require('../../models/CallTurn')

const assertLeadAccess = async (req, leadId) => {
  const lead = await Lead.findById(leadId)
    .select('_id assignedSales aiContextSummary aiContextSummaryUpdatedAt customerId projectName jobId')
    .lean()
  if (!lead) return { error: 'Lead not found', code: 404 }
  if (req.user.role === 'sales' && String(lead.assignedSales || '') !== String(req.user._id)) {
    return { error: 'This lead is not assigned to you', code: 403 }
  }
  return { lead }
}

const mapMessage = (m) => ({
  messageId: m._id,
  senderType: m.senderType,
  senderName:
    m.senderType === 'sales'
      ? m.senderId?.name || m.senderName || 'Sales'
      : m.senderType === 'admin'
        ? m.senderId?.name || m.senderName || 'Admin'
        : m.senderType === 'ai'
          ? 'Alex'
          : m.senderName || undefined,
  content: m.content,
  createdAt: m.createdAt,
  isRead: Boolean(m.isRead),
  origin: m.origin || 'chat',
  callSessionId: m.callSessionId || null,
  channel: m.channel || 'project',
})

/**
 * GET /api/{admin|sales}/leads/:leadId/transcripts
 * Returns chat + call transcripts separately (for switchable UI tabs) plus AI summary.
 *
 * Query:
 *   channel = all | chat | call | summary  (default: all)
 */
exports.getLeadTranscripts = asyncHandler(async (req, res) => {
  const { leadId } = req.params
  const channel = String(req.query.channel || 'all').toLowerCase()
  const allowed = new Set(['all', 'chat', 'call', 'summary'])
  if (!allowed.has(channel)) {
    return badRequest(res, 'channel must be one of: all, chat, call, summary')
  }

  const access = await assertLeadAccess(req, leadId)
  if (access.error) {
    if (access.code === 404) return notFound(res, access.error)
    return forbidden(res, access.error)
  }
  const { lead } = access

  const wantChat = channel === 'all' || channel === 'chat'
  const wantCall = channel === 'all' || channel === 'call'
  const wantSummary = channel === 'all' || channel === 'summary'

  const [chatMessages, callSessions] = await Promise.all([
    wantChat
      ? Message.find({ leadId, origin: { $ne: 'call' } })
          .sort({ createdAt: 1 })
          .populate('senderId', 'name')
          .select('senderType senderId senderName content createdAt isRead origin callSessionId channel')
          .lean()
      : Promise.resolve(null),
    wantCall
      ? CallSession.find({ leadId, unknownCaller: { $ne: true } })
          .sort({ createdAt: 1 })
          .lean()
      : Promise.resolve(null),
  ])

  let callPayload = null
  if (wantCall) {
    const sessionIds = (callSessions || []).map((s) => s._id)
    const turns = sessionIds.length
      ? await CallTurn.find({ callSessionId: { $in: sessionIds } })
          .sort({ createdAt: 1 })
          .lean()
      : []

    const turnsBySession = new Map()
    for (const t of turns) {
      const key = String(t.callSessionId)
      if (!turnsBySession.has(key)) turnsBySession.set(key, [])
      turnsBySession.get(key).push({
        turnId: t._id,
        role: t.role,
        transcript: t.transcript,
        createdAt: t.createdAt,
        messageId: t.messageId || null,
      })
    }

    const sessions = (callSessions || []).map((s) => {
      const sessionTurns = turnsBySession.get(String(s._id)) || []
      return {
        callSessionId: s._id,
        twilioCallSid: s.twilioCallSid,
        status: s.status,
        fromNumber: s.fromNumber,
        toNumber: s.toNumber,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationSeconds: s.durationSeconds,
        isHandedToSales: Boolean(s.isHandedToSales),
        turnCount: sessionTurns.length,
        turns: sessionTurns,
      }
    })

    callPayload = {
      sessionCount: sessions.length,
      turnCount: turns.length,
      sessions,
    }
  }

  const chatRows = wantChat ? (chatMessages || []).map(mapMessage) : null
  const summaryText = lead.aiContextSummary || ''

  const data = {
    leadId: lead._id,
    customerId: lead.customerId || null,
    projectName: lead.projectName || '',
    jobId: lead.jobId || null,
    tabs: {
      hasChat: wantChat ? chatRows.length > 0 : undefined,
      hasCall: wantCall ? callPayload.sessionCount > 0 : undefined,
      hasSummary: wantSummary ? Boolean(String(summaryText).trim()) : undefined,
    },
  }

  // Drop undefined tab flags when channel-filtered
  Object.keys(data.tabs).forEach((k) => {
    if (data.tabs[k] === undefined) delete data.tabs[k]
  })

  if (wantSummary) {
    data.summary = {
      text: summaryText,
      updatedAt: lead.aiContextSummaryUpdatedAt || null,
    }
  }

  if (wantChat) {
    data.chat = {
      messageCount: chatRows.length,
      messages: chatRows,
    }
  }

  if (wantCall) {
    data.call = callPayload
  }

  return success(res, data)
})
