const router = require('express').Router()
const { body } = require('express-validator')
const ctrl = require('../../controllers/account/expense.controller')
const validate = require('../../middleware/validate')
const { EXPENSE_CATEGORIES } = require('../../models/Expense')

router.get('/stats', ctrl.getStats)

router.get('/', ctrl.listExpenses)

router.post('/',
  [
    body('expenseId').notEmpty().withMessage('expenseId is required'),
    body('category').isIn(EXPENSE_CATEGORIES).withMessage('Invalid category'),
    body('date').isISO8601().withMessage('date must be a valid ISO date'),
    body('amount').isNumeric().withMessage('amount is required'),
  ],
  validate,
  ctrl.createExpense
)

router.put('/:expenseId/deactivate', ctrl.deactivateExpense)

router.get('/project/:leadId', ctrl.getProjectExpenses)

module.exports = router
