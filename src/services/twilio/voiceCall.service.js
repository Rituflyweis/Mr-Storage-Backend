const bcrypt = require('bcryptjs')
const CallSession = require('../../models/CallSession')
const CallTurn = require('../../models/CallTurn')
const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const Message = require('../../models/Message')
const { CLOSED_STAGES, AUDIT_ACTIONS } = require('../../config/constants')
const { normalizePhoneForLookup, digitsOnly } = require('../../utils/normalizePhone')
const generateCustomerId = require('../../utils/generateCustomerId')
const twiml = require('./twiml.builder')
const chatService = require('../ai/chat.service')
const scoringService = require('../ai/scoring.service')
const auditService = require('../audit.service')
const leadListSocket = require('../leadListSocket.service')
const mailer = require('../email/mailer')
const {
  handleQuoteReady,
  buildFallbackQuoteData,
  advanceLifecycleIfNeeded,
  syncLeadProjectFieldsFromScore,
  syncPlannedStartFromMessages,
} = require('../leadQuoteReady.service')
const {
  isRequirementsGatheredFromChat,
  isReadyForSalesHandoff,
  canAdvanceLifecycle,
} = require('../ai/requirementsChecklist.service')
const env = require('../../config/env')

const PENDING_VOICE_EMAIL_DOMAIN = 'pending.voice.local'

const phonePartsFromTwilioFrom = (from) => {
  const { e164Digits, nationalNumber } = normalizePhoneForLookup(from)
  let countryCode = '+1'
  const raw = String(from || '')
  if (raw.startsWith('+') && e164Digits && nationalNumber && e164Digits.length > nationalNumber.length) {
    countryCode = `+${e164Digits.slice(0, e164Digits.length - nationalNumber.length)}`
  } else if (e164Digits.length === 12 && e164Digits.startsWith('91')) {
    countryCode = '+91'
  }
  return {
    number: nationalNumber || e164Digits || digitsOnly(from),
    countryCode,
  }
}

const pendingEmailForPhone = (nationalNumber) =>
  `call.${digitsOnly(nationalNumber) || 'unknown'}@${PENDING_VOICE_EMAIL_DOMAIN}`

const customerNeedsContactDetails = (customer) => {
  if (!customer) return true
  if (chatService.isPendingVoiceEmail(customer.email)) return true
  const name = String(customer.firstName || '').trim().toLowerCase()
  if (!name || name === 'caller' || name === 'guest') return true
  return false
}

/**
 * First-contact: create CRM customer from caller ID so the AI call can collect name/email.
 */
const createCustomerFromInboundCall = async (from) => {
  const phone = phonePartsFromTwilioFrom(from)
  const existing = await findCustomerByTwilioFrom(from)
  if (existing) return { customer: existing, created: false }

  const customerId = await generateCustomerId()
  const hashedPassword = await bcrypt.hash(phone.number || String(Date.now()), 12)
  const customer = await Customer.create({
    customerId,
    firstName: 'Caller',
    lastName: '',
    email: pendingEmailForPhone(phone.number),
    phone: { number: phone.number, countryCode: phone.countryCode },
    password: hashedPassword,
    source: 'call',
  })
  return { customer, created: true }
}

const looksLikeEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())

