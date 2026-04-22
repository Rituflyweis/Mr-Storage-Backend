const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/auth.controller')
const verifyToken = require('../middleware/auth')
const validate = require('../middleware/validate')

router.post('/login',
  [body('email').isEmail(), body('password').notEmpty()],
  validate, ctrl.login
)

router.post('/refresh',
  [body('refreshToken').notEmpty()],
  validate, ctrl.refresh
)

router.post('/logout', ctrl.logout)

router.put('/change-password',
  verifyToken,
  [body('currentPassword').notEmpty(), body('newPassword').isLength({ min: 6 })],
  validate, ctrl.changePassword
)

router.post('/forgot-password',
  [body('email').isEmail()],
  validate, ctrl.forgotPassword
)

router.post('/verify-otp',
  [body('email').isEmail(), body('otp').isLength({ min: 6, max: 6 }).isNumeric()],
  validate, ctrl.verifyOtp
)

router.post('/reset-password',
  [body('resetToken').notEmpty(), body('newPassword').isLength({ min: 6 })],
  validate, ctrl.resetPassword
)

module.exports = router
