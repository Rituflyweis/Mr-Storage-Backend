const twilio = require('twilio')
const env = require('../../config/env')
const VoiceOutreach = require('../../models/VoiceOutreach')
const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const { sendSms, isTwilioConfigured } = require('../sms/sms.service')
const { digitsOnly } = require('../../utils/normalizePhone')
const twiml = require('./twiml.builder')

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])

const STATE_TZ = {
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', IN: 'America/Indiana/Indianapolis', KY: 'America/New_York', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', NH: 'America/New_York',
  NJ: 'America/New_York', NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', VT: 'America/New_York',
  VA: 'America/New_York', WV: 'America/New_York',
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago',
  KS: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago', MS: 'America/Chicago',
  MO: 'America/Chicago', NE: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago',
  TN: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago', ND: 'America/Chicago',
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver',
  NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles',
  AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
}

const companyName = () =>
  String(env.INVOICE_COMPANY_NAME || 'Steel Building Depot').replace(/\s+/g, ' ').trim() || 'Steel Building Depot'

const ourNumber = () => env.TWILIO_PHONE_NUMBER || env.TWILIO_FROM_PHONE || ''

const webhookBase = () => (env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '')

const hourStart = () => {
  const n = Number(env.VOICE_OUTBOUND_HOUR_START)
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 9
}

const hourEnd = () => {
  const n = Number(env.VOICE_OUTBOUND_HOUR_END)
  return Number.isFinite(n) ? Math.min(24, Math.max(1, n)) : 19
}

const maxAttempts = () => {
  const n = Number(env.VOICE_OUTBOUND_MAX_ATTEMPTS)
  return Number.isFinite(n) && n >= 1 ? Math.min(8, n) : 3
}

const zonedParts = (date, timeZone) => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  })
  const bag = {}
  for (const part of fmt.formatToParts(date)) bag[part.type] = part.value
  return bag
}

const isOpenAt = (date, timeZone) => {
  try {
    const parts = zonedParts(date, timeZone)
    const hour = Number(parts.hour)
    return WEEKDAYS.has(parts.weekday) && hour >= hourStart() && hour < hourEnd()
  } catch (err) {
    console.warn('[VoiceOutbound] bad timezone', timeZone, err.message)
    return true
  }
}

const snapToWindow = (date, timeZone) => {
  let cursor = new Date(date.getTime())
  for (let i = 0; i < 24 * 14 * 2; i += 1) {
    if (isOpenAt(cursor, timeZone)) return cursor
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000)
  }
  return cursor
}

const timezoneFor = ({ e164, state }) => {
  const digits = digitsOnly(e164)
  if (digits.startsWith('91') && digits.length >= 12) return 'Asia/Kolkata'
  const key = String(state || '').trim().toUpperCase()
  if (STATE_TZ[key]) return STATE_TZ[key]
  return env.VOICE_OUTBOUND_DEFAULT_TZ || 'America/Chicago'
}

const toE164 = (customer) => {
  const cc = digitsOnly(customer?.phone?.countryCode || '1') || '1'
  let national = digitsOnly(customer?.phone?.number)
  if (!national) return ''
  if (national.startsWith(cc) && national.length > cc.length + 6) return `+${national}`
  return `+${cc}${national}`
}

const firstName = (customer) => {
  const raw = String(customer?.firstName || '').trim()
  if (!raw || ['caller', 'guest'].includes(raw.toLowerCase())) return ''
  return raw
}

const voicemailMessage = (customer) => {
  const who = firstName(customer)
  const hi = who ? `Hi ${who}.` : 'Hi.'
  return `${hi} This is Alex with ${companyName()}. I'm following up on the building you asked about. Please call us back at ${ourNumber()} or we will try you again. Goodbye.`
}

const smsBody = (customer) => {
  const who = firstName(customer)
  const hi = who ? `Hi ${who},` : 'Hi,'
  return `${hi} this is Alex from ${companyName()}. We tried to reach you about your building inquiry. Call us back at ${ourNumber()}, or reply STOP to opt out.`
}

const outboundGreeting = (customer, lead, hasProjectGreeting) => {
  if (hasProjectGreeting) return hasProjectGreeting
  const who = firstName(customer)
  const hi = who
    ? `Hi ${who}, this is Alex with ${companyName()}.`
    : `Hi, this is Alex with ${companyName()}.`
  return `${hi} I'm following up on the building you asked about. Do you have a minute to talk?`
}

