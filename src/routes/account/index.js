const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

const guard = [verifyToken, roleGuard(['admin', 'account'])]

router.use('/dashboard', ...guard, require('./dashboard.routes'))
router.use('/projects',  ...guard, require('./project.routes'))
router.use('/invoices',  ...guard, require('./invoice.routes'))
router.use('/expenses',  ...guard, require('./expense.routes'))
router.use('/tax',       ...guard, require('./tax.routes'))
router.use('/analytics', ...guard, require('./analytics.routes'))
router.use('/payments',  ...guard, require('./payments.routes'))
router.use('/reports',   ...guard, require('./reports.routes'))
router.use('/financial', ...guard, require('./financial.routes'))
router.use('/communication', ...guard, require('./communication.routes'))

module.exports = router
