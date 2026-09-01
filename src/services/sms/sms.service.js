const twilio = require('twilio')
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_PHONE } = require('../../config/env')

const isTwilioConfigured = () =>
  Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_PHONE)

let client = null
const getClient = () => {
  if (!isTwilioConfigured()) return null
  if (!client) client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  return client
}

const sendSms = async ({ to, body }) => {
  const payload = { to, body: String(body || '').trim() }
  const sdk = getClient()

  if (!sdk) {
    console.log(`[SMS stub] to=${payload.to} body="${payload.body}"`)
    return {
      sid: `stub_${Date.now()}`,
      to: payload.to,
      body: payload.body,
      status: 'queued',
      provider: 'stub',
    }
  }

  const msg = await sdk.messages.create({
    from: TWILIO_FROM_PHONE,
    to: payload.to,
    body: payload.body,
  })

  return {
    sid: msg.sid,
    to: msg.to,
    body: msg.body,
    status: msg.status,
    provider: 'twilio',
  }
}

module.exports = { sendSms, isTwilioConfigured }
