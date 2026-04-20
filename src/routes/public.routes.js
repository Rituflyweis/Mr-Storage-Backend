const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/public.controller')
const validate = require('../middleware/validate')
const rateLimit = require('express-rate-limit')

const chatInitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many requests, please try again later' },
})

router.post('/chat/init',
  chatInitLimiter,
  [
    body('firstName').notEmpty().trim(),
    body('email').isEmail().normalizeEmail(),
    body('phone').notEmpty().trim(),
    body('countryCode').notEmpty().trim(),
  ],
  validate,
  ctrl.chatInit
)

router.get('/chat/history/:leadId', ctrl.getChatHistory)

module.exports = router
