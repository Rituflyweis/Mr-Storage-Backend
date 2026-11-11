const asyncHandler = require('../../utils/asyncHandler')
const voiceCall = require('../../services/twilio/voiceCall.service')
const twiml = require('../../services/twilio/twiml.builder')

const sendTwiml = (res, xml) => {
  res.type('text/xml')
  return res.status(200).send(xml)
}

exports.inbound = asyncHandler(async (req, res) => {
  try {
    const xml = await voiceCall.handleInbound(req.body, req)
    return sendTwiml(res, xml)
  } catch (err) {
    console.error('[VoiceCall] inbound error:', err.message)
    return sendTwiml(
      res,
      twiml.sayHangup({
        message: 'We hit a temporary issue starting this call. Please try again in a moment. Goodbye.',
      }),
    )
  }
})

exports.gather = asyncHandler(async (req, res) => {
  try {
    // Always 200 + TwiML so Twilio does not play generic "application error"
    const xml = await voiceCall.handleGather(req.body, req.query, req)
    return sendTwiml(res, xml)
  } catch (err) {
    console.error('[VoiceCall] gather error:', err.message, err.stack)
    const sessionId = req.query?.sessionId
    const base = (require('../../config/env').TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '')
    const action = sessionId
      ? `${base || ''}/api/twilio/voice/gather?sessionId=${encodeURIComponent(String(sessionId))}`
      : `${base || ''}/api/twilio/voice/inbound`
    return sendTwiml(
      res,
      twiml.sayGather({
        message: "Sorry, I had a brief glitch. Could you please repeat that?",
        gatherActionUrl: action.startsWith('http') ? action : `/api/twilio/voice/gather?sessionId=${sessionId || ''}`,
      }),
    )
  }
})

exports.status = asyncHandler(async (req, res) => {
  await voiceCall.handleStatus(req.body)
  return res.status(200).send('OK')
})

exports.fallback = asyncHandler(async (req, res) => {
  console.error('[VoiceCall] fallback hit', {
    callSid: req.body?.CallSid,
    errorCode: req.body?.ErrorCode,
    errorUrl: req.body?.ErrorUrl,
  })
  const xml = voiceCall.handleFallback()
  return sendTwiml(res, xml)
})
