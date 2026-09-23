const { body, param } = require('express-validator')
const {
  parseFlexibleDate,
  buildRescheduleReasonText,
  normalizeRescheduleRequestBody,
  addHoursToTimeString,
} = require('../utils/deliveryReschedule.util')

const normalizeRescheduleBody = (req, _res, next) => {
  req.body = normalizeRescheduleRequestBody(req.body || {})
  next()
}

const rescheduleDeliveryValidators = [
  normalizeRescheduleBody,
  param('deliveryId').isMongoId(),
  body('date')
    .notEmpty()
    .withMessage('date is required')
    .custom((value) => {
      if (!parseFlexibleDate(value)) throw new Error('Valid date is required')
      return true
    }),
  body('timeWindowStart')
    .trim()
    .notEmpty()
    .withMessage('timeWindowStart is required'),
  body('timeWindowEnd')
    .optional({ values: 'null' })
    .isString()
    .trim(),
  body('rescheduleReason').optional().isString().trim(),
  body('reason').optional().isString().trim(),
  body('additionalNotes').optional().isString().trim(),
  body('notes').optional().isString().trim(),
  body('otherReason').optional().isString().trim(),
  body().custom((_value, { req }) => {
    const start = String(req.body.timeWindowStart || '').trim()
    if (!start) throw new Error('timeWindowStart is required')

    let end = String(req.body.timeWindowEnd || '').trim()
    if (!end && start) {
      req.body.timeWindowEnd = addHoursToTimeString(start, 2)
      end = req.body.timeWindowEnd
    }
    if (!end) throw new Error('timeWindowEnd is required')

    const reasonCheck = buildRescheduleReasonText(req.body)
    if (reasonCheck.error) throw new Error(reasonCheck.error)
    return true
  }),
]

module.exports = {
  normalizeRescheduleBody,
  rescheduleDeliveryValidators,
}
