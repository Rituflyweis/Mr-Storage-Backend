const router = require('express').Router()
const { param } = require('express-validator')
const ctrl = require('../../controllers/account/project.controller')
const sub = require('../../controllers/account/projectSubpages.controller')
const validate = require('../../middleware/validate')
const { businessUnitQueryValidator } = require('../../utils/businessUnit')

const projectIdParam = [param('projectId').notEmpty().trim()]

router.get('/', [businessUnitQueryValidator()], validate, ctrl.getProjects)

router.get('/:projectId', projectIdParam, validate, ctrl.getProjectDetail)

router.get('/:projectId/invoices/summary', projectIdParam, validate, sub.getInvoicesSummary)
router.get('/:projectId/invoices/records', projectIdParam, validate, sub.listInvoices)

router.get('/:projectId/payments/summary', projectIdParam, validate, sub.getPaymentsSummary)
router.get('/:projectId/payments/records', projectIdParam, validate, sub.listPayments)

router.get('/:projectId/delivery', projectIdParam, validate, sub.getFinalDelivery)
router.get('/:projectId/deliveries', projectIdParam, validate, sub.listDeliveries)
router.get(
  '/:projectId/deliveries/:deliveryId',
  [param('projectId').notEmpty().trim(), param('deliveryId').isMongoId()],
  validate,
  sub.getDeliveryDetail
)

router.get('/:projectId/quotations', projectIdParam, validate, sub.listQuotations)
router.get(
  '/:projectId/quotations/:quotationId',
  [param('projectId').notEmpty().trim(), param('quotationId').isMongoId()],
  validate,
  sub.getQuotationDetail
)
router.get(
  '/:projectId/quotations/:quotationId/pdf',
  [param('projectId').notEmpty().trim(), param('quotationId').isMongoId()],
  validate,
  sub.downloadQuotationPdf
)

router.get('/:projectId/bom/consolidated', projectIdParam, validate, sub.getConsolidatedBom)
router.get('/:projectId/bom', projectIdParam, validate, sub.getBom)
router.get('/:projectId/agreement', projectIdParam, validate, sub.getAgreement)

module.exports = router