const applyContactUpdateFromCall = async (customerId, contactUpdate, speechText = '') => {
  if (!customerId) return { updated: false, contactComplete: false }

  const customer = await Customer.findById(customerId)
  if (!customer) return { updated: false, contactComplete: false }

  const patch = {}
  const fromAi = contactUpdate || {}
  const speechEmailMatch = String(speechText || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)

  const nextFirst = fromAi.firstName || ''
  const nextLast = fromAi.lastName || ''
  let nextEmail = fromAi.email || ''
  if (!looksLikeEmail(nextEmail) && speechEmailMatch) {
    nextEmail = speechEmailMatch[0].toLowerCase()
  }

  if (nextFirst && !['caller', 'guest'].includes(nextFirst.toLowerCase())) {
    if (customer.firstName === 'Caller' || !customer.firstName || customerNeedsContactDetails(customer)) {
      patch.firstName = nextFirst
    }
  }
  if (nextLast) patch.lastName = nextLast

  if (looksLikeEmail(nextEmail) && !nextEmail.endsWith(`@${PENDING_VOICE_EMAIL_DOMAIN}`)) {
    const clash = await Customer.findOne({
      email: nextEmail.toLowerCase(),
      _id: { $ne: customer._id },
    })
      .select('_id')
      .lean()
    if (!clash) {
      patch.email = nextEmail.toLowerCase()
    }
  }

  if (Object.keys(patch).length) {
    Object.assign(customer, patch)
    await customer.save()
  }

  const refreshed = await Customer.findById(customerId).lean()
  const contactComplete =
    Boolean(fromAi.contactComplete) ||
    (!customerNeedsContactDetails(refreshed) && !chatService.isPendingVoiceEmail(refreshed.email))

  if (contactComplete && patch.email && mailer.isEnquiryNotificationConfigured?.()) {
    try {
      await mailer.sendNewCustomerEnquiryNotification({
        customerName: refreshed.firstName,
        customerEmail: refreshed.email,
        customerPhone: refreshed.phone?.number,
        countryCode: refreshed.phone?.countryCode,
        source: 'ai_voice_call',
      })
    } catch (err) {
      console.warn('[VoiceCall] enquiry notify failed:', err.message)
    }
  }

  return { updated: Object.keys(patch).length > 0, contactComplete, customer: refreshed }
}

const webhookBase = (req) => {
  const configured = (env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '')
  if (configured) return configured
  if (req) {
    const host = req.get?.('host') || ''
    const proto = (req.get?.('x-forwarded-proto') || req.protocol || 'https')
      .split(',')[0]
      .trim()
    if (host) return `${proto}://${host}`
  }
  return ''
}

const gatherUrl = (sessionId, req) => {
  const base = webhookBase(req)
  const path = `/api/twilio/voice/gather?sessionId=${encodeURIComponent(String(sessionId))}`
  return base ? `${base}${path}` : path
}

const useElevenLabsRelay = () => !['gather', 'polly'].includes(env.VOICE_ENGINE || 'elevenlabs')

const elevenLabsVoiceAttribute = () => {
  const raw = String(env.ELEVENLABS_VOICE_ID || 'UgBBYS2sOqTuMpoF3BR0').trim()
  if (raw.includes('-')) return raw
  const model = String(env.ELEVENLABS_TTS_MODEL || 'v4').trim() || 'v4'
  return `${raw}-${model}`
}

const relayWebsocketUrl = (req) => {
  const base = webhookBase(req)
  if (!base) return ''
  const wsBase = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
  return `${wsBase}/api/twilio/voice/relay`
}

/** Speak a turn. ElevenLabs path uses ConversationRelay; welcomeGreeting is the first line only. */
const respondWithVoice = (req, session, message) => {
  if (useElevenLabsRelay()) {
    const url = relayWebsocketUrl(req)
    if (url) {
      return twiml.conversationRelay({
        websocketUrl: url,
        welcomeGreeting: message,
        voice: elevenLabsVoiceAttribute(),
        language: env.VOICE_LANGUAGE || 'en-US',
      })
    }
  }
  return twiml.sayGather({
    message,
    gatherActionUrl: gatherUrl(session._id, req),
  })
}

const LEAD_MEMORY_FIELDS = 'isHandedToSales isStaffChatActive aiContextSummary buildingType sqft location city state roofStyle projectName leadScoring.requirements'

const formatSqft = (sqft) => {
  const n = Number(String(sqft || '').replace(/,/g, ''))
  if (!Number.isFinite(n) || n <= 0) return String(sqft || '').trim()
  return n.toLocaleString('en-US')
}

/** Returning caller with a project on file: check in, instead of starting from scratch. */
const buildReturningGreeting = (customer, lead) => {
  const rawName = String(customer?.firstName || '').trim()
  const name = rawName && !['caller', 'guest'].includes(rawName.toLowerCase()) ? rawName : ''
  const hi = name ? `Hi ${name}, this is Alex.` : 'Hi, this is Alex.'
  const type = String(lead?.buildingType || '').trim()
  const sqft = formatSqft(lead?.sqft)
  const where = [lead?.city, lead?.state, lead?.location].filter(Boolean).join(', ')
  const project = String(lead?.projectName || '').trim()
  const hasProject = Boolean(
    type || sqft || where || project || lead?.aiContextSummary || lead?.leadScoring?.requirements,
  )
  if (!hasProject) {
    return `${hi} Thanks for calling. What can I help you with today?`
  }
  let subject = 'the project we have been planning'
  if (sqft && type && where) subject = `your ${sqft} square foot ${type} in ${where}`
  else if (sqft && type) subject = `your ${sqft} square foot ${type}`
  else if (type && where) subject = `your ${type} project in ${where}`
  else if (type) subject = `your ${type} project`
  else if (project) subject = `your ${project} project`
  return `${hi} I'm checking in on ${subject}. How is the planning going? Is everything okay?`
}

