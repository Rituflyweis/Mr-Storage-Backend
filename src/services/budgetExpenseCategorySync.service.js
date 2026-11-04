const ExpenseCategory = require('../models/ExpenseCategory')
const { DEFAULT_PRESET_CATEGORY_NAMES } = require('../config/budgetExpenseCategoryRegistry')

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Ensure a global ExpenseCategory exists; returns exact stored name for Expense.category / budget links.
 */
const ensureExpenseCategory = async (name, createdBy = null) => {
  const trimmed = String(name || '').trim()
  if (!trimmed) return null

  const existing = await ExpenseCategory.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') },
  }).lean()

  if (existing) return existing.name

  const doc = await ExpenseCategory.create({
    name: trimmed,
    createdBy: createdBy || null,
    isActive: true,
  })
  return doc.name
}

const ensureDefaultPresetExpenseCategories = async (createdBy = null) => {
  const names = []
  for (const name of DEFAULT_PRESET_CATEGORY_NAMES) {
    names.push(await ensureExpenseCategory(name, createdBy))
  }
  return names
}

/**
 * Link custom budget lines to expense categories: default expenseCategories from label when empty.
 */
const syncCustomBudgetLinesWithCategories = async (lines, createdBy = null) => {
  if (!Array.isArray(lines) || !lines.length) return lines || []

  const out = []
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue
    const label = String(line.label || '').trim()
    if (!label) continue

    let cats = Array.isArray(line.expenseCategories)
      ? line.expenseCategories.map((c) => String(c || '').trim()).filter(Boolean)
      : []

    if (!cats.length) {
      const fromLabel = await ensureExpenseCategory(label, createdBy)
      if (fromLabel) cats = [fromLabel]
    } else {
      const ensured = []
      for (const c of cats) {
        const stored = await ensureExpenseCategory(c, createdBy)
        if (stored) ensured.push(stored)
      }
      cats = [...new Set(ensured)]
    }

    out.push({
      key: line.key,
      label,
      amount: Math.max(0, Number(line.amount) || 0),
      expenseCategories: cats,
    })
  }
  return out
}

module.exports = {
  ensureExpenseCategory,
  ensureDefaultPresetExpenseCategories,
  syncCustomBudgetLinesWithCategories,
}
