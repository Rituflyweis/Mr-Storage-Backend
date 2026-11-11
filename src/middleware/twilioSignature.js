const twilio = require('twilio')
const env = require('../config/env')

/**
 * Validate X-Twilio-Signature for form-urlencoded webhooks.
 * Skip when TWILIO_VALIDATE_SIGNATURE is false (local/dev).
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
  const url = base
    ? `${base}${req.originalUrl}`
    : `${req.protocol}://${req.get('host')}${req.originalUrl}`

  const valid = twilio.validateRequest(authToken, signature, url, req.body || {})
  if (!valid) {
    return res.status(403).type('text/xml').send(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Unauthorized.</Say><Hangup/></Response>',
    )
  }

  return next()
}

module.exports = validateTwilioSignature
