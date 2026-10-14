const router = require('express').Router()
const { param } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/plant/materialRequest.controller')

router.get('/filters', ctrl.getMaterialRequestFilters)
router.get('/', ctrl.listMaterialRequests)
router.get('/:requestId', [param('requestId').isMongoId()], validate, ctrl.getMaterialRequestDetail)

module.exports = router
