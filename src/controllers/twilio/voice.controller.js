const asyncHandler = require('../../utils/asyncHandler')
const voiceCall = require('../../services/twilio/voiceCall.service')

const sendTwiml = (res, xml) => {
  res.type('text/xml')
  return res.status(200).send(xml)
}

exports.inbound = asyncHandler(async (req, res) => {
  const xml = await voiceCall.handleInbound(req.body)
  return sendTwiml(res, xml)
})

exports.gather = asyncHandler(async (req, res) => {
  const xml = await voiceCall.handleGather(req.body, req.query)
  return sendTwiml(res, xml)
})

exports.status = asyncHandler(async (req, res) => {
  await voiceCall.handleStatus(req.body)
  return res.status(200).send('OK')
})

exports.fallback = asyncHandler(async (req, res) => {
  const xml = voiceCall.handleFallback()
  return sendTwiml(res, xml)
})
