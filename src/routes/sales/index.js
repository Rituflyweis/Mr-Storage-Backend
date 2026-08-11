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


router.get('/po-orders', leadCtrl.getMyPOOrders)
router.get('/quotations/stats', followupCtrl.getQuotationStats)
router.get('/quotations', followupCtrl.getMyQuotations)
router.post('/quotations', [require('express-validator').body('leadId').notEmpty()], require('../../middleware/validate'), quotationCtrl.createQuotation)
router.get('/quotations/:quotationId', quotationCtrl.getQuotation)
router.put('/quotations/:quotationId', quotationCtrl.updateQuotation)
router.delete('/quotations/:quotationId', quotationCtrl.deleteQuotation)
router.post('/quotations/:quotationId/send', quotationCtrl.sendQuotation)
router.get('/quotations/:quotationId/summary', quotationCtrl.getQuoteSummary)

module.exports = router
