const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const env = require('../../config/env')
const { CLOSED_STAGES, AUDIT_ACTIONS } = require('../../config/constants')
const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const Message = require('../../models/Message')
const chatService = require('../ai/chat.service')
const scoringService = require('../ai/scoring.service')
const auditService = require('../audit.service')
const leadListSocket = require('../leadListSocket.service')
const generateCustomerId = require('../../utils/generateCustomerId')
const { syncLeadBuildings } = require('../leadBuilding.service')
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
  syncPlannedStartFromMessages,
} = require('../leadQuoteReady.service')

const PLACEHOLDER_EMAIL_DOMAIN = 'pending.messenger.local'
const SALES_FOLLOW_UP = 'Thanks — a sales representative has this conversation and will follow up with you.'

const isConfigured = () =>
  Boolean(env.FACEBOOK_PAGE_ACCESS_TOKEN && env.FACEBOOK_VERIFY_TOKEN)

const signaturesMatch = (rawBody, header) => {
  const secret = env.FACEBOOK_APP_SECRET
  if (!secret) return false
  const received = String(header || '')
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

const graphUrl = (path) =>
  `https://graph.facebook.com/${env.FACEBOOK_GRAPH_VERSION || 'v21.0'}${path}`

const splitForMessenger = (text) => {
  const chunks = []
  let rest = String(text || '').trim()
  while (rest.length > 2000) {
    let cut = rest.lastIndexOf('\n', 2000)
    if (cut < 800) cut = rest.lastIndexOf(' ', 2000)
    if (cut < 800) cut = 2000
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}

const sendText = async (psid, text) => {
  const token = env.FACEBOOK_PAGE_ACCESS_TOKEN
  if (!token) throw new Error('FACEBOOK_PAGE_ACCESS_TOKEN is not set')
  for (const chunk of splitForMessenger(text)) {
    const response = await fetch(graphUrl('/me/messages'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: psid },
        messaging_type: 'RESPONSE',
        message: { text: chunk },
      }),
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Messenger send failed (${response.status}): ${body.slice(0, 300)}`)
    }
  }
}

const fetchProfile = async (psid) => {
  const token = env.FACEBOOK_PAGE_ACCESS_TOKEN
  if (!token) return null
  try {
    const url = `${graphUrl(`/${encodeURIComponent(psid)}`)}?fields=first_name,last_name`
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) return null
    return await response.json()
  } catch (err) {
    console.warn('[Messenger] profile lookup failed:', err.message)
    return null
  }
}

const ensureCustomerAndLead = async (psid) => {
  let customer = await Customer.findOne({ facebookPsid: psid })
  let createdCustomer = false
  if (!customer) {
    const profile = await fetchProfile(psid)
    const customerId = await generateCustomerId()
    customer = await Customer.create({
      customerId,
      firstName: String(profile?.first_name || 'Facebook').trim() || 'Facebook',
      lastName: String(profile?.last_name || '').trim(),
      email: `fb-${psid}@${PLACEHOLDER_EMAIL_DOMAIN}`,
      phone: { number: String(psid), countryCode: '+0' },
      password: await bcrypt.hash(`messenger:${psid}`, 12),
      source: 'messenger',
      facebookPsid: psid,
    })
    createdCustomer = true
  }

  let lead = await Lead.findOne({
    customerId: customer._id,
    lifecycleStatus: { $nin: CLOSED_STAGES },
  }).sort({ createdAt: -1 })

  if (!lead) {
    lead = await Lead.create({
      customerId: customer._id,
      source: 'messenger',
      lifecycleStatus: 'initial_contact',
      lifecycleHistory: [{ stage: 'initial_contact', changedAt: new Date(), changedBy: null }],
    })
    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_CREATED,
      leadId: lead._id,
      customerId: customer._id,
      performedBy: null,
      metadata: { source: 'messenger', facebookPsid: psid },
    })
    await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'messenger' }).catch(() => {})
    await syncLeadBuildings(lead, { createdBy: null }).catch((err) => {
      console.warn('[Messenger] building sync skipped:', err.message)
    })
    const { notifyAdminsOfNewLead } = require('../../utils/leadCreatedNotify.util')
    await notifyAdminsOfNewLead(lead, {
      customerId: customer._id,
      inbound: true,
      source: 'messenger',
    }).catch(() => {})
  }

  return { customer, lead, createdCustomer }
}

const saveMessage = async ({ lead, customer, senderType, content, facebookMid }) => {
  const message = await Message.create({
    leadId: lead._id,
    customerId: customer._id,
    senderType,
    content,
    origin: 'messenger',
    ...(facebookMid ? { facebookMid } : {}),
    senderName: senderType === 'customer' ? customer.firstName || 'Facebook' : 'Alex',
  })
  if (global.io) {
    const payload = {
      _id: message._id,
      senderType,
      content,
      createdAt: message.createdAt,
      leadId: lead._id,
      origin: 'messenger',
    }
    global.io.of('/admin').to(`lead:${lead._id}`).emit('new_message', payload)
    global.io.of('/admin').to('admin_room').emit('new_customer_message', {
      leadId: lead._id,
      message: payload,
    })
  }
  return message
}

const incomingText = (event) => {
  if (event?.message?.is_echo) return ''
  const text = String(event?.message?.text || event?.postback?.title || '').trim()
  if (text) return text
  if (event?.message?.attachments?.length) return '[Sent an attachment]'
  return ''
}

const handleIncoming = async (event) => {
  const psid = String(event?.sender?.id || '').trim()
  const text = incomingText(event)
  const mid = String(event?.message?.mid || '')
  if (!psid || !text) return
  if (env.FACEBOOK_PAGE_ID && String(event?.recipient?.id || '') !== env.FACEBOOK_PAGE_ID) return
  if (mid) {
    const duplicate = await Message.findOne({ facebookMid: mid }).select('_id').lean()
    if (duplicate) return
  }

  const { customer, lead } = await ensureCustomerAndLead(psid)
  await saveMessage({ lead, customer, senderType: 'customer', content: text, facebookMid: mid || null })

  if (lead.isChatEnded) return
  if (lead.isHandedToSales || lead.isStaffChatActive) {
    const lastAi = await Message.findOne({ leadId: lead._id, senderType: 'ai' }).sort({ createdAt: -1 }).lean()
    if (lastAi?.content === SALES_FOLLOW_UP) return
    await saveMessage({ lead, customer, senderType: 'ai', content: SALES_FOLLOW_UP })
    await sendText(psid, SALES_FOLLOW_UP)
    return
  }

  const history = await Message.find({ leadId: lead._id })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt')
    .lean()

  const { text: reply, quoteReadyData, chatMeta } = await chatService.chat(history, {
    customer,
    currentConversationSummary: lead.aiContextSummary || '',
    messengerMode: true,
    projectLead: lead,
  })
  const visible = String(reply || '').trim() || 'Could you tell me a bit more about the building you have in mind?'

  const fresh = await Lead.findById(lead._id).select('isStaffChatActive isHandedToSales').lean()
  if (fresh?.isStaffChatActive || fresh?.isHandedToSales) return

  await saveMessage({ lead, customer, senderType: 'ai', content: visible })
  await sendText(psid, visible)

  const messagesAfterAi = await Message.find({ leadId: lead._id })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt')
    .lean()
  const scored = await scoringService.updateLeadScore(lead._id, messagesAfterAi, customer.firstName || '')
  const scoreData = scored?.scoreData
  if (scoreData) {
    await syncLeadProjectFieldsFromScore(lead._id, scoreData)
    await syncPlannedStartFromMessages(lead._id, messagesAfterAi)
    if (canAdvanceLifecycle(messagesAfterAi) && isRequirementsGatheredFromChat(chatMeta, scoreData)) {
      await advanceLifecycleIfNeeded(lead._id, 'requirements_gathered')
    }
    if (isReadyForSalesHandoff(chatMeta, visible, quoteReadyData, scoreData)) {
      const quoteData = quoteReadyData || buildFallbackQuoteData(scored.lead || lead, scoreData, messagesAfterAi)
      await handleQuoteReady(lead._id, customer._id, quoteData, { messages: messagesAfterAi, scoreData })
    }
  }
  chatService.refreshContextSummary(lead._id).catch((err) => {
    console.error('[Messenger] summary:', err.message)
  })
}

const handleWebhookBody = async (body) => {
  const entries = Array.isArray(body?.entry) ? body.entry : []
  for (const entry of entries) {
    const events = Array.isArray(entry?.messaging) ? entry.messaging : []
    for (const event of events) {
      try {
        await handleIncoming(event)
      } catch (err) {
        console.error('[Messenger] event failed:', err.message)
      }
    }
  }
}

module.exports = {
  isConfigured,
  signaturesMatch,
  handleWebhookBody,
  sendText,
}
