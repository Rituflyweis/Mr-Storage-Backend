const router = require('express').Router()
const ctrl = require('../../controllers/sales/construction.controller')
const validate = require('../../middleware/validate')
const { businessUnitQueryValidator } = require('../../utils/businessUnit')
const { param, query } = require('express-validator')

const businessUnitQuery = [businessUnitQueryValidator(), validate]

const taskListQuery = [
  query('status').optional().isIn(['todo', 'in_progress', 'done']),
  query('priority').optional().isIn(['low', 'medium', 'high']),
  query('assignedTo').optional().isMongoId(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validate,
]

router.get('/projects/calendar', businessUnitQuery, ctrl.getProjectCalendar)
router.get('/projects', businessUnitQuery, ctrl.getProjects)
router.get(
  '/projects/:leadId/delivery',
  [param('leadId').isMongoId()],
  validate,
  ctrl.getProjectFinalDelivery
)
router.get(
  '/projects/:leadId/deliveries/:deliveryId',
  [param('leadId').isMongoId(), param('deliveryId').isMongoId()],
  validate,
  ctrl.getProjectDeliveryDetail
)
router.get(
  '/projects/:leadId/construction-tasks',
  [param('leadId').isMongoId(), ...taskListQuery],
  ctrl.getProjectConstructionTasks
)
router.get('/tasks', [query('leadId').notEmpty().isMongoId(), ...taskListQuery], ctrl.getConstructionTasks)
router.get('/tasks/:taskId', [param('taskId').isMongoId()], validate, ctrl.getConstructionTaskById)

module.exports = router