let client = null
const getClient = () => {
  if (!isTwilioConfigured() && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && ourNumber())) return null
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null
  if (!client) client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
  return client
}

const loadCustomer = async (customerOrId) => {
  if (customerOrId && customerOrId.phone) return customerOrId
  if (!customerOrId) return null
  return Customer.findById(customerOrId)
}

const enqueueInquiryCallback = async ({ lead, customer, customerId }) => {
  if (!env.VOICE_OUTBOUND_ENABLED) return null
  const leadId = lead?._id || lead
  const person = await loadCustomer(customer || customerId || lead?.customerId)
  if (!person || person.voiceOptOut) return null
  const toNumber = toE164(person)
  if (!toNumber) return null

  const open = await VoiceOutreach.findOne({
    leadId,
    status: { $in: ['scheduled', 'dialing', 'in-progress'] },
  }).select('_id')
  if (open) return open

  const leadDoc = lead?.state !== undefined
    ? lead
    : await Lead.findById(leadId).select('state').lean()
  const timezone = timezoneFor({ e164: toNumber, state: leadDoc?.state })
  const delayMin = Number(env.VOICE_OUTBOUND_DELAY_MINUTES)
  const wait = Number.isFinite(delayMin) && delayMin >= 0 ? delayMin : 30
  const nextAttemptAt = snapToWindow(new Date(Date.now() + wait * 60 * 1000), timezone)

  const row = await VoiceOutreach.create({
    leadId,
    customerId: person._id,
    toNumber,
    timezone,
    status: 'scheduled',
    maxAttempts: maxAttempts(),
    nextAttemptAt,
    source: 'inquiry',
  })
  console.log(
    `[VoiceOutbound] queued lead=${leadId} to=${toNumber} at=${nextAttemptAt.toISOString()} tz=${timezone}`,
  )
  return row
}

const scheduleRetry = async (outreach, result) => {
  outreach.lastResult = result
  outreach.attemptCount = Number(outreach.attemptCount || 0)
  if (outreach.attemptCount >= (outreach.maxAttempts || maxAttempts())) {
    outreach.status = 'exhausted'
    outreach.nextAttemptAt = null
    await outreach.save()
    console.log(`[VoiceOutbound] exhausted ${outreach._id} last=${result}`)
    return
  }
  const spacing = Number(env.VOICE_OUTBOUND_SPACING_MINUTES)
  const minutes = Number.isFinite(spacing) && spacing >= 5 ? spacing : 120
  outreach.status = 'scheduled'
  outreach.nextAttemptAt = snapToWindow(
    new Date(Date.now() + minutes * 60 * 1000),
    outreach.timezone || env.VOICE_OUTBOUND_DEFAULT_TZ,
  )
  await outreach.save()
  console.log(
    `[VoiceOutbound] retry ${outreach.attemptCount}/${outreach.maxAttempts} at=${outreach.nextAttemptAt.toISOString()} result=${result}`,
  )
}

const sendMissedText = async (outreach) => {
  if (!env.VOICE_OUTBOUND_SMS || outreach.smsSentAt) return
  const customer = await Customer.findById(outreach.customerId).select('firstName voiceOptOut')
  if (!customer || customer.voiceOptOut) return
  try {
    await sendSms({ to: outreach.toNumber, body: smsBody(customer) })
    outreach.smsSentAt = new Date()
    await outreach.save()
  } catch (err) {
    console.warn('[VoiceOutbound] sms failed:', err.message)
  }
}

