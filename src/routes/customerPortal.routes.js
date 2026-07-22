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
router.get('/projects/:leadId/quotation',                          ctrl.getProjectQuotation)
router.post('/projects/:leadId/quotation/approve',                 ctrl.approveProjectQuotation)
router.post('/projects/:leadId/quotation/reject',                  ctrl.rejectProjectQuotation)
router.get('/projects/:leadId/payments/summary',                   ctrl.getProjectPaymentsSummary)
router.post('/projects/:leadId/cancel',                            ctrl.cancelProject)
router.get('/projects/:leadId/drawings',                           ctrl.getProjectDrawings)
router.post('/projects/:leadId/drawings/:docId/approve',           ctrl.approveDrawing)
router.post('/projects/:leadId/drawings/:docId/request-revision',  ctrl.requestDrawingRevision)
router.get('/projects/:leadId/activity',                           ctrl.getProjectActivity)
router.get('/projects/:leadId/notes',                              ctrl.getProjectNotes)
router.get('/projects/:leadId/followups',                          ctrl.getProjectFollowUps)
router.get('/projects/:leadId/meetings',                           ctrl.getProjectMeetings)
router.get('/projects/:leadId/orders',                             ctrl.getProjectOrders)
router.post('/projects/:leadId/orders',                            ctrl.createProjectOrder)
router.get('/projects/:leadId/orders/:orderId',                    ctrl.getProjectOrderDetail)
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
router.get('/payments/stats',          ctrl.getPaymentStats)
router.get('/payments/invoice-stats',  ctrl.getInvoiceStats)
router.get('/payments',                ctrl.getPayments)
router.get('/payments/invoices',       ctrl.getPaymentInvoices)
router.get('/payments/invoices/:invoiceId', ctrl.getPaymentInvoiceDetail)
router.get('/payments/tax-report',     ctrl.getTaxReport)

// Delivery Schedule
router.get('/deliveries',                                       ctrl.getDeliverySchedule)
router.get('/deliveries/:deliveryId',                           ctrl.getDeliveryDetail)
router.get('/deliveries/:deliveryId/calendar',                  ctrl.getDeliveryCalendar)
router.get('/deliveries/:deliveryId/calendar/details',          ctrl.getDeliveryCalendarDetails)
router.get('/deliveries/:deliveryId/download',                  ctrl.downloadDeliveryInfo)
router.get('/deliveries/:deliveryId/download/packing-list',     ctrl.downloadDeliveryPackingList)
router.get('/deliveries/:deliveryId/download/instructions',     ctrl.downloadDeliveryInstructions)
router.post('/deliveries/:deliveryId/contact-driver',           ctrl.contactDeliveryDriver)
router.post('/deliveries/:deliveryId/contact-driver/sms',       ctrl.sendDeliveryDriverSms)
router.post('/deliveries/:deliveryId/contact-company',          ctrl.contactDeliveryCompany)
router.post('/deliveries/:deliveryId/contact-company/sms',      ctrl.sendDeliveryCompanySms)
router.post('/deliveries/:deliveryId/confirmation-email',       ctrl.sendDeliveryConfirmation)
router.post('/deliveries/:deliveryId/request-callback',         ctrl.requestDeliveryCallback)
router.get('/deliveries/:deliveryId/documents',                 ctrl.getDeliveryDocuments)
router.post('/deliveries/:deliveryId/confirm-site-ready',       ctrl.confirmDeliverySiteReady)
router.post('/deliveries/:deliveryId/confirm-equipment',        ctrl.confirmDeliveryEquipment)

// Material Orders
router.get('/material-orders/summary', ctrl.getMaterialOrdersSummary)

// Order Quotations
router.get('/quotations/summary', ctrl.getQuotationsSummary)

// Communication / Chat
router.get('/chat/channels',                 ctrl.getChatChannels)
router.get('/chat/:channel/messages',        ctrl.getChatMessages)
router.post('/chat/:channel/messages',       ctrl.sendChatMessage)

// Notifications
router.get('/notifications',              ctrl.getCustomerNotifications)
router.put('/notifications/read-all',     ctrl.markAllCustomerNotificationsRead)
router.put('/notifications/:id/read',     ctrl.markCustomerNotificationRead)

module.exports = router
