const Message = require('../../models/Message')
const Lead = require('../../models/Lead')
const chatService = require('../ai/chat.service')
const scoringService = require('../ai/scoring.service')
const leadListSocket = require('../leadListSocket.service')
const {
  isRequirementsGatheredFromChat,
  isReadyForSalesHandoff,
  canAdvanceLifecycle,
} = require('../ai/requirementsChecklist.service')
const {
  handleQuoteReady,
  buildFallbackQuoteData,
  advanceLifecycleIfNeeded,
} = require('../leadQuoteReady.service')

const notifyAssignedSales = (leadId, assignedSales, message) => {
  if (!global.io || !assignedSales) return
  global.io.of('/admin').to(`user:${assignedSales}`).emit('new_customer_message', {
    leadId,
    message,
  })
}

const saveLeadScoring = async (leadId, leadScoring) => {
  await Lead.findByIdAndUpdate(leadId, { $set: { leadScoring } })
}

const processCustomerMessage = async ({ leadId, customerId, content, chatNS }) => {
  const leadForChat = await Lead.findById(leadId).select('isChatEnded').lean()
  if (leadForChat?.isChatEnded) {
    chatNS.to(`lead:${leadId}`).emit('chat_error', { message: 'This chat has been closed' })
    return
  }

  const customerMsg = await Message.create({
    leadId,
    customerId,
    senderType: 'customer',
    content: content.trim(),
  })

  if (global.io) {
    global.io.of('/admin').to(`lead:${leadId}`).emit('new_message', {
      _id: customerMsg._id,
      senderType: 'customer',
      content: customerMsg.content,
      createdAt: customerMsg.createdAt,
      leadId,
    })
  }

  const lead = await Lead.findById(leadId).populate('customerId')
  if (!lead) return

  const customer = lead.customerId

  if (lead.isHandedToSales) {
    notifyAssignedSales(leadId, lead.assignedSales, {
      senderType: 'customer',
      content: content.trim(),
      createdAt: customerMsg.createdAt,
    })
    return
  }

  if (lead.isQuoteReady && !lead.isHandedToSales) {
    const priorMessages = await Message.find({ leadId })
      .sort({ createdAt: 1 })
      .select('senderType content createdAt')
      .lean()
    await handleQuoteReady(leadId, customerId, lead.aiQuoteData || {}, {
      messages: priorMessages,
      scoreData: lead.leadScoring || {},
    })
    const updated = await Lead.findById(leadId).populate('assignedSales').lean()
    if (updated?.isHandedToSales && updated.assignedSales) {
      notifyAssignedSales(leadId, updated.assignedSales._id, {
        senderType: 'customer',
        content: content.trim(),
        createdAt: customerMsg.createdAt,
      })
    }
    return
  }

  const messagesBeforeAi = await Message.find({ leadId })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt')
    .lean()

  chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: true })

  const { text, quoteReadyData, chatMeta } = await chatService.chat(messagesBeforeAi, {
    customer,
    currentConversationSummary: lead.aiContextSummary || '',
  })

  const aiMsg = await Message.create({
    leadId,
    customerId,
    senderType: 'ai',
    content: text,
  })

  chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: false })

  const msgPayload = {
    _id: aiMsg._id,
    senderType: 'ai',
    content: text,
    createdAt: aiMsg.createdAt,
    leadId,
  }
  chatNS.to(`lead:${leadId}`).emit('new_message', msgPayload)
  if (global.io) {
    global.io.of('/admin').to(`lead:${leadId}`).emit('new_message', msgPayload)
  }

  const messagesAfterAi = await Message.find({ leadId })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt')
    .lean()

  const scoreData = await scoringService.scoreLead(
    messagesAfterAi,
    customer?.firstName || ''
  )
  scoringService.applyScoreToLead(lead, scoreData)
  await saveLeadScoring(leadId, lead.leadScoring)

  if (canAdvanceLifecycle(messagesAfterAi) && isRequirementsGatheredFromChat(chatMeta, scoreData)) {
    await advanceLifecycleIfNeeded(leadId, 'requirements_gathered')
  }

  const lifecycleLead = await Lead.findById(leadId).select('lifecycleStatus').lean()

  if (global.io) {
    global.io.of('/admin').to('admin_room').emit('lead_score_updated', {
      leadId,
      score: lead.leadScoring?.score ?? 0,
      temperature: lead.leadScoring?.temperature,
      breakdown: lead.leadScoring?.scoreBreakdown,
      requirements: lead.leadScoring?.requirements,
      lifecycleStatus: lifecycleLead?.lifecycleStatus,
    })
  }
  await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'ai_scoring', includeScoreRow: true })

  const readyForHandoff = isReadyForSalesHandoff(chatMeta, text, quoteReadyData, scoreData)

  const freshLead = await Lead.findById(leadId).select('isQuoteReady isHandedToSales').lean()

  if (readyForHandoff && freshLead && !freshLead.isHandedToSales) {
    const quoteData = quoteReadyData || buildFallbackQuoteData(lead, scoreData, messagesAfterAi)
    await handleQuoteReady(leadId, customerId, quoteData, {
      messages: messagesAfterAi,
      scoreData,
    })
    await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'quote_ready', includeScoreRow: true })
  }

  chatService.refreshContextSummary(leadId).catch((err) => {
    console.error('[ContextSummary]', err.message)
  })
}

module.exports = { processCustomerMessage }
