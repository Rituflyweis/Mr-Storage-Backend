const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

const guard = [verifyToken, roleGuard(['admin', 'account'])]

router.use('/expenses', ...guard, require('./expense.routes'))

module.exports = router
