const router = require('express').Router()
const { param } = require('express-validator')
const ctrl = require('../../controllers/account/project.controller')
const sub = require('../../controllers/account/projectSubpages.controller')
const validate = require('../../middleware/validate')

const projectIdParam = [param('projectId').notEmpty().trim()]
const deliveryIdParam = [param('deliveryId').notEmpty().trim()]
const quotationIdParam = [param('quotationId').notEmpty().trim()]

router.get('/', ctrl.getProjects)

// Nested project sub-pages (must stay before/alongside /:projectId — multi-segment paths)
router.get(
  '/:projectId/invoices/summary',
  projectIdParam,
  validate,
  sub.getInvoicesSummary
)
router.get('/:projectId/invoices/records', projectIdParam, validate, sub.listInvoices)

router.get(
  '/:projectId/payments/summary',
  projectIdParam,
  validate,
  sub.getPaymentsSummary
)
router.get('/:projectId/payments/records', projectIdParam, validate, sub.listPayments)

router.get('/:projectId/deliveries', projectIdParam, validate, sub.listDeliveries)
router.get('/:projectId/delivery', projectIdParam, validate, sub.getFinalDelivery)
router.get(
  '/:projectId/deliveries/:deliveryId',
  [...projectIdParam, ...deliveryIdParam],
  validate,
  sub.getDeliveryDetail
)

router.get('/:projectId/quotations', projectIdParam, validate, sub.listQuotations)
router.get(
  '/:projectId/quotations/:quotationId/pdf',
  [...projectIdParam, ...quotationIdParam],
  validate,
  sub.downloadQuotationPdf
)
router.get(
  '/:projectId/quotations/:quotationId',
  [...projectIdParam, ...quotationIdParam],
  validate,
  sub.getQuotationDetail
)

router.get('/:projectId/bom/consolidated', projectIdParam, validate, sub.getConsolidatedBom)
router.get('/:projectId/bom', projectIdParam, validate, sub.getBom)

router.get('/:projectId/agreement', projectIdParam, validate, sub.getAgreement)

router.get('/:projectId', projectIdParam, validate, ctrl.getProjectDetail)

module.exports = router
