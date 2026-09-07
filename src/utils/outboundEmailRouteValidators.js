const { body } = require('express-validator')

const optionalEmailList = (field) =>
  body(field)
    .optional({ checkFalsy: true })
    .custom((value) => {
      if (Array.isArray(value) || typeof value === 'string') return true
      throw new Error(`${field} must be a string or array of emails`)
    })

const outboundSendBodyValidators = [
  body('toEmail').optional({ checkFalsy: true }).isEmail().withMessage('Invalid To email'),
  body('to').optional({ checkFalsy: true }).isEmail().withMessage('Invalid To email'),
  optionalEmailList('cc'),
  optionalEmailList('ccEmail'),
  optionalEmailList('ccEmails'),
  body('message').optional().isString(),
  body('note').optional().isString(),
  body('emailMessage').optional().isString(),
  body('coverNote').optional().isString(),
]

const markSentBodyValidators = [
  body('note').optional().isString(),
  body('message').optional().isString(),
  body('sentAt').optional().isISO8601().withMessage('sentAt must be a valid ISO 8601 date'),
]

module.exports = {
  outboundSendBodyValidators,
  markSentBodyValidators,
}
