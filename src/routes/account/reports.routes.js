const router = require('express').Router()
const { param, body } = require('express-validator')
const ctrl = require('../../controllers/account/reports.controller')
const validate = require('../../middleware/validate')

/** Mongo lead id or display job id (e.g. PRO-2025-1047) — resolved in service via resolveLeadByProjectRef */
const leadIdParam = param('leadId').notEmpty().trim()
const transactionIdParam = param('transactionId').isMongoId()

router.get('/profit-loss', ctrl.getProfitLoss)
router.get('/cash-flow', ctrl.getCashFlow)
router.get('/project-wise-expense', ctrl.getProjectWiseExpense)
router.get('/project-wise-income', ctrl.getProjectWiseIncome)

router.get(
  '/project-wise-income/:leadId/transactions/:transactionId',
  [leadIdParam, transactionIdParam],
  validate,
  ctrl.getProjectWiseIncomeTransaction
)
router.post(
  '/project-wise-income/:leadId/received',
  [
    leadIdParam,
    body('amount').isNumeric().withMessage('amount is required'),
    body('date').optional().isISO8601(),
    body('description').optional().isString().trim(),
    body('invoiceNumber').optional().isString().trim(),
    body('incomeType')
      .optional()
      .isIn(['milestone', 'advance', 'variation', 'claims', 'other']),
    body('status').optional().isIn(['received', 'paid', 'pending']),
  ],
  validate,
  ctrl.createProjectReceivedIncome
)
router.get('/project-wise-income/:leadId', leadIdParam, validate, ctrl.getProjectWiseIncomeDetail)

router.get(
  '/project-wise-expense/:leadId/transactions/:source/:id',
  [
    leadIdParam,
    param('source').isIn(['manual', 'shipper', 'freight', 'approval']),
    param('id').isMongoId(),
  ],
  validate,
  (req, res, next) => {
    req.params.recordId = `${req.params.source}:${req.params.id}`
    next()
  },
  ctrl.getProjectWiseExpenseRecord
)
router.get('/project-wise-expense/:leadId', leadIdParam, validate, ctrl.getProjectWiseExpenseDetail)

module.exports = router
