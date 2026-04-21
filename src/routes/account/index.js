const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

const guard = [verifyToken, roleGuard(['admin', 'account'])]

router.use('/dashboard', ...guard, require('./dashboard.routes'))
router.use('/projects',  ...guard, require('./project.routes'))
router.use('/invoices',  ...guard, require('./invoice.routes'))
router.use('/expenses',  ...guard, require('./expense.routes'))
router.use('/tax',       ...guard, require('./tax.routes'))

module.exports = router