const emitAdmin = (event, payload) => {
  try {
    if (global.io) global.io.of('/admin').emit(event, payload)
    if (global.io && payload?.leadId) {
      global.io.of('/admin').to(`lead:${payload.leadId}`).emit(event, payload)
    }
  } catch (err) {
    console.warn('[VoiceCall] socket emit failed:', err.message)
  }
}

const findCustomerByTwilioFrom = async (from) => {
  const { lookupCandidates, nationalNumber, e164Digits } = normalizePhoneForLookup(from)
  const customer = await Customer.findOne({
    $or: [
      { 'phone.number': { $in: lookupCandidates } },
      { 'phone.number': nationalNumber },
      { 'phone.number': e164Digits },
    ],
  })
  return customer
}

const resolveActiveLead = async (customerId, { createIfMissing = true } = {}) => {
  // Prefer a lead the AI can still talk on (not handed to sales / staff takeover).
  let lead = await Lead.findOne({
    customerId,
    lifecycleStatus: { $nin: CLOSED_STAGES },
    isHandedToSales: { $ne: true },
    isStaffChatActive: { $ne: true },
  })
    .sort({ createdAt: -1 })

  // Returning callers whose only open lead is already with sales/plant get a NEW call lead
  // so AI does not immediately say "your sales rep will contact you" and hang up.
  if (!lead && createIfMissing) {
    lead = await Lead.create({
      customerId,
      source: 'call',
      lifecycleStatus: 'initial_contact',
      lifecycleHistory: [{ stage: 'initial_contact', changedAt: new Date(), changedBy: null }],
    })
    await auditService.log({
      type: 'lead',
      action: AUDIT_ACTIONS.LEAD_CREATED,
      leadId: lead._id,
      customerId,
      performedBy: null,
      metadata: { source: 'call', reason: 'voice_new_conversation' },
    })
    await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'voice_inbound' }).catch(() => {})
  }

  return lead
}

const saveTurnAndMessage = async ({
  session,
  role,
  transcript,
  twilioGatherSid = '',
}) => {
  const senderType = role === 'customer' ? 'customer' : role === 'ai' ? 'ai' : 'ai'
  let messageId = null

  if (session.leadId && session.customerId && (role === 'customer' || role === 'ai')) {
    const msg = await Message.create({
      leadId: session.leadId,
      customerId: session.customerId,
      senderType,
      content: transcript,
      origin: 'call',
      callSessionId: session._id,
    })
    messageId = msg._id
  }

  const turn = await CallTurn.create({
    callSessionId: session._id,
    leadId: session.leadId,
    customerId: session.customerId,
    role,
    transcript,
    twilioGatherSid,
    messageId,
  })

  emitAdmin('call_turn', {
    callSessionId: session._id,
    leadId: session.leadId,
    customerId: session.customerId,
    role,
    transcript,
    createdAt: turn.createdAt,
  })

  return turn
}

