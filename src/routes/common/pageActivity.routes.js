const router = require('express').Router()
const { body, query } = require('express-validator')
const verifyToken = require('../../middleware/auth')
const roleGuard = require('../../middleware/roleGuard')
const validate = require('../../middleware/validate')
const { USER_ROLES } = require('../../config/constants')
const ctrl = require('../../controllers/common/pageActivity.controller')

const staffGuard = [verifyToken, roleGuard(USER_ROLES)]

router.post(
  '/page-visit',
  ...staffGuard,
  [
    body('panel').isIn(USER_ROLES).withMessage(`panel must be one of: ${USER_ROLES.join(', ')}`),
    body('page').trim().notEmpty().isLength({ max: 500 }).withMessage('page is required (max 500 chars)'),
  ],
  validate,
  ctrl.logPageVisit
)

router.get('/me', ...staffGuard, ctrl.getMyPageActivity)

module.exports = router
