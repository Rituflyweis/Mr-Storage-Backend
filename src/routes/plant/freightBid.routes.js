const router = require('express').Router()
const { param } = require('express-validator')
const ctrl = require('../../controllers/plant/freightBid.controller')
const validate = require('../../middleware/validate')

router.post('/:bidId/select',
  [param('bidId').isMongoId()],
  validate,
  ctrl.selectFreightBid
)

module.exports = router
