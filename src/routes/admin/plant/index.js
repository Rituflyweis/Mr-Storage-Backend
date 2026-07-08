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
router.use('/projects', require('./projectOps.routes'))
router.use('/vendors', require('./vendor.routes'))
router.use('/carriers', require('./carrier.routes'))
router.use('/smdt', require('./smdt.routes'))
router.use('/deliveries', require('./delivery.routes'))

module.exports = router
