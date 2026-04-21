const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/customerAuth.controller')
const verifyCustomerToken = require('../middleware/customerAuth')
const validate = require('../middleware/validate')

router.post('/login',
  [body('email').isEmail().withMessage('Email and password are required'), body('password').notEmpty()],
  validate,
  ctrl.login
)

router.post('/refresh',
  [body('refreshToken').notEmpty()],
  validate,
  ctrl.refresh
)

router.put('/change-password',
  verifyCustomerToken,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 6 })],
  validate,
  ctrl.changePassword
)

module.exports = router