const handleInbound = async (body = {}, req = null) => {
  const callSid = body.CallSid
  const from = body.From || ''
  const to = body.To || ''

  if (!callSid) {
    return twiml.sayHangup({ message: 'We could not start this call. Please try again.' })
  }

  let session = await CallSession.findOne({ twilioCallSid: callSid })
  if (session) {
    if (!session.leadId || !session.customerId) {
      return twiml.sayHangup({
        message: 'We lost your call session. Please call again. Goodbye.',
      })
    }
    const lead = await Lead.findById(session.leadId).select(LEAD_MEMORY_FIELDS).lean()
    if (lead?.isHandedToSales || lead?.isStaffChatActive) {
      return twiml.sayHangup({
        message: 'Your sales representative will follow up with you shortly. Thank you for calling. Goodbye.',
      })
    }
    const customer = await Customer.findById(session.customerId).select('firstName').lean()
    return respondWithVoice(req, session, buildReturningGreeting(customer, lead))
  }

  // Returning customer OR first-contact — create CRM record from caller ID if needed
  let customer = await findCustomerByTwilioFrom(from)
  let isNewFromCall = false
  if (!customer) {
    const created = await createCustomerFromInboundCall(from)
    customer = created.customer
    isNewFromCall = created.created
  }

  const needsContact = customerNeedsContactDetails(customer)
  const lead = await resolveActiveLead(customer._id, { createIfMissing: true })
  session = await CallSession.create({
    twilioCallSid: callSid,
    customerId: customer._id,
    leadId: lead._id,
    fromNumber: from,
    toNumber: to,
    status: 'in-progress',
    isHandedToSales: Boolean(lead.isHandedToSales),
    needsContactDetails: needsContact || isNewFromCall,
    unknownCaller: false,
  })

  emitAdmin('call_started', {
    callSessionId: session._id,
    leadId: lead._id,
    customerId: customer._id,
    fromNumber: from,
    firstContact: Boolean(session.needsContactDetails),
  })

  if (lead.isHandedToSales || lead.isStaffChatActive) {
    session.status = 'completed'
    session.endedAt = new Date()
    await session.save()
    emitAdmin('call_ended', {
      callSessionId: session._id,
      leadId: lead._id,
      durationSeconds: 0,
      status: 'completed',
      reason: 'handed_to_sales',
    })
    return twiml.sayHangup({
      message: 'Your sales representative will follow up with you shortly. Thank you for calling. Goodbye.',
    })
  }

  const greeting = session.needsContactDetails
    ? `Thanks for calling. I'm Alex from our sales team. To get started, may I have your name please?`
    : buildReturningGreeting(customer, lead)

  await saveTurnAndMessage({
    session,
    role: 'ai',
    transcript: greeting,
  })

  return respondWithVoice(req, session, greeting)
}

