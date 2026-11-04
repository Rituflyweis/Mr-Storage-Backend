/**
 * Canonical expense category names aligned with project budget presets.
 * Aliases stay in COST_HEAD_CATEGORY_MAP for legacy Expense.category values.
 */
const BUDGET_PRESET_EXPENSE_CATEGORIES = [
  {
    presetKey: 'material',
    canonicalName: 'Material',
    amountField: 'materialBudget',
  },
  {
    presetKey: 'logistic',
    canonicalName: 'Logistics',
    amountField: 'logisticBudget',
  },
  {
    presetKey: 'production',
    canonicalName: 'Manpower',
    amountField: 'productionBudget',
  },
  {
    presetKey: 'shipper',
    canonicalName: 'Subcontractor',
    amountField: 'shipperBudget',
  },
  {
    presetKey: 'other',
    canonicalName: 'Miscellaneous',
    amountField: 'otherCost',
  },
]

const PRESET_KEY_TO_CANONICAL = Object.fromEntries(
  BUDGET_PRESET_EXPENSE_CATEGORIES.map((p) => [p.presetKey, p.canonicalName])
)

const DEFAULT_PRESET_CATEGORY_NAMES = BUDGET_PRESET_EXPENSE_CATEGORIES.map(
  (p) => p.canonicalName
)

module.exports = {
  BUDGET_PRESET_EXPENSE_CATEGORIES,
  PRESET_KEY_TO_CANONICAL,
  DEFAULT_PRESET_CATEGORY_NAMES,
}
