const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

// All admin routes require authentication + admin role
router.use(verifyToken, roleGuard(['admin']))

router.use('/dashboard', require('./dashboard.routes'))
router.use('/customers', require('./customer.routes'))
router.use('/leads', require('./lead.routes'))
router.use('/employees', require('./employee.routes'))
router.use('/meetings', require('./meeting.routes'))
router.use('/followups', require('./followup.routes'))
router.use('/escalations', require('./escalation.routes'))
router.use('/po-orders', require('./po.routes'))

module.exports = router
