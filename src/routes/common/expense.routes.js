const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/common/expense.controller')
const validate = require('../../middleware/validate')

router.get('/', ctrl.listExpenses)

router.post('/',
  [
    body('amountCents').isInt({ min: 0 }),
    body('category').notEmpty(),
    body('incurredAt').isISO8601(),
  ],
  validate,
  ctrl.createExpense
)

router.get('/:id', ctrl.getExpense)

router.patch('/:id', ctrl.updateExpense)

router.delete('/:id', ctrl.deleteExpense)

module.exports = router
