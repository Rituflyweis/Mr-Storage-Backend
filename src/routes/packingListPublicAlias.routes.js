/** Legacy / FE shorthand URLs: GET /api/packing-lists/:id and GET /api/packing-list/:id (no JWT). */
const router = require('express').Router()
const { param } = require('express-validator')
const validate = require('../middleware/validate')
const ctrl = require('../controllers/plant/packingList.controller')

router.get(
  '/:packingListId',
  [param('packingListId').isMongoId()],
  validate,
  ctrl.getPackingListPublic,
)

module.exports = router
