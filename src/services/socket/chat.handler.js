const Message = require('../../models/Message')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const chatService = require('../ai/chat.service')
const scoringService = require('../ai/scoring.service')
const roundRobinService = require('../roundRobin.service')
const auditService = require('../audit.service')
const { AUDIT_ACTIONS } = require('../../config/constants')

const chatHandler = (socket, chatNS) => {

  // ── join_lead ──────────────────────────────────────────────────────────────
  socket.on('join_lead', ({ leadId, customerId }) => {
    if (!leadId) return
    socket.join(`lead:${leadId}`)
    socket.data.leadId = leadId
    socket.data.customerId = customerId
  })

  // ── typing indicators ──────────────────────────────────────────────────────
  socket.on('typing_start', ({ leadId }) => {
    if (!leadId) return
    socket.to(`lead:${leadId}`).emit('customer_typing', { isTyping: true })
    // Also notify admin namespace
    if (global.io) {
      global.io.of('/admin').to(`lead:${leadId}`).emit('customer_typing', { isTyping: true })
    }
  })

  socket.on('typing_stop', ({ leadId }) => {
    if (!leadId) return
    socket.to(`lead:${leadId}`).emit('customer_typing', { isTyping: false })
    if (global.io) {
      global.io.of('/admin').to(`lead:${leadId}`).emit('customer_typing', { isTyping: false })
    }
  })

  // ── customer_message ───────────────────────────────────────────────────────
  socket.on('customer_message', async ({ leadId, customerId, content }) => {
    if (!leadId || !customerId || !content?.trim()) return

    try {
      // 1. Save customer message
      const customerMsg = await Message.create({
        leadId,
        customerId,
        senderType: 'customer',
        content: content.trim(),
      })

      // Broadcast customer message to admin namespace (for monitoring)
      if (global.io) {
        global.io.of('/admin').to(`lead:${leadId}`).emit('new_message', {
          _id: customerMsg._id,
          senderType: 'customer',
          content: customerMsg.content,
          createdAt: customerMsg.createdAt,
          leadId,
        })
      }

      // 2. Load lead to check isHandedToSales
      const lead = await Lead.findById(leadId).populate('customerId').lean()
      if (!lead) return

      // 3. If already handed to sales, just notify assigned sales employee — AI stays silent
      if (lead.isHandedToSales) {
        if (global.io && lead.assignedSales) {
          global.io.of('/admin').to(`user:${lead.assignedSales}`).emit('new_customer_message', {
            leadId,
            message: { senderType: 'customer', content: content.trim(), createdAt: new Date() },
          })
        }
        return
      }

      // 4. Load all messages for this lead to build context
      const allMessages = await Message.find({ leadId })
        .sort({ createdAt: 1 })
        .select('senderType content createdAt')
        .lean()

      // 5. Emit ai_typing to customer
      chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: true })

      // 6. Call Claude
      const customer = lead.customerId
      const { text, quoteData } = await chatService.chat(allMessages, {
        customer,
        currentConversationSummary: lead.aiContextSummary || '',
      })

      // 7. Save AI message
      const aiMsg = await Message.create({
        leadId,
        customerId,
        senderType: 'ai',
        content: text,
      })

      // 8. Stop typing indicator + broadcast AI message
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

      // 9. Handle quote ready — QUOTE_DATA detected in AI response
      if (quoteData) {
        await handleQuoteReady(leadId, customerId, quoteData, lead)
      }

      // 10. Fire-and-forget: update rolling summary + lead score
      chatService.refreshContextSummary(leadId)
        .catch(err => console.error('[ContextSummary]', err.message))
      scoringService.updateLeadScore(leadId, allMessages, customer?.firstName || '')
        .catch(err => console.error('[Scoring]', err.message))

    } catch (err) {
      console.error('[ChatHandler] customer_message error:', err.message)
      chatNS.to(`lead:${leadId}`).emit('ai_typing', { isTyping: false })
      chatNS.to(`lead:${leadId}`).emit('chat_error', { message: 'Something went wrong. Please try again.' })
    }
  })
}

// ─── QUOTE READY HANDLER ───────────────────────────────────────────────────────
const handleQuoteReady = async (leadId, customerId, quoteData, lead) => {
  try {
    // 1. Store raw AI-extracted quote data on the lead for sales employee to reference
    // Sales employee will use this to manually create the formal Quotation
    await Lead.findByIdAndUpdate(leadId, {
      isQuoteReady: true,
      quoteValue: quoteData.priceMin || 0,
      aiQuoteData: quoteData, // full Claude QUOTE_DATA object stored as-is
    })

    // 2. AuditLog
    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_QUOTE_READY,
      leadId,
      customerId,
      performedBy: null,
      metadata: { priceMin: quoteData.priceMin, priceMax: quoteData.priceMax },
    })

    // 3. Notify admin panel
    if (global.io) {
      global.io.of('/admin').to('admin_room').emit('lead_quote_ready', { leadId, customerId })
    }

    // 4. Round-robin assign a sales employee
    await roundRobinService.assignNextSales(leadId, customerId)

    // 5. Load full lead to enrich customer-facing and sales-facing payloads
    const updatedLead = await Lead.findById(leadId)
      .populate('customerId')
      .populate('assignedSales')
      .lean()

    // 6. Tell the customer they have been connected to a sales rep
    if (global.io) {
      global.io.of('/chat').to(`lead:${leadId}`).emit('lead_handed_to_sales', {
        assignedSales: updatedLead?.assignedSales?.name || 'a sales representative',
      })
    }

    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_HANDED_TO_SALES,
      leadId,
      customerId,
      performedBy: null,
      metadata: { assignedTo: updatedLead?.assignedSales?._id },
    })

  } catch (err) {
    console.error('[ChatHandler] handleQuoteReady error:', err.message)
  }
}

module.exports = chatHandler
