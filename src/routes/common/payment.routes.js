const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/payment.controller')
const validate = require('../../middleware/validate')

router.post('/',
  [
    body('leadId').notEmpty(),
    body('stages').isArray({ min: 1 }),
    body('totalAmount').optional().isNumeric(),
  ],
  validate,
  ctrl.createSchedule
)

router.put('/lead/:leadId',
  [
    body('stages').isArray({ min: 1 }),
    body('totalAmount').optional().custom((v) => v == null || v === '' || !Number.isNaN(Number(v))),
    body('stages.*.stageName').notEmpty(),
    body('stages.*.amount').isNumeric(),
    body('stages.*.amountType').isIn(['percentage', 'fixed']),
    body('stages.*.dueDate').optional().isISO8601(),
    body('stages.*._id').optional().isMongoId(),
  ],
  validate,
  ctrl.updateScheduleByLead
)

router.get('/lead/:leadId', ctrl.getScheduleByLead)

module.exports = router
