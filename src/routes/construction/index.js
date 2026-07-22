const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

router.use(verifyToken, roleGuard(['construction', 'admin']))

const dashCtrl = require('../../controllers/construction/dashboard.controller')
const projectCtrl = require('../../controllers/construction/project.controller')
const drawingCtrl = require('../../controllers/construction/drawing.controller')
const taskCtrl = require('../../controllers/construction/task.controller')
const deliveryCtrl = require('../../controllers/construction/delivery.controller')
const bundleCtrl = require('../../controllers/construction/bundle.controller')
const materialRequestCtrl = require('../../controllers/construction/materialRequest.controller')

// Dashboard
router.get('/dashboard', dashCtrl.getDashboard)

// Projects & Calendar (static routes before param routes)
router.get('/projects', projectCtrl.getProjects)
router.get('/projects/calendar', projectCtrl.getProjectCalendar)
router.get('/projects/:leadId/progress', taskCtrl.getProjectProgress)
router.post('/projects/:leadId/milestones', taskCtrl.createMilestone)
router.get('/projects/:leadId', projectCtrl.getProjectDetail)

// Drawings & Attachments
router.get('/drawings', drawingCtrl.getDrawings)
router.get('/drawings/:leadId', drawingCtrl.getProjectDrawings)
router.post('/drawings/:leadId', drawingCtrl.uploadDrawing)

// Tasks
router.get('/tasks/stats', taskCtrl.getTaskStats)
router.get('/tasks', taskCtrl.getTasks)
router.post('/tasks', taskCtrl.createTask)
router.put('/tasks/:taskId', taskCtrl.updateTask)
router.delete('/tasks/:taskId', taskCtrl.deleteTask)

// Milestones
router.put('/milestones/:milestoneId', taskCtrl.updateMilestone)

// Work Log
router.get('/work-logs', taskCtrl.getWorkLogs)
router.post('/work-logs', taskCtrl.createWorkLog)

// Material Requests
router.get('/material-requests', materialRequestCtrl.getMaterialRequests)
router.post('/material-requests', materialRequestCtrl.createMaterialRequest)
router.get('/material-requests/:requestId', materialRequestCtrl.getMaterialRequest)
router.put('/material-requests/:requestId/status', materialRequestCtrl.updateMaterialRequestStatus)
router.post('/material-requests/:requestId/quotations', materialRequestCtrl.createOrderQuotation)
router.post('/material-requests/:requestId/items/:itemId/deliver', materialRequestCtrl.markOrderItemDelivered)

// Delivery Tracking (static routes before param routes)
router.post('/deliveries/scan-bundle', deliveryCtrl.scanBundle)
router.get('/deliveries', deliveryCtrl.getDeliveries)
router.get('/deliveries/:deliveryId', deliveryCtrl.getDelivery)
router.post('/deliveries/:deliveryId/mark-received', deliveryCtrl.markReceived)
router.post('/deliveries/:deliveryId/mark-partial', deliveryCtrl.markPartialReceived)
router.put('/deliveries/:deliveryId/site-contact', deliveryCtrl.updateSiteContact)
router.get('/deliveries/:deliveryId/download/packing-list', deliveryCtrl.downloadDeliveryPackingList)
router.get('/deliveries/:deliveryId/download/bill-of-lading', deliveryCtrl.downloadDeliveryBillOfLading)

// Label Printing
router.get('/labels', bundleCtrl.getBundleLabels)
router.post('/labels/print', bundleCtrl.printBundleLabels)

// Bundle Scan
router.get('/bundle-scan', bundleCtrl.getBundleScanHistory)
router.post('/bundle-scan/scan', deliveryCtrl.scanBundle)

// Bundles (detail & actions)
router.get('/bundles/:bundleId', bundleCtrl.getBundleDetail)
router.post('/bundles/:bundleId/verify', bundleCtrl.verifyBundle)
router.post('/bundles/:bundleId/mark-staged', bundleCtrl.markBundleStaged)
router.post('/bundles/:bundleId/mark-loaded', bundleCtrl.markBundleLoaded)
router.post('/bundles/:bundleId/report-mismatch', bundleCtrl.reportBundleMismatch)
router.post('/bundles/:bundleId/reprint-label', bundleCtrl.reprintBundleLabel)

// Packing Lists (static routes before param routes)
router.get('/packing-lists', bundleCtrl.getPackingLists)
router.get('/packing-lists/export', bundleCtrl.exportPackingListsExcel)
router.get('/packing-lists/:packingListId', bundleCtrl.getPackingListDetail)
router.get('/packing-lists/:packingListId/download-pdf', bundleCtrl.downloadPackingListPdf)
router.post('/packing-lists/:packingListId/mark-ready', bundleCtrl.markPackingListReady)
router.post('/packing-lists/:packingListId/mark-loading', bundleCtrl.markPackingListLoading)
router.post('/packing-lists/:packingListId/mark-dispatch', bundleCtrl.markPackingListDispatch)

// Dispatch Verification
router.get('/dispatch-verification', bundleCtrl.getDispatchVerification)
router.get('/dispatch-verification/:loadId', bundleCtrl.getDispatchVerificationDetail)
router.post('/dispatch-verification/:loadId/verify-load', bundleCtrl.verifyLoad)
router.post('/dispatch-verification/:loadId/confirm-dispatch', bundleCtrl.confirmDispatch)

module.exports = router
