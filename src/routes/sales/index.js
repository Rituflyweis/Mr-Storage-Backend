const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

router.use(verifyToken, roleGuard(['sales']))

router.use('/dashboard', require('./dashboard.routes'))
router.use('/leads', require('./lead.routes'))
router.use('/followups', require('./followup.routes'))
router.use('/customers', require('./customer.routes'))
router.use('/meetings', require('./meeting.routes'))
router.use('/estimates', require('./estimateQuote.routes'))
router.use('/pricing-rules', require('../common/pricingRules.routes'))

const leadCtrl = require('../../controllers/sales/lead.controller')
const followupCtrl = require('../../controllers/sales/followup.controller')
const quotationCtrl = require('../../controllers/common/quotation.controller')
const validate = require('../../middleware/validate')
const { body } = require('express-validator')
const {
  outboundSendBodyValidators,
  markSentBodyValidators,
} = require('../../utils/outboundEmailRouteValidators')


router.get('/po-orders', leadCtrl.getMyPOOrders)
router.get('/quotations/stats', followupCtrl.getQuotationStats)
router.get('/quotations', followupCtrl.getMyQuotations)
router.post('/quotations', [body('leadId').notEmpty()], validate, quotationCtrl.createQuotation)
router.get('/quotations/:quotationId', quotationCtrl.getQuotation)
router.put('/quotations/:quotationId', quotationCtrl.updateQuotation)
router.delete('/quotations/:quotationId', quotationCtrl.deleteQuotation)
router.post(
  '/quotations/:quotationId/send',
  [
    ...outboundSendBodyValidators,
    body('sections').optional().isArray(),
  ],
  validate,
  quotationCtrl.sendQuotation
)
router.post(
  '/quotations/:quotationId/mark-sent',
  markSentBodyValidators,
  validate,
  quotationCtrl.markQuotationSent
)
router.get('/quotations/:quotationId/summary', quotationCtrl.getQuoteSummary)

module.exports = router
