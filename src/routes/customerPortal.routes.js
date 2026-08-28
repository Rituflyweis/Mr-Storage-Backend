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
router.get('/projects/:leadId/buildings',                          ctrl.getProjectBuildings)
router.get('/projects/:leadId/buildings/:buildingLabel',           ctrl.getBuildingDrawings)
router.post('/projects/:leadId/drawings/:docId/approve',           ctrl.approveDrawing)
router.post('/projects/:leadId/drawings/:docId/request-revision',  ctrl.requestDrawingRevision)
router.post('/projects/:leadId/drawings/:docId/comments',          [body('text').trim().notEmpty()], validate, ctrl.addDrawingComment)
router.get('/projects/:leadId/activity',                           ctrl.getProjectActivity)
router.get('/projects/:leadId/notes',                              ctrl.getProjectNotes)
router.get('/projects/:leadId/followups',                          ctrl.getProjectFollowUps)
router.get('/projects/:leadId/meetings',                           ctrl.getProjectMeetings)
router.get('/projects/:leadId/tracking',                           ctrl.getProjectTracking)
router.get('/projects/:leadId/orders',                             ctrl.getProjectOrders)
router.post('/projects/:leadId/orders',                            ctrl.createProjectOrder)
router.get('/projects/:leadId/orders/:orderId',                    ctrl.getProjectOrderDetail)
router.post('/projects/:leadId/orders/:orderId/cancel',            ctrl.cancelProjectOrder)
router.get('/projects/:leadId/order-quotations',                   ctrl.getProjectOrderQuotations)
router.get('/projects/:leadId',                                    ctrl.getProject)
router.post('/projects',
  [
    body('projectName').notEmpty().withMessage('projectName is required'),
    body('buildingType').notEmpty().withMessage('buildingType is required'),
    body('expectedStartDate').notEmpty().withMessage('expectedStartDate is required').isISO8601(),
    body('targetCompletionDate').notEmpty().withMessage('targetCompletionDate is required').isISO8601(),
    body('fullAddress').if(body('location').not().exists()).notEmpty().withMessage('fullAddress is required'),
    body('city').notEmpty().withMessage('city is required'),
    body('pincode').notEmpty().withMessage('pincode is required'),
    body('state').notEmpty().withMessage('state is required'),
    body('roofStyle').optional().isString(),
    body('sqft').optional().isString(),
    body('width').optional().isNumeric(),
    body('length').optional().isNumeric(),
    body('height').optional().isNumeric(),
    body('doors').optional().isNumeric(),
    body('windows').optional().isNumeric(),
    body('insulation').optional().isNumeric(),
    body('description').optional().isString(),
  ],
  validate,
  ctrl.createProject
)

// Drawings (cross-project landing page)
router.get('/drawings', ctrl.getAllProjectDrawings)

// Documents
router.get('/documents', ctrl.getDocuments)

// Payments
router.get('/payments/stats',          ctrl.getPaymentStats)
router.get('/payments/invoice-stats',  ctrl.getInvoiceStats)
router.get('/payments',                ctrl.getPayments)
router.get('/payments/invoices',       ctrl.getPaymentInvoices)
router.get('/payments/invoices/:invoiceId', ctrl.getPaymentInvoiceDetail)
router.post('/payments/invoices/:invoiceId/payment-proof', ctrl.submitPaymentProof)
router.get('/payments/tax-report',     ctrl.getTaxReport)

// Delivery Schedule (static routes before the smart :id dispatch route)
router.get('/deliveries',                                       ctrl.getDeliverySchedule)
router.get('/deliveries/summary',                               ctrl.getDeliveriesSummary)
router.get('/deliveries/:id',                                   ctrl.getDeliveryScheduleOrDetail)
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
router.post('/deliveries/:deliveryId/acknowledge-reschedule',   ctrl.acknowledgeDeliveryReschedule)
router.get('/deliveries/:deliveryId/documents',                 ctrl.getDeliveryDocuments)
router.post('/deliveries/:deliveryId/confirm-site-ready',       ctrl.confirmDeliverySiteReady)
router.post('/deliveries/:deliveryId/confirm-equipment',        ctrl.confirmDeliveryEquipment)

// Material Orders
router.get('/material-orders/summary', ctrl.getMaterialOrdersSummary)

// Order Quotations
router.get('/quotations/summary',                     ctrl.getQuotationsSummary)
router.get('/order-quotations/:quotationId',           ctrl.getOrderQuotationDetail)
router.post('/order-quotations/:quotationId/approve',  ctrl.approveOrderQuotation)
router.post('/order-quotations/:quotationId/reject',   ctrl.rejectOrderQuotation)

// Bundle Scan (QR)
router.post('/bundles/scan',                          ctrl.scanCustomerBundle)
router.get('/bundles/:bundleId',                      ctrl.getCustomerBundleDetail)
router.post('/bundles/:bundleId/report-issue',        ctrl.reportCustomerBundleIssue)
router.post('/bundles/:bundleId/contact-support',     ctrl.contactSupportForBundle)
router.get('/bundles/:bundleId/download',             ctrl.downloadBundleContents)
router.get('/bundles/:bundleId/download/packing-list', ctrl.downloadBundlePackingList)

// Communication / Chat
router.get('/chat/presence',                 ctrl.getChatPresence)
router.get('/chat/channels',                 ctrl.getChatChannels)
router.get('/chat/:channel/messages',        ctrl.getChatMessages)
router.post('/chat/:channel/messages',       ctrl.sendChatMessage)

// Notifications
router.get('/notifications',              ctrl.getCustomerNotifications)
router.get('/notifications/unread-count', ctrl.getCustomerUnreadNotificationCount)
router.put('/notifications/read-all',     ctrl.markAllCustomerNotificationsRead)
router.put('/notifications/:id/read',     ctrl.markCustomerNotificationRead)

module.exports = router
