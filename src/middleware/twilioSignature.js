const twilio = require('twilio')
const env = require('../config/env')

/**
 * Validate X-Twilio-Signature for form-urlencoded webhooks.
 * Skip when TWILIO_VALIDATE_SIGNATURE is false (local/dev).
 * Tries several public URL shapes (Render proxy + WEBHOOK_BASE_URL).
 */
const validateTwilioSignature = (req, res, next) => {
  const shouldValidate =
    String(env.TWILIO_VALIDATE_SIGNATURE || '').toLowerCase() === 'true' ||
    (env.NODE_ENV === 'production' && env.TWILIO_VALIDATE_SIGNATURE !== 'false')

  if (!shouldValidate) return next()

  const authToken = env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    return res.status(500).type('text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Configuration error.</Say><Hangup/></Response>',
    )
  }

  const signature = req.headers['x-twilio-signature']
  if (!signature) {
    return res.status(403).type('text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Unauthorized.</Say><Hangup/></Response>',
    )
  }

  const base = (env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '')
  const host = req.get('host') || ''
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()
  const originalUrl = req.originalUrl || req.url || ''

  const candidates = [
    base ? `${base}${originalUrl}` : null,
    `${proto}://${host}${originalUrl}`,
    `https://${host}${originalUrl}`,
    `http://${host}${originalUrl}`,
  ].filter(Boolean)

  const params = req.body || {}
  const valid = candidates.some((url) => twilio.validateRequest(authToken, signature, url, params))

  if (!valid) {
    console.warn('[TwilioSignature] validation failed for urls:', candidates.join(' | '))
    return res.status(403).type('text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Unauthorized.</Say><Hangup/></Response>',
    )
  }

  return next()
}

module.exports = validateTwilioSignature
