const router = require('express').Router()
const { body } = require('express-validator')
const verifyCustomerToken = require('../middleware/customerAuth')
const ctrl = require('../controllers/customerPortal.controller')
const validate = require('../middleware/validate')

router.use(verifyCustomerToken)

// Profile
router.get('/profile',  ctrl.getProfile)
router.put('/profile',  ctrl.updateProfile)

// Dashboard
router.get('/dashboard', ctrl.getDashboard)

// Projects
router.get('/projects',          ctrl.getProjects)
router.get('/projects/:leadId',  ctrl.getProject)
router.post('/projects',
  [body('buildingType').notEmpty(), body('location').notEmpty()],
  validate,
  ctrl.createProject
)

// Documents
router.get('/documents', ctrl.getDocuments)

// Payments
router.get('/payments',          ctrl.getPayments)
router.get('/payments/invoices', ctrl.getPaymentInvoices)

module.exports = router
