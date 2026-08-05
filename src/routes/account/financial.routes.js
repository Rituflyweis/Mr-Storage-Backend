const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/account/financial.controller')
const validate = require('../../middleware/validate')

// Delivery Finance (dashboard card)
router.get('/delivery-finance', ctrl.getDeliveryFinance)

// Freight Costs Overview
router.get('/freight-costs', ctrl.getFreightCostsOverview)

// Logistics Costs
router.get('/logistics-costs', ctrl.getLogisticsCosts)

// Cost Variance Analysis
router.get('/cost-variance', ctrl.getCostVarianceAnalysis)

// Awarded Freight Loads
router.get('/awarded-loads', ctrl.getAwardedFreightLoads)

// Project-level Financial Summary
router.get('/project-summary', ctrl.getProjectFinancialSummary)

// Payment Approvals
router.get('/payment-approvals', ctrl.getPaymentApprovals)
router.put('/payment-approvals/:approvalId/review',
  [body('action').isIn(['under_review', 'approved', 'disputed', 'rejected'])],
  validate,
  ctrl.reviewPaymentApproval
)

// Payment Status Dashboard
router.get('/payment-status', ctrl.getPaymentStatusDashboard)

// Invoice Management sub-tabs
router.get('/invoices/vendor',           ctrl.getVendorInvoices)
router.get('/invoices/carrier',          ctrl.getCarrierInvoices)
router.get('/invoices/delivery-company', ctrl.getDeliveryCompanyInvoices)

// Analytics -> Reporting
router.get('/reporting', ctrl.getAnalyticsReporting)

// Master Data
router.get('/master-data/vendors',            ctrl.getMasterDataVendors)
router.get('/master-data/carriers',           ctrl.getMasterDataCarriers)
router.get('/master-data/delivery-companies', ctrl.getMasterDataDeliveryCompanies)

module.exports = router
