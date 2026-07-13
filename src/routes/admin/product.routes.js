const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/admin/product.controller')
const validate = require('../../middleware/validate')

const productValidators = [
  body('name').notEmpty().trim(),
  body('category').notEmpty(),
  body('baseCost').optional().isNumeric(),
  body('defaultMargin').optional().isNumeric(),
  body('sellingPrice').optional().isNumeric(),
]

router.get('/categories', ctrl.getCategories)
router.get('/export',     ctrl.exportProducts)
router.get('/',           ctrl.listProducts)
router.post('/', productValidators, validate, ctrl.createProduct)
router.get('/:productId',    ctrl.getProduct)
router.put('/:productId',    ctrl.updateProduct)
router.delete('/:productId', ctrl.deleteProduct)

module.exports = router
