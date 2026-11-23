const router = require('express').Router({ mergeParams: true })
const { body } = require('express-validator')
const validate = require('../../middleware/validate')
const ctrl = require('../../controllers/common/contractSigning.controller')

router.get('/contract', ctrl.getContract)

router.post('/contract/send',
  [
    body('signerEmail').optional({ values: 'falsy' }).isEmail().withMessage('signerEmail must be a valid email'),
    body('signerName').optional().trim(),
    body('message').optional().isString(),
    body('companySigner.email').optional({ values: 'falsy' }).isEmail(),
    body('companySigner.name').optional().trim(),
  ],
  validate,
  ctrl.sendContract
)

router.post('/contract/remind', ctrl.remindContract)
router.post('/contract/void', ctrl.voidContract)
router.post('/contract/resend',
  [
    body('signerEmail').optional({ values: 'falsy' }).isEmail().withMessage('signerEmail must be a valid email'),
    body('signerName').optional().trim(),
    body('message').optional().isString(),
  ],
  validate,
  ctrl.resendContract
)

module.exports = router
