const router = require('express').Router()
const ctrl = require('../../controllers/common/pricingRules.controller')

router.get('/', ctrl.getPricingRules)
router.put('/', ctrl.updatePricingRules)

module.exports = router
