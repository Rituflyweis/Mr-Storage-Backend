const router = require('express').Router()
const validateTwilioSignature = require('../../middleware/twilioSignature')
const { optOutNumber } = require('../../services/twilio/outboundCall.service')

router.use(validateTwilioSignature)

router.post('/inbound', async (req, res) => {
  const body = String(req.body?.Body || '').trim().toUpperCase()
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(body)) {
    await optOutNumber(req.body.From).catch((err) => {
      console.warn('[VoiceOutbound] stop failed:', err.message)
    })
  }
  res.type('text/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
})

module.exports = router
