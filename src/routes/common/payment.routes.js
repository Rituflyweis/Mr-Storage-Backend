const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/payment.controller')
const validate = require('../../middleware/validate')

router.post('/',
  [
    body('leadId').notEmpty(),
    body('stages').isArray({ min: 1 }),
    body('totalAmount').isNumeric(),
  ],
  validate,
  ctrl.createSchedule
)

router.get('/lead/:leadId', ctrl.getScheduleByLead)

module.exports = router
