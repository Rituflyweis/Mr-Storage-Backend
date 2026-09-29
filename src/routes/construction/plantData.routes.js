const router = require('express').Router()
const constructionPlantReadOnly = require('../../middleware/constructionPlantReadOnly')

router.use(constructionPlantReadOnly)

router.use('/deliveries', require('../plant/delivery.routes'))
router.use('/packing-lists', require('../plant/packingList.routes'))
router.use('/bundles', require('../plant/bundle.routes'))
router.use('/bundle-plans', require('../plant/bundlePlan.routes'))
router.use('/packing-list-plans', require('../plant/packingListPlan.routes'))

module.exports = router
