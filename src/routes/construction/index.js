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

// Delivery Tracking (static routes before param routes)
router.post('/deliveries/scan-bundle', deliveryCtrl.scanBundle)
router.get('/deliveries', deliveryCtrl.getDeliveries)
router.get('/deliveries/:deliveryId', deliveryCtrl.getDelivery)
router.post('/deliveries/:deliveryId/mark-received', deliveryCtrl.markReceived)
router.post('/deliveries/:deliveryId/mark-partial', deliveryCtrl.markPartialReceived)

// Label Printing
router.get('/labels', bundleCtrl.getBundleLabels)

// Bundle Scan
router.get('/bundle-scan', bundleCtrl.getBundleScanHistory)

// Packing Lists
router.get('/packing-lists', bundleCtrl.getPackingLists)

// Dispatch Verification
router.get('/dispatch-verification', bundleCtrl.getDispatchVerification)

module.exports = router
