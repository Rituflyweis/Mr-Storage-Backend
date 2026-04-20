const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../controllers/customerAuth.controller')
const validate = require('../middleware/validate')

router.post('/login',
  [body('email').isEmail(), body('password').notEmpty()],
  validate,
  ctrl.login
)

router.post('/refresh',
  [body('refreshToken').notEmpty()],
  validate,
  ctrl.refresh
)

router.post('/logout', ctrl.logout)

module.exports = router
