const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/plant/freightBid.controller')
const validate = require('../../middleware/validate')

router.post('/:bidId/select',
  [param('bidId').isMongoId()],
  validate,
  ctrl.selectFreightBid
)

router.post('/:bidId/request-resubmit',
  [
    param('bidId').isMongoId(),
    body('note').trim().notEmpty().withMessage('note is required'),
    body('bidAmount').optional().isFloat({ min: 0 }).withMessage('bidAmount must be a non-negative number'),
    body('requestedBidAmount').optional().isFloat({ min: 0 }).withMessage('requestedBidAmount must be a non-negative number'),
  ],
  validate,
  ctrl.requestFreightBidResubmit
)

module.exports = router
