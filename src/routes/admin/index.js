const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

// All admin routes require authentication + admin role
router.use(verifyToken, roleGuard(['admin']))

router.use('/dashboard', require('./dashboard.routes'))
router.use('/plant', require('./plant/index'))
router.use('/customers', require('./customer.routes'))
router.use('/leads', require('./lead.routes'))
router.use('/employees', require('./employee.routes'))
router.use('/meetings', require('./meeting.routes'))
router.use('/followups', require('./followup.routes'))
router.use('/escalations', require('./escalation.routes'))
router.use('/po-orders', require('./po.routes'))
router.use('/financials', require('./financial.routes'))
router.use('/reports', require('./reports.routes'))
router.use('/activity', require('./pageActivity.routes'))
router.use('/products',      require('./product.routes'))
router.use('/roles',         require('./role.routes'))
router.use('/invoices',      require('./invoice.routes'))
router.use('/construction',  require('./construction.routes'))
router.use('/chat',          require('./chat.routes'))

module.exports = router
