const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

// All sales routes require authentication + sales role
router.use(verifyToken, roleGuard(['sales']))

router.use('/dashboard', require('./dashboard.routes'))
router.use('/leads', require('./lead.routes'))
router.use('/followups', require('./followup.routes'))

// Projects (closed leads) + PO orders inline
const leadCtrl = require('../../controllers/sales/lead.controller')
router.get('/projects', leadCtrl.getProjects)
router.get('/po-orders', leadCtrl.getMyPOOrders)

module.exports = router
