const router = require('express').Router()
const { body, param } = require('express-validator')
const ctrl = require('../../controllers/admin/role.controller')
const validate = require('../../middleware/validate')

router.get('/modules', ctrl.getPermissionModules)
router.get('/', ctrl.listRoles)
router.post('/',
  [body('name').notEmpty().trim()],
  validate,
  ctrl.createRole
)
router.get('/:roleId', [param('roleId').isMongoId()], validate, ctrl.getRole)
router.put('/:roleId', [param('roleId').isMongoId()], validate, ctrl.updateRole)
router.delete('/:roleId', [param('roleId').isMongoId()], validate, ctrl.deleteRole)

module.exports = router
