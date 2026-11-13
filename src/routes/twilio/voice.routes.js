const router = require('express').Router()
const rateLimit = require('express-rate-limit')
const validateTwilioSignature = require('../../middleware/twilioSignature')
const ctrl = require('../../controllers/twilio/voice.controller')

const voiceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Too many requests.</Say><Hangup/></Response>',
})

router.use(voiceLimiter)
router.use(validateTwilioSignature)

router.post('/inbound', ctrl.inbound)
router.post('/outbound', ctrl.outbound)
router.post('/amd', ctrl.amd)
router.post('/gather', ctrl.gather)
router.post('/status', ctrl.status)
router.post('/fallback', ctrl.fallback)

module.exports = router
