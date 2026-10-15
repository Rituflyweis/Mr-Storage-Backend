/** Shared budget vs actual helpers (admin + account). */

const crypto = require('crypto')

const BUDGET_PART_FIELDS = [
  'materialBudget',
  'logisticBudget',
  'productionBudget',
  'shipperBudget',
  'otherCost',
]

const COST_HEAD_CATEGORY_MAP = [
  {
    head: 'Material Cost',
    categories: ['Vendor/Freight', 'materials', 'Materials', 'Material'],
    budgetField: 'materialBudget',
  },
  {
    head: 'Carrier/Freight Cost',
    categories: ['Freight', 'Logistics', 'transport', 'Transport', 'Carrier'],
    budgetField: 'logisticBudget',
  },
  {
    head: 'Manpower/Labor Cost',
    categories: ['Salaries', 'Operations', 'labour', 'Labor', 'Manpower'],
    budgetField: 'productionBudget',
  },
  {
    head: 'Equipment Cost',
    categories: ['Equipment', 'equipment'],
    budgetField: null,
  },
  {
    head: 'Subcontractor Cost',
    categories: ['Subcontractor', 'subcontractor'],
    budgetField: 'shipperBudget',
  },
  {
    head: 'Miscellaneous Cost',
    categories: [
      'Miscellaneous',
      'Marketing',
      'other',
      'office',
      'utilities',
      'permits',
      'maintenance',
      'Misc',
    ],
    budgetField: 'otherCost',
  },
]

const normCategory = (value) => String(value || '').trim().toLowerCase()

const categoryInRow = (expenseCategory, row) => {
  const e = normCategory(expenseCategory)
  return row.categories.some((c) => normCategory(c) === e)
}

const normalizeCustomLines = (lines) => {
  if (!Array.isArray(lines)) return []
  const out = []
  const seen = new Set()
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue
    const label = String(raw.label || '').trim()
    if (!label) continue
    let key = String(raw.key || '').trim()
    if (!key) key = `custom_${crypto.randomBytes(4).toString('hex')}`
    if (seen.has(key)) continue
    seen.add(key)
    const expenseCategories = Array.isArray(raw.expenseCategories)
      ? [...new Set(raw.expenseCategories.map((c) => String(c || '').trim()).filter(Boolean))]
      : []
    out.push({
      key,
      label,
      amount: Math.max(0, Number(raw.amount) || 0),
      expenseCategories,
    })
  }
  return out
}

const sumFixedBudgetParts = (budget) =>
  BUDGET_PART_FIELDS.reduce((sum, field) => sum + (Number(budget?.[field]) || 0), 0)

const sumCustomLineBudget = (budget) =>
  (budget?.customLines || []).reduce((sum, line) => sum + (Number(line.amount) || 0), 0)

/** Fixed + custom line budgets; falls back to stored totalBudget when sum is zero. */
const resolveTotalBudget = (budget) => {
  if (!budget) return 0
  const partsSum = sumFixedBudgetParts(budget) + sumCustomLineBudget(budget)
  if (partsSum > 0) return partsSum
  return Number(budget.totalBudget) || 0
}

const computeStoredTotalBudget = (budgetLike) => {
  const fixed = BUDGET_PART_FIELDS.reduce(
    (sum, field) => sum + (Number(budgetLike?.[field]) || 0),
    0
  )
  const custom = normalizeCustomLines(budgetLike?.customLines).reduce(
    (sum, line) => sum + line.amount,
    0
  )
  return fixed + custom
}

const customClaimedCategories = (budget) => {
  const claimed = new Set()
  for (const line of budget?.customLines || []) {
    for (const c of line.expenseCategories || []) {
      claimed.add(normCategory(c))
    }
  }
  return claimed
}

const actualForCustomLine = (line, expenseByCategory) => {
  const cats = (line.expenseCategories || []).map(normCategory).filter(Boolean)
  if (!cats.length) return 0
  return expenseByCategory
    .filter((c) => cats.includes(normCategory(c._id)))
    .reduce((sum, c) => sum + (c.total || 0), 0)
}

