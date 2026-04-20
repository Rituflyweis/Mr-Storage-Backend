const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/followup.controller')
const validate = require('../../middleware/validate')

router.get('/stats', ctrl.getStats)
router.get('/upcoming', ctrl.getUpcoming)
router.get('/kpi', ctrl.getKpi)
router.get('/ai-script', ctrl.getAiScript)

router.post('/',
  [
    body('leadId').notEmpty(),
    body('customerId').notEmpty(),
    body('assignedTo').notEmpty(),
    body('followUpDate').isISO8601(),
  ],
  validate,
  ctrl.createFollowUp
)

router.put('/:followUpId/complete', ctrl.completeFollowUp)

module.exports = router
