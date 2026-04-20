const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/lead.controller')
const validate = require('../../middleware/validate')

// Stats and special routes BEFORE /:leadId to avoid param conflicts
router.get('/stats', ctrl.getLeadStats)
router.get('/scoring/today', ctrl.getScoringToday)
router.post('/import', ctrl.importLeads)

router.get('/', ctrl.getAllLeads)
router.post('/',
  [
    body('customerId').notEmpty(),
    body('buildingType').optional().trim(),
    body('location').optional().trim(),
  ],
  validate,
  ctrl.createLead
)

router.get('/:leadId/detail', ctrl.getLeadDetail)
router.get('/:leadId/timeline', ctrl.getLeadTimeline)
router.put('/:leadId', ctrl.editLead)
router.put('/:leadId/assign',
  [body('employeeId').notEmpty()],
  validate,
  ctrl.assignLead
)

module.exports = router