const budgetVarianceStatus = (actual, budgetTotal) => {
  if (!budgetTotal || budgetTotal <= 0) {
    return actual > 0 ? 'Over Budget' : 'No Budget Set'
  }
  if (actual > budgetTotal) return 'Over Budget'
  if (actual < budgetTotal) return 'Under Budget'
  return 'On Budget'
}

const sumExpenseCategories = (expenseByCategory) =>
  expenseByCategory.reduce((sum, row) => sum + (row.total || 0), 0)

const buildCustomBudgetRows = (budget, expenseByCategory) => {
  const lines = budget?.customLines || []
  return lines.map((line) => {
    const rowBudget = Number(line.amount) || 0
    const actual = actualForCustomLine(line, expenseByCategory)
    return {
      head: line.label,
      key: line.key,
      isCustom: true,
      budget: rowBudget,
      actual,
      variance: actual - rowBudget,
      variancePct: rowBudget > 0 ? +((((actual - rowBudget) / rowBudget) * 100).toFixed(2)) : 0,
      status: budgetVarianceStatus(actual, rowBudget),
      expenseCategories: line.expenseCategories || [],
    }
  })
}

const buildCostHeadRows = (expenseByCategory, budget) => {
  const claimedByCustom = customClaimedCategories(budget)
  const matchedCategories = new Set(
    COST_HEAD_CATEGORY_MAP.flatMap((row) => row.categories.map(normCategory))
  )
  for (const c of claimedByCustom) matchedCategories.add(c)

  const fixedRows = COST_HEAD_CATEGORY_MAP.map((row) => {
    let actual = expenseByCategory
      .filter((c) => categoryInRow(c._id, row))
      .reduce((sum, c) => sum + c.total, 0)

    if (row.head === 'Miscellaneous Cost') {
      actual += expenseByCategory
        .filter((c) => {
          const id = normCategory(c._id)
          if (claimedByCustom.has(id)) return false
          return !matchedCategories.has(id)
        })
        .reduce((sum, c) => sum + c.total, 0)
    } else {
      actual = expenseByCategory
        .filter((c) => {
          const id = normCategory(c._id)
          if (claimedByCustom.has(id)) return false
          return categoryInRow(c._id, row)
        })
        .reduce((sum, c) => sum + c.total, 0)
    }

    const rowBudget = row.budgetField ? Number(budget?.[row.budgetField]) || 0 : 0

    return {
      head: row.head,
      isCustom: false,
      budget: rowBudget,
      actual,
      variance: actual - rowBudget,
      variancePct: rowBudget > 0 ? +((((actual - rowBudget) / rowBudget) * 100).toFixed(2)) : 0,
      status: budgetVarianceStatus(actual, rowBudget),
    }
  })

  return [...fixedRows, ...buildCustomBudgetRows(budget, expenseByCategory)]
}

/** Profitability table rows for custom budget lines (expected from budget; actual from expense categories). */
const buildCustomProfitabilityRows = (budget, expenseByCategory) => {
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
  return (budget?.customLines || []).map((line) => {
    const expected = Number(line.amount) || 0
    const actual = actualForCustomLine(line, expenseByCategory)
    return {
      key: `custom:${line.key}`,
      label: line.label,
      isCustom: true,
      expected: round2(expected),
      actual: round2(actual),
      variance: round2(actual - expected),
    }
  })
}

module.exports = {
  BUDGET_PART_FIELDS,
  COST_HEAD_CATEGORY_MAP,
  normalizeCustomLines,
  sumFixedBudgetParts,
  sumCustomLineBudget,
  computeStoredTotalBudget,
  resolveTotalBudget,
  budgetVarianceStatus,
  sumExpenseCategories,
  buildCostHeadRows,
  buildCustomBudgetRows,
  buildCustomProfitabilityRows,
}
