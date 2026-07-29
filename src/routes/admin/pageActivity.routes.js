const router = require('express').Router()
const { query } = require('express-validator')
const validate = require('../../middleware/validate')
const { USER_ROLES } = require('../../config/constants')
const ctrl = require('../../controllers/admin/pageActivity.controller')

router.get(
  '/page-visits',
  [
    query('role').optional().isIn(USER_ROLES),
    query('isActive').optional().isIn(['true', 'false']),
    query('search').optional().isString(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  ctrl.getUsersPageActivity
)

module.exports = router