const dialOutreach = async (outreach, { ignoreHours = false, detectMachine = env.VOICE_OUTBOUND_VOICEMAIL } = {}) => {
  const sdk = getClient()
  const from = ourNumber()
  const base = webhookBase()
  if (!sdk || !from || !base) {
    console.warn('[VoiceOutbound] skip dial, Twilio number or webhook base is missing')
    return null
  }
  const customer = await Customer.findById(outreach.customerId).select('firstName voiceOptOut phone')
  if (!customer || customer.voiceOptOut) {
    outreach.status = 'opted-out'
    await outreach.save()
    return null
  }
  if (!ignoreHours && !isOpenAt(new Date(), outreach.timezone || env.VOICE_OUTBOUND_DEFAULT_TZ)) {
    outreach.status = 'scheduled'
    outreach.nextAttemptAt = snapToWindow(new Date(), outreach.timezone)
    await outreach.save()
    return null
  }

  outreach.attemptCount = Number(outreach.attemptCount || 0) + 1
  outreach.status = 'dialing'
  outreach.voicemailLeft = false
  await outreach.save()

  const id = encodeURIComponent(String(outreach._id))
  const payload = {
    to: outreach.toNumber,
    url: `${base}/api/twilio/voice/outbound?outreachId=${id}`,
    method: 'POST',
    statusCallback: `${base}/api/twilio/voice/status`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed'],
    machineDetection: detectMachine ? 'DetectMessageEnd' : undefined,
    asyncAmd: detectMachine ? 'true' : undefined,
    asyncAmdStatusCallback: detectMachine
      ? `${base}/api/twilio/voice/amd?outreachId=${id}`
      : undefined,
    asyncAmdStatusCallbackMethod: 'POST',
    timeout: 25,
  }
  const callerIds = [...new Set([env.TWILIO_PHONE_NUMBER, env.TWILIO_FROM_PHONE].map((n) => String(n || '').trim()).filter(Boolean))]
  let call = null
  let lastError = null
  for (const from of callerIds) {
    try {
      call = await sdk.calls.create({ ...payload, from })
      break
    } catch (err) {
      lastError = err
      const unverified = /not yet verified|unable to create record/i.test(err.message || '')
      if (!unverified || callerIds[callerIds.length - 1] === from) break
      console.warn(`[VoiceOutbound] ${from} cannot place calls, trying the next Twilio number`)
    }
  }
  if (!call) {
    outreach.attemptCount = Math.max(0, outreach.attemptCount - 1)
    outreach.status = 'scheduled'
    outreach.lastResult = 'error'
    outreach.nextAttemptAt = new Date(Date.now() + 15 * 60 * 1000)
    await outreach.save()
    throw lastError || new Error('Twilio did not place the call')
  }

  outreach.lastCallSid = call.sid
  await outreach.save()
  console.log(`[VoiceOutbound] dialing ${outreach.toNumber} callSid=${call.sid} attempt=${outreach.attemptCount}`)
  return call
}

const claimAndDialDue = async () => {
  if (!env.VOICE_OUTBOUND_ENABLED) return
  await VoiceOutreach.updateMany(
    { status: 'dialing', updatedAt: { $lte: new Date(Date.now() - 3 * 60 * 1000) } },
    { $set: { status: 'scheduled', nextAttemptAt: new Date() } },
  )
  const due = await VoiceOutreach.find({
    status: 'scheduled',
    nextAttemptAt: { $lte: new Date() },
  })
    .sort({ nextAttemptAt: 1 })
    .limit(5)
    .select('_id')
    .lean()

  for (const item of due) {
    const claimed = await VoiceOutreach.findOneAndUpdate(
      { _id: item._id, status: 'scheduled' },
      { $set: { status: 'dialing' } },
      { new: true },
    )
    if (!claimed) continue
    claimed.status = 'scheduled'
    try {
      await dialOutreach(claimed)
    } catch (err) {
      console.error('[VoiceOutbound] dial failed:', err.message)
      claimed.attemptCount = Math.max(0, Number(claimed.attemptCount || 1) - 1)
      claimed.status = 'scheduled'
      claimed.lastResult = 'error'
      claimed.nextAttemptAt = new Date(Date.now() + 15 * 60 * 1000)
      await claimed.save()
    }
  }
}

const noteCallResult = async (body = {}) => {
  const callSid = body.CallSid
  if (!callSid) return
  const outreach = await VoiceOutreach.findOne({ lastCallSid: callSid })
  if (!outreach) return
  if (['completed', 'exhausted', 'opted-out'].includes(outreach.status) && outreach.reachedAt) return

  const twilioStatus = String(body.CallStatus || '').toLowerCase()
  const duration = parseInt(body.CallDuration || body.Duration || '0', 10) || 0

  if (['no-answer', 'busy', 'failed', 'canceled', 'cancelled'].includes(twilioStatus)) {
    await sendMissedText(outreach)
    await scheduleRetry(outreach, twilioStatus === 'cancelled' ? 'canceled' : twilioStatus)
    return
  }

  if (twilioStatus === 'completed') {
    if (duration >= 15 && !outreach.voicemailLeft) {
      outreach.status = 'completed'
      outreach.lastResult = 'reached'
      outreach.reachedAt = new Date()
      await outreach.save()
      console.log(`[VoiceOutbound] reached ${outreach.toNumber} callSid=${callSid} ${duration}s`)
      return
    }
    await sendMissedText(outreach)
    await scheduleRetry(outreach, outreach.voicemailLeft ? 'voicemail' : 'short')
  }
}