const handleGather = async (body = {}, query = {}, req = null) => {
  const sessionId = query.sessionId || body.sessionId
  // Twilio field names vary slightly by speech product / region
  const speech = String(
    body.SpeechResult ||
      body.speechResult ||
      body.UnstableSpeechResult ||
      body.StableSpeechResult ||
      body.TranscriptionText ||
      '',
  ).trim()
  const callSid = body.CallSid
  if (speech) {
    console.log(
      `[VoiceCall] heard callSid=${callSid || ''} conf=${body.Confidence || body.confidence || ''} ` +
        `"${speech.slice(0, 120)}"`,
    )
  }

  let session = null
  if (sessionId) session = await CallSession.findById(sessionId)
  if (!session && callSid) session = await CallSession.findOne({ twilioCallSid: callSid })

  if (!session || !session.leadId || !session.customerId) {
    return twiml.sayHangup({
      message: 'We lost your call session. Please call again. Goodbye.',
    })
  }

  if (!speech) {
    const emptyCount = Number(session.emptyGatherCount || 0) + 1
    session.emptyGatherCount = emptyCount
    await session.save()
    console.warn(
      `[VoiceCall] empty speech #${emptyCount} callSid=${callSid || ''} session=${session._id} ` +
        `keys=${Object.keys(body || {}).join(',')}`,
    )
    if (emptyCount >= 3) {
      return twiml.sayHangup({
        message:
          "I'm still having trouble hearing you. Please try calling again from a quieter place. Goodbye.",
      })
    }
    return twiml.sayGather({
      message:
        emptyCount === 1
          ? "Sorry, I didn't catch that. Please say that again after the tone."
          : 'Still did not hear you. Speak a little louder and closer to the phone.',
      gatherActionUrl: gatherUrl(session._id, req),
    })
  }

  // Got speech — reset empty counter
  if (session.emptyGatherCount) {
    session.emptyGatherCount = 0
  }

  const fingerprint = `${callSid || ''}|${speech}`.slice(0, 500)
  if (session.lastSpeechFingerprint === fingerprint) {
    // Twilio retry — replay last AI turn if any
    const lastAi = await CallTurn.findOne({ callSessionId: session._id, role: 'ai' })
      .sort({ createdAt: -1 })
      .lean()
    return twiml.sayGather({
      message: lastAi?.transcript || 'Please continue.',
      gatherActionUrl: gatherUrl(session._id, req),
    })
  }
  session.lastSpeechFingerprint = fingerprint
  await session.save()

  const leadFresh = await Lead.findById(session.leadId)
    .select(LEAD_MEMORY_FIELDS)
    .populate('customerId')
  if (!leadFresh) {
    return twiml.sayHangup({ message: 'We could not find your project. Goodbye.' })
  }

  if (leadFresh.isHandedToSales || leadFresh.isStaffChatActive) {
    return twiml.sayHangup({
      message: 'Your sales representative will follow up with you shortly. Thank you. Goodbye.',
    })
  }

  await saveTurnAndMessage({
    session,
    role: 'customer',
    transcript: speech,
    twilioGatherSid: body.CallSid || '',
  })

  const messagesBeforeAi = await Message.find({ leadId: session.leadId })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt')
    .lean()

  let customer = leadFresh.customerId
  const needsContact =
    session.needsContactDetails || customerNeedsContactDetails(customer)

  const tChat = Date.now()
  const { text, quoteReadyData, chatMeta, contactUpdate } = await chatService.chat(
    messagesBeforeAi,
    {
      customer,
      currentConversationSummary: leadFresh.aiContextSummary || '',
      needsContactDetails: needsContact,
      voiceMode: true,
      projectLead: leadFresh,
    },
  )
  console.log(`[VoiceCall] claude_ms=${Date.now() - tChat} callSid=${callSid || ''}`)

  // Persist name/email collected on this first-contact call
  if (needsContact || contactUpdate) {
    const applied = await applyContactUpdateFromCall(session.customerId, contactUpdate, speech)
    if (applied.contactComplete) {
      session.needsContactDetails = false
      await session.save()
    } else if (applied.updated) {
      await session.save()
    }
    if (applied.customer) customer = applied.customer
  }

  const leadAfterAi = await Lead.findById(session.leadId)
    .select('isStaffChatActive isHandedToSales')
    .lean()
  if (leadAfterAi?.isStaffChatActive || leadAfterAi?.isHandedToSales) {
    return twiml.sayHangup({
      message: 'Your sales representative will follow up with you shortly. Thank you. Goodbye.',
    })
  }

  await saveTurnAndMessage({
    session,
    role: 'ai',
    transcript: text,
  })

  const stillNeedsContact =
    session.needsContactDetails || customerNeedsContactDetails(customer)

  // Do NOT await scoring here — a second Claude call was adding ~4–10s of dead air
  // and risking Twilio's ~15s webhook timeout ("application error").
  const readyForHandoff =
    !stillNeedsContact &&
    isReadyForSalesHandoff(chatMeta, text, quoteReadyData, {})

  scheduleVoiceFollowUp({
    session,
    customer,
    text,
    chatMeta,
    quoteReadyData,
    stillNeedsContact,
    readyForHandoff,
  })

  if (readyForHandoff) {
    session.isHandedToSales = true
    await session.save()
    const closing =
      `${twiml.sanitizeForSpeech(text)} ` +
      'A sales representative will follow up with your quote shortly. Thank you for calling. Goodbye.'
    return twiml.sayHangup({ message: closing })
  }

  return twiml.sayGather({
    message: text,
    gatherActionUrl: gatherUrl(session._id, req),
  })
}

const scheduleVoiceFollowUp = ({
  session,
  customer,
  text,
  chatMeta,
  quoteReadyData,
  stillNeedsContact,
  readyForHandoff,
}) => {
  const run = async () => {
    try {
      const messagesAfterAi = await Message.find({ leadId: session.leadId })
        .sort({ createdAt: 1 })
        .select('senderType content createdAt')
        .lean()
      const leadForScore = await Lead.findById(session.leadId)
      if (!leadForScore || stillNeedsContact) {
        await chatService.refreshContextSummary(session.leadId)
        return
      }
      const scoreData = await scoringService.scoreLead(
        messagesAfterAi,
        customer?.firstName || '',
      )
      scoringService.applyScoreToLead(leadForScore, scoreData)
      await Lead.findByIdAndUpdate(session.leadId, {
        $set: { leadScoring: leadForScore.leadScoring },
      })
      await syncLeadProjectFieldsFromScore(session.leadId, scoreData)
      await syncPlannedStartFromMessages(session.leadId, messagesAfterAi)
      if (canAdvanceLifecycle(messagesAfterAi) && isRequirementsGatheredFromChat(chatMeta, scoreData)) {
        await advanceLifecycleIfNeeded(session.leadId, 'requirements_gathered')
      }
      if (readyForHandoff || isReadyForSalesHandoff(chatMeta, text, quoteReadyData, scoreData)) {
        const quoteData =
          quoteReadyData || buildFallbackQuoteData(leadForScore, scoreData, messagesAfterAi)
        await handleQuoteReady(session.leadId, session.customerId, quoteData, {
          messages: messagesAfterAi,
          scoreData,
        })
      }
      await chatService.refreshContextSummary(session.leadId)
    } catch (err) {
      console.error('[VoiceCall] post-turn jobs:', err.message)
    }
  }
  setImmediate(() => {
    run().catch(() => {})
  })
}

