const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/payment.controller')
const validate = require('../../middleware/validate')

router.post('/',
  [
    body('customerId').notEmpty(),
    body('leadId').notEmpty(),
    body('invoiceId').notEmpty(),
    body('payments').isArray({ min: 1 }),
    body('totalAmount').isNumeric(),
  ],
  validate,
  ctrl.createSchedule
)

router.get('/invoice/:invoiceId', ctrl.getSchedule)
router.put('/:scheduleId/payments/:paymentId', ctrl.markPaymentPaid)

module.exports = router
