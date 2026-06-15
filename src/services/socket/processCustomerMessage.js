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
  syncLeadProjectFieldsFromScore,
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
  const leadForChat = await Lead.findById(leadId)
    .select('isChatEnded isStaffChatActive isHandedToSales assignedSales')
    .lean()
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

  // Staff (admin/sales) has taken over — AI stays silent; admin assigns sales manually.
  if (leadForChat?.isStaffChatActive || leadForChat?.isHandedToSales) {
    if (leadForChat.isHandedToSales && leadForChat.assignedSales) {
      notifyAssignedSales(leadId, leadForChat.assignedSales, {
        senderType: 'customer',
        content: content.trim(),
        createdAt: customerMsg.createdAt,
      })
    } else if (leadForChat.isStaffChatActive && global.io) {
      global.io.of('/admin').to('admin_room').emit('new_customer_message', {
        leadId,
        message: {
          senderType: 'customer',
          content: content.trim(),
          createdAt: customerMsg.createdAt,
        },
      })
    }
    return
  }

  const lead = await Lead.findById(leadId).populate('customerId')
  if (!lead) return

  const customer = lead.customerId

  const messagesBeforeAi = await Message.find({ leadId })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt')
    .lean()

  chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: true })

  const { text, quoteReadyData, chatMeta } = await chatService.chat(messagesBeforeAi, {
    customer,
    currentConversationSummary: lead.aiContextSummary || '',
  })

  // Staff may have intervened while Claude was responding — discard AI reply.
  const leadAfterAi = await Lead.findById(leadId)
    .select('isStaffChatActive isHandedToSales')
    .lean()
  if (leadAfterAi?.isStaffChatActive || leadAfterAi?.isHandedToSales) {
    chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: false })
    return
  }

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
  await syncLeadProjectFieldsFromScore(leadId, scoreData)

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

  if (readyForHandoff) {
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
