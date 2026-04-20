const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/quotation.controller')
const validate = require('../../middleware/validate')

router.post('/',
  [body('leadId').notEmpty(), body('customerId').notEmpty()],
  validate,
  ctrl.createQuotation
)

router.get('/:quotationId', ctrl.getQuotation)
router.put('/:quotationId', ctrl.updateQuotation)
router.post('/:quotationId/send', ctrl.sendQuotation)
router.get('/:quotationId/summary', ctrl.getQuoteSummary)

module.exports = router