const markInProgress = async (callSid) => {
  if (!callSid) return
  await VoiceOutreach.updateOne(
    { lastCallSid: callSid, status: { $in: ['dialing', 'scheduled'] } },
    { $set: { status: 'in-progress', lastResult: 'answered' } },
  )
}

const handleAmd = async (body = {}) => {
  const answeredBy = String(body.AnsweredBy || '').toLowerCase()
  const callSid = body.CallSid
  if (!callSid) return
  const machine = answeredBy.startsWith('machine') || answeredBy === 'fax'
  if (!machine) return

  const outreach = await VoiceOutreach.findOne({ lastCallSid: callSid })
  const customer = outreach
    ? await Customer.findById(outreach.customerId).select('firstName')
    : null
  const sdk = getClient()
  if (sdk && env.VOICE_OUTBOUND_VOICEMAIL) {
    try {
      await sdk.calls(callSid).update({
        twiml: twiml.sayHangup({ message: voicemailMessage(customer) }),
      })
    } catch (err) {
      console.warn('[VoiceOutbound] voicemail update failed:', err.message)
    }
  }
  if (outreach) {
    outreach.voicemailLeft = true
    outreach.lastResult = 'voicemail'
    await outreach.save()
    console.log(`[VoiceOutbound] voicemail callSid=${callSid}`)
  }
}

const optOutNumber = async (from) => {
  const digits = digitsOnly(from)
  if (!digits) return
  const national = digits.length > 10 ? digits.slice(-10) : digits
  const customers = await Customer.find({
    $or: [{ 'phone.number': national }, { 'phone.number': digits }],
  }).select('_id')
  const ids = customers.map((c) => c._id)
  if (!ids.length) return
  await Customer.updateMany({ _id: { $in: ids } }, { $set: { voiceOptOut: true } })
  await VoiceOutreach.updateMany(
    { customerId: { $in: ids }, status: { $in: ['scheduled', 'dialing'] } },
    { $set: { status: 'opted-out', lastResult: 'stop' } },
  )
}

const placeOutboundNow = async (rawPhone) => {
  const digits = digitsOnly(rawPhone)
  const national = digits.startsWith('91') && digits.length > 10 ? digits.slice(2) : digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  const customer = await Customer.findOne({
    $or: [{ 'phone.number': national }, { 'phone.number': digits }, { 'phone.number': rawPhone }],
  })
  if (!customer) {
    throw new Error(`No customer found for ${rawPhone}`)
  }
  const lead = await Lead.findOne({ customerId: customer._id }).sort({ createdAt: -1 }).select('_id state')
  const toNumber = toE164(customer)
  const row = await VoiceOutreach.create({
    leadId: lead?._id || null,
    customerId: customer._id,
    toNumber,
    timezone: timezoneFor({ e164: toNumber, state: lead?.state }),
    status: 'scheduled',
    maxAttempts: maxAttempts(),
    nextAttemptAt: new Date(),
    source: 'manual',
  })
  return dialOutreach(row, { ignoreHours: true, detectMachine: false })
}

let timer = null
const startOutboundRunner = () => {
  if (timer) return
  timer = setInterval(() => {
    claimAndDialDue().catch((err) => console.error('[VoiceOutbound] tick:', err.message))
  }, 30 * 1000)
  if (typeof timer.unref === 'function') timer.unref()
  console.log('[VoiceOutbound] runner every 30s')
}

module.exports = {
  enqueueInquiryCallback,
  noteCallResult,
  markInProgress,
  handleAmd,
  optOutNumber,
  placeOutboundNow,
  startOutboundRunner,
  voicemailMessage,
  outboundGreeting,
  toE164,
}
