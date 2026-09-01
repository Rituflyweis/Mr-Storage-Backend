const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/adminManagement.controller')
const validate = require('../../middleware/validate')

router.post('/set-main-self', ctrl.setCurrentAdminAsMain)
router.get('/', ctrl.listAdmins)
router.post(
  '/',
  [
    body('name').notEmpty().trim(),
    body('email').isEmail(),
    body('password').notEmpty().trim(),
    body('phone').optional().trim(),
    body('department').optional().trim(),
    body('permissions').optional().isObject(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  ctrl.createAdmin
)
router.put(
  '/:adminId',
  [
    body('name').optional().notEmpty().trim(),
    body('email').optional().isEmail(),
    body('phone').optional().trim(),
    body('department').optional().trim(),
    body('permissions').optional().isObject(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  ctrl.updateAdmin
)
router.patch('/:adminId/toggle-status', ctrl.toggleAdminStatus)
router.post('/:adminId/transfer-main', ctrl.transferMainAdmin)
router.delete('/:adminId', ctrl.deleteAdmin)

module.exports = router