const SALES_GOODBYE =
  'Your sales representative will follow up with you shortly. Thank you for calling. Goodbye.'

/**
 * One ConversationRelay caller turn. `sendText(token, last)` streams ElevenLabs speech.
 * Returns { endCall } when the call should hang up.
 */
const handleRelayPrompt = async ({ callSid, speech, signal, sendText }) => {
  const finish = async (token) => {
    const clean = String(token || '').replace(/[*_`#~>]+/g, '')
    if (clean.trim()) await sendText(clean, true)
  }

  const session = await CallSession.findOne({ twilioCallSid: callSid })
  if (!session?.leadId || !session.customerId) {
    await finish('We lost this call session. Please call again. Goodbye.')
    return { endCall: true }
  }

  const leadFresh = await Lead.findById(session.leadId)
    .select(LEAD_MEMORY_FIELDS)
    .populate('customerId')
  if (!leadFresh) {
    await finish('We could not find your project. Goodbye.')
    return { endCall: true }
  }
  if (leadFresh.isHandedToSales || leadFresh.isStaffChatActive) {
    await finish(SALES_GOODBYE)
    return { endCall: true }
  }

  const heard = String(speech || '').trim()
  if (!heard) {
    await finish('Sorry, I did not catch that. Could you please repeat?')
    return { endCall: false }
  }

  await saveTurnAndMessage({
    session,
    role: 'customer',
    transcript: heard,
    twilioGatherSid: callSid,
  })

  const messagesBeforeAi = await Message.find({ leadId: session.leadId })
    .sort({ createdAt: 1 })
    .select('senderType content createdAt')
    .lean()

  let customer = leadFresh.customerId
  const needsContact = session.needsContactDetails || customerNeedsContactDetails(customer)

  let held = ''
  const push = async (token, last) => {
    if (signal?.aborted) return
    const clean = String(token || '').replace(/[*_`#~>]+/g, '')
    if (!last) {
      if (held.trim()) await sendText(held, false)
      held = clean
      return
    }
    const merged = `${held}${clean}`
    held = ''
    if (merged.trim()) await sendText(merged, true)
  }

  let result
  try {
    result = await chatService.streamChat(messagesBeforeAi, {
      customer,
      currentConversationSummary: leadFresh.aiContextSummary || '',
      needsContactDetails: needsContact,
      voiceMode: true,
      projectLead: leadFresh,
      signal,
      onText: (chunk) => push(chunk, false),
    })
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError' || err?.name === 'APIUserAbortError') {
      return { endCall: false, aborted: true }
    }
    console.error('[VoiceCall] relay claude:', err.message)
    await finish('Sorry, I had a brief glitch. Could you please repeat that?')
    return { endCall: false }
  }

  if (signal?.aborted) return { endCall: false, aborted: true }

  const spoken = String(result.text || '').trim()
  await push('', true)
  if (!spoken) await finish('Could you say that one more time?')

  if (needsContact || result.contactUpdate) {
    const applied = await applyContactUpdateFromCall(session.customerId, result.contactUpdate, heard)
    if (applied.contactComplete) {
      session.needsContactDetails = false
      await session.save()
    } else if (applied.updated) {
      await session.save()
    }
    if (applied.customer) customer = applied.customer
  }

  await saveTurnAndMessage({
    session,
    role: 'ai',
    transcript: spoken || 'Could you say that one more time?',
  })

  const leadAfterAi = await Lead.findById(session.leadId)
    .select('isStaffChatActive isHandedToSales')
    .lean()
  if (leadAfterAi?.isStaffChatActive || leadAfterAi?.isHandedToSales) {
    await finish(SALES_GOODBYE)
    return { endCall: true }
  }

  const stillNeedsContact = session.needsContactDetails || customerNeedsContactDetails(customer)
  const readyForHandoff =
    !stillNeedsContact &&
    isReadyForSalesHandoff(result.chatMeta, result.text, result.quoteReadyData, {})

  scheduleVoiceFollowUp({
    session,
    customer,
    text: result.text,
    chatMeta: result.chatMeta,
    quoteReadyData: result.quoteReadyData,
    stillNeedsContact,
    readyForHandoff,
  })

  if (readyForHandoff) {
    session.isHandedToSales = true
    await session.save()
    await finish('A sales representative will follow up with your quote shortly. Thank you for calling. Goodbye.')
    return { endCall: true }
  }

  return { endCall: false }
}

const recordInterruptedReply = async (callSid, transcript) => {
  const text = String(transcript || '').trim()
  if (!callSid || !text) return
  const session = await CallSession.findOne({ twilioCallSid: callSid })
  if (!session) return
  await saveTurnAndMessage({ session, role: 'ai', transcript: text })
}

const handleStatus = async (body = {}) => {
  const callSid = body.CallSid
  if (!callSid) return { ok: true }

  const session = await CallSession.findOne({ twilioCallSid: callSid })
  if (!session) return { ok: true }

  const twilioStatus = String(body.CallStatus || '').toLowerCase()
  const map = {
    completed: 'completed',
    busy: 'busy',
    failed: 'failed',
    'no-answer': 'no-answer',
    canceled: 'canceled',
    cancelled: 'canceled',
  }
  if (map[twilioStatus]) session.status = map[twilioStatus]
  else if (session.status === 'in-progress') session.status = 'completed'

  session.endedAt = new Date()
  const duration = parseInt(body.CallDuration || body.Duration || '', 10)
  if (Number.isFinite(duration)) session.durationSeconds = duration
  else if (session.startedAt) {
    session.durationSeconds = Math.max(
      0,
      Math.round((session.endedAt - session.startedAt) / 1000),
    )
  }
  await session.save()

  emitAdmin('call_ended', {
    callSessionId: session._id,
    leadId: session.leadId,
    durationSeconds: session.durationSeconds,
    status: session.status,
  })

  return { ok: true, callSessionId: session._id }
}

const handleFallback = () =>
  twiml.sayHangup({
    message: 'We are having trouble with this call. Please try again later. Goodbye.',
  })

const listCallsForLead = async (leadId, { page = 1, limit = 20 } = {}) => {
  const parsedPage = Math.max(1, Number(page) || 1)
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20))
  const skip = (parsedPage - 1) * parsedLimit
  const filter = { leadId, unknownCaller: { $ne: true } }

  const [rows, total] = await Promise.all([
    CallSession.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
    CallSession.countDocuments(filter),
  ])

  return {
    calls: rows.map((s) => ({
      callSessionId: s._id,
      twilioCallSid: s.twilioCallSid,
      status: s.status,
      fromNumber: s.fromNumber,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationSeconds: s.durationSeconds,
      isHandedToSales: s.isHandedToSales,
    })),
    total,
    page: parsedPage,
    limit: parsedLimit,
  }
}

const getCallDetail = async (callSessionId) => {
  const session = await CallSession.findById(callSessionId).lean()
  if (!session) return null

  const turns = await CallTurn.find({ callSessionId })
    .sort({ createdAt: 1 })
    .lean()

  return {
    call: {
      callSessionId: session._id,
      twilioCallSid: session.twilioCallSid,
      leadId: session.leadId,
      customerId: session.customerId,
      status: session.status,
      fromNumber: session.fromNumber,
      toNumber: session.toNumber,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationSeconds: session.durationSeconds,
      isHandedToSales: session.isHandedToSales,
    },
    turns: turns.map((t) => ({
      turnId: t._id,
      role: t.role,
      transcript: t.transcript,
      createdAt: t.createdAt,
      messageId: t.messageId,
    })),
  }
}

module.exports = {
  handleInbound,
  handleGather,
  handleRelayPrompt,
  recordInterruptedReply,
  handleStatus,
  handleFallback,
  listCallsForLead,
  getCallDetail,
  findCustomerByTwilioFrom,
  createCustomerFromInboundCall,
  customerNeedsContactDetails,
  gatherUrl,
  buildReturningGreeting,
}
