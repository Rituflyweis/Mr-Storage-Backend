const router = require('express').Router()
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')

router.use(verifyToken, roleGuard(['plant']))

router.use('/dashboard',         require('./dashboard.routes'))
router.use('/projects',          require('./project.routes'))
router.use('/bom',               require('./bom.routes'))
router.use('/shipper-files',     require('./shipper.routes'))
router.use('/shipper-requests',  require('./shipper.routes'))
router.use('/vendors',           require('./vendor.routes'))
router.use('/carriers',          require('./carrier.routes'))
router.use('/bundle-plans',      require('./bundlePlan.routes'))
router.use('/bundles',           require('./bundle.routes'))
router.use('/packing-list-plans', require('./packingListPlan.routes'))
router.use('/packing-lists',     require('./packingList.routes'))
router.use('/deliveries',        require('./delivery.routes'))
router.use('/freight-bids',      require('./freightBid.routes'))

module.exports = router
