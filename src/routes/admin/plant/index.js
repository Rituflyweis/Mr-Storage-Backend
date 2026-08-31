const router = require('express').Router()
const adminPlantScope = require('../../../middleware/adminPlantScope')

router.use(adminPlantScope)

router.use('/dashboard', require('./dashboard.routes'))
router.use('/bom', require('./bom.routes'))
router.use('/shipper-files', require('./shipper.routes'))
router.use('/shipper-requests', require('./shipper.routes'))
router.use('/load-planning', require('./loadPlanning.routes'))
router.use('/bundle-plans', require('./bundlePlan.routes'))
router.use('/packing-lists', require('./packingList.routes'))
router.use('/packing-list-plans', require('./packingListPlan.routes'))
// Reuses the plant panel's own project routes wholesale (not just the projectOps subset) so
// admin's Plant > Projects section has the exact same flow as the plant panel itself — list,
// stats, detail, and lifecycle updates were previously only reachable from the plant role,
// even though getScopedLeadIds already returns every project (unscoped) for admin.
router.use('/projects', require('../../plant/project.routes'))
router.use('/vendors', require('./vendor.routes'))
router.use('/carriers', require('./carrier.routes'))
router.use('/freight-bids', require('./freightBid.routes'))
router.use('/bundles', require('../../plant/bundle.routes'))
router.use('/smdt', require('./smdt.routes'))
router.use('/deliveries', require('./delivery.routes'))
router.use('/', require('./extras.routes'))

module.exports = router
