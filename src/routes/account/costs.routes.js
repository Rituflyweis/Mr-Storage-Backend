const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/account/costs.controller')
const validate = require('../../middleware/validate')

const mongoId = param('id').isMongoId()

router.get('/filters', ctrl.getFilters)

router.get('/salary/summary', ctrl.getSalarySummary)
router.get('/salary/records', ctrl.listSalaryRecords)
router.post('/salary/records', [body('date').isISO8601(), body('amount').optional().isNumeric(), body('netSalary').optional().isNumeric()], validate, ctrl.createSalaryEntry)
router.patch('/salary/records/:id/mark-paid', mongoId, validate, ctrl.markSalaryPaid)
router.delete('/salary/records/:id', mongoId, validate, ctrl.deleteSalaryEntry)
router.post('/salary/records/:id/generate-payslip', mongoId, validate, ctrl.generateSalaryPayslip)
router.get('/salary/records/:id/payslip', mongoId, validate, ctrl.downloadSalaryPayslip)

// Frontend aliases (no `/records` segment)
router.patch('/salary/:id/mark-paid', mongoId, validate, ctrl.markSalaryPaid)
router.delete('/salary/:id', mongoId, validate, ctrl.deleteSalaryEntry)
router.post('/salary/:id/generate-payslip', mongoId, validate, ctrl.generateSalaryPayslip)
router.get('/salary/:id/payslip', mongoId, validate, ctrl.downloadSalaryPayslip)

router.get('/manpower/summary', ctrl.getManpowerSummary)
router.get('/manpower/records', ctrl.listManpowerRecords)
router.post(
  '/manpower/records',
  [body('date').isISO8601(), body('leadId').optional().isMongoId()],
  validate,
  ctrl.createManpowerEntry
)
router.put('/manpower/records/:id', mongoId, validate, ctrl.updateManpowerEntry)
router.delete('/manpower/records/:id', mongoId, validate, ctrl.deleteManpowerEntry)

router.get('/miscellaneous/summary', ctrl.getMiscellaneousSummary)
router.get('/miscellaneous/overview-chart', ctrl.getMiscellaneousOverviewChart)
router.get('/miscellaneous/by-category', ctrl.getMiscellaneousByCategory)
router.get('/miscellaneous/by-project', ctrl.listMiscellaneousByProject)
router.get('/miscellaneous/records', ctrl.listMiscellaneousRecords)
router.post(
  '/miscellaneous/records',
  [body('amount').isNumeric(), body('date').optional().isISO8601()],
  validate,
  ctrl.createMiscellaneousEntry
)

router.get('/freight/summary', ctrl.getFreightSummary)
router.get('/freight/trend', ctrl.getFreightTrend)
router.get('/freight/carrier-distribution', ctrl.getFreightCarrierDistribution)
router.get('/freight/records', ctrl.listFreightRecords)

router.get('/logistics/summary', ctrl.getLogisticsSummary)
router.get('/logistics/records', ctrl.listLogisticsRecords)
router.get('/logistics/delivery-lookup/:deliveryRef', ctrl.lookupDelivery)
router.post(
  '/logistics/records',
  [body('deliveryId').isMongoId(), body('finalAmount').optional().isNumeric(), body('amount').optional().isNumeric()],
  validate,
  ctrl.createLogisticsCost
)

router.get('/variance/summary', ctrl.getVarianceSummary)
router.get('/variance/alerts', ctrl.getVarianceAlerts)
router.get('/variance/trend', ctrl.getVarianceTrend)
router.get('/variance/details', ctrl.listVarianceDetails)

router.get('/rent/summary', ctrl.getRentSummary)
router.get('/rent/records', ctrl.listRentRecords)
router.post('/rent/records', [body('amount').isNumeric(), body('date').isISO8601()], validate, ctrl.createRentEntry)

router.get('/future/summary', ctrl.getFutureSummary)
router.get('/future/records', ctrl.listFutureRecords)
router.post(
  '/future/records',
  [body('amount').isNumeric(), body('date').isISO8601(), body('flowType').optional().isIn(['income', 'expense'])],
  validate,
  ctrl.createFutureEntry
)

router.get('/item-list/categories', ctrl.getItemCostCategories)
router.get('/item-list/summary', ctrl.getItemCostSummary)
router.get('/item-list/stats', ctrl.getItemCostStats)
router.get('/item-list/export', ctrl.exportItemCostList)
router.get('/item-list/records', ctrl.getItemCostList)
router.get('/item-list/records/:itemId', [param('itemId').isMongoId()], validate, ctrl.getItemCostById)
router.post(
  '/item-list/records',
  [
    body('category').notEmpty(),
    body('partName').notEmpty(),
    body('costUnit').notEmpty(),
    body('mbsCost').isNumeric(),
  ],
  validate,
  ctrl.createItemCost
)
router.put('/item-list/records/:itemId', [param('itemId').isMongoId()], validate, ctrl.updateItemCost)

module.exports = router
