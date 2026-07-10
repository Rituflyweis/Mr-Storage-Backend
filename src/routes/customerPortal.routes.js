const router = require('express').Router()
const { body } = require('express-validator')
const verifyCustomerToken = require('../middleware/customerAuth')
const ctrl = require('../controllers/customerPortal.controller')
const validate = require('../middleware/validate')

router.use(verifyCustomerToken)

// Upload
router.post('/upload/presigned-url',
  [body('fileName').notEmpty(), body('fileType').notEmpty()],
  validate,
  ctrl.getPresignedUrl
)

// Profile
router.get('/profile',  ctrl.getProfile)
router.put('/profile',  ctrl.updateProfile)

// Dashboard
router.get('/dashboard', ctrl.getDashboard)

// Projects
router.get('/projects',                       ctrl.getProjects)
router.get('/projects/:leadId/stats',                              ctrl.getProjectStats)
router.get('/projects/:leadId/rfq',                                ctrl.getProjectRFQ)
router.put('/projects/:leadId/rfq',                                ctrl.updateProjectRFQ)
router.post('/projects/:leadId/cancel',                            ctrl.cancelProject)
router.get('/projects/:leadId/drawings',                           ctrl.getProjectDrawings)
router.post('/projects/:leadId/drawings/:docId/approve',           ctrl.approveDrawing)
router.post('/projects/:leadId/drawings/:docId/request-revision',  ctrl.requestDrawingRevision)
router.get('/projects/:leadId/activity',                           ctrl.getProjectActivity)
router.get('/projects/:leadId/notes',                              ctrl.getProjectNotes)
router.get('/projects/:leadId/followups',                          ctrl.getProjectFollowUps)
router.get('/projects/:leadId/meetings',                           ctrl.getProjectMeetings)
router.get('/projects/:leadId',                                    ctrl.getProject)
router.post('/projects',
  [
    body('buildingType').notEmpty().withMessage('buildingType is required'),
    body('location').notEmpty().withMessage('location is required'),
    body('roofStyle').optional().isString(),
    body('sqft').optional().isString(),
    body('width').optional().isNumeric(),
    body('length').optional().isNumeric(),
    body('description').optional().isString(),
  ],
  validate,
  ctrl.createProject
)

// Documents
router.get('/documents', ctrl.getDocuments)

// Payments
router.get('/payments/stats',      ctrl.getPaymentStats)
router.get('/payments',            ctrl.getPayments)
router.get('/payments/invoices',   ctrl.getPaymentInvoices)
router.get('/payments/tax-report', ctrl.getTaxReport)

// Delivery Schedule
router.get('/deliveries', ctrl.getDeliverySchedule)

module.exports = router
