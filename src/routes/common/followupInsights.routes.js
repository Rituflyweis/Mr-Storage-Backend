const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/followupInsights.controller')

router.get(
  '/activity',
  [
    query('kind').optional().isIn(ctrl.VALID_KINDS),
    query('view').optional().isIn(ctrl.VALID_VIEWS),
    query('leadId').optional().isMongoId(),
    query('status').optional().isIn(ctrl.VALID_STATUS),
    query('modeOfContact').optional().isIn(ctrl.VALID_MODES),
    query('transitionState').optional().isIn(ctrl.VALID_TRANSITION_STATES),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getFollowUpActivity
)

router.get(
  '/temperature-transition-summary',
  [query('startDate').optional().isISO8601(), query('endDate').optional().isISO8601()],
  validate,
  ctrl.getTemperatureTransitionSummary
)

router.get(
  '/temperature-transitions',
  [
    query('from').optional().isIn(ctrl.VALID_TEMPERATURES),
    query('to').optional().isIn(ctrl.VALID_TEMPERATURES),
    query('source').optional().isIn(ctrl.VALID_TRANSITION_SOURCES),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  ctrl.getTemperatureTransitions
)

module.exports = router
