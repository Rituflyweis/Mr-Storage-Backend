const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/sales/lead.controller')
const validate = require('../../middleware/validate')

router.get('/', ctrl.getLeads)
router.get('/:leadId/detail', ctrl.getLeadDetail)

router.put('/:leadId/lifecycle',
  [body('lifecycleStatus').notEmpty()],
  validate,
  ctrl.updateLifecycle
)

router.post('/:leadId/escalate',
  [body('note').notEmpty().trim()],
  validate,
  ctrl.escalateLead
)

router.post('/:leadId/po-order',
  [
    body('poNumber').notEmpty().trim(),
    body('invoiceId').notEmpty(),
    body('quotationId').notEmpty(),
  ],
  validate,
  ctrl.raisePOOrder
)

module.exports = router
