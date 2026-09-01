const Expense = require('../models/Expense')
const { allocateSequentialId } = require('./allocateSequentialId')

const generateExpenseId = async () =>
  allocateSequentialId({
    model: Expense,
    field: 'expenseId',
    parsePattern: /^EXP(\d+)$/i,
    format: (n) => `EXP${String(n).padStart(5, '0')}`,
  })

module.exports = generateExpenseId
