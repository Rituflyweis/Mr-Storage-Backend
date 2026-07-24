const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/admin/construction.controller')
const validate = require('../../middleware/validate')

router.get('/overview',              ctrl.getOverview)
router.get('/projects-calendar',     ctrl.getProjectsCalendar)
router.post('/projects-calendar/deliveries', [body('leadId').isMongoId(), body('deliveryDate').notEmpty()], validate, ctrl.createCalendarDelivery)

router.get('/drawings',              ctrl.getDrawings)
router.get('/drawings/:docId',       [param('docId').isMongoId()], validate, ctrl.getDrawingDetail)
router.post('/drawings/:leadId',     [param('leadId').isMongoId(), body('name').notEmpty()], validate, ctrl.uploadDrawing)
router.put('/drawings/:docId/review', [param('docId').isMongoId()], validate, ctrl.approveDrawing)
router.post('/drawings/:docId/comments', [param('docId').isMongoId(), body('text').notEmpty()], validate, ctrl.addDrawingComment)

router.get('/deliveries',            ctrl.getConstructionDeliveries)
router.get('/deliveries/export',     ctrl.exportConstructionDeliveries)

router.get('/tasks',                 ctrl.getTasks)
router.post('/tasks',                [body('title').notEmpty(), body('leadId').isMongoId()], validate, ctrl.createTask)
router.put('/tasks/:taskId',         [param('taskId').isMongoId()], validate, ctrl.updateTask)
router.delete('/tasks/:taskId',      [param('taskId').isMongoId()], validate, ctrl.deleteTask)

router.get('/work-logs',             ctrl.getWorkLogs)
router.post('/work-logs',            [body('leadId').isMongoId(), body('date').notEmpty()], validate, ctrl.createWorkLog)

router.get('/material-requests',     ctrl.getMaterialRequests)
router.get('/material-requests/export', ctrl.exportMaterialRequests)
router.post('/material-requests',    [body('leadId').isMongoId(), body('requestedItems').isArray()], validate, ctrl.createMaterialRequest)
router.put('/material-requests/:requestId/review', [param('requestId').isMongoId(), body('action').isIn(['approved','rejected'])], validate, ctrl.reviewMaterialRequest)

router.get('/reports',               ctrl.getConstructionReports)
router.get('/reports/export',        ctrl.exportConstructionReport)

module.exports = router
