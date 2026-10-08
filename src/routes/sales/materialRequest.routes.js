const router = require('express').Router()
const { body, param } = require('express-validator')
const panelCtrl = require('../../controllers/common/materialRequestPanel.controller')
const constructionCtrl = require('../../controllers/admin/construction.controller')
const validate = require('../../middleware/validate')

router.get('/filters', panelCtrl.getMaterialRequestFilters)
router.get('/', panelCtrl.listMaterialRequests)
router.get('/:requestId', [param('requestId').isMongoId()], validate, panelCtrl.getMaterialRequestDetail)
router.put(
  '/:requestId/review',
  [
    param('requestId').isMongoId(),
    body('action').isIn(['approved', 'rejected']),
    body('reviewNotes').optional().isString(),
  ],
  validate,
  constructionCtrl.reviewMaterialRequest
)

module.exports = router
