const router = require('express').Router()
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/payables.controller')
const { body } = require('express-validator')
const {
  commentValidators,
  accountListQuery,
  mongoId,
} = require('../../validators/payables.validators')

router.get('/filters', ctrl.payableFilterMeta)
router.get('/', accountListQuery, validate, ctrl.listAccountPayables)
router.get('/:invoiceId', mongoId, validate, ctrl.getPayableDetail)
router.put('/:invoiceId/mark-paid', [mongoId, body('paymentMethod').optional().isString()], validate, ctrl.markPayablePaid)
router.put('/:invoiceId/mark-unpaid', mongoId, validate, ctrl.markPayableUnpaid)
router.post('/:invoiceId/comments', commentValidators, validate, ctrl.addAccountPayableComment)

module.exports = router
