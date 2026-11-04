/**
 * Sync ProjectBudget customLines with ExpenseCategory (expenseCategories from label).
 * Usage: node scripts/backfill-budget-expense-links.js
 */
require('dotenv').config()
const mongoose = require('mongoose')
const ProjectBudget = require('../src/models/ProjectBudget')
const User = require('../src/models/User')
const { normalizeCustomLines } = require('../src/utils/budgetVsActual.util')
const {
  syncCustomBudgetLinesWithCategories,
  ensureDefaultPresetExpenseCategories,
} = require('../src/services/budgetExpenseCategorySync.service')

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI required')
    process.exit(1)
  }
  await mongoose.connect(process.env.MONGO_URI)
  const staff =
    (await User.findOne({ role: 'admin', isActive: true }).select('_id')) ||
    (await User.findOne({ isActive: true }).select('_id'))
  const userId = staff?._id || null

  await ensureDefaultPresetExpenseCategories(userId)

  const budgets = await ProjectBudget.find({}).lean()
  let updated = 0
  for (const b of budgets) {
    const synced = await syncCustomBudgetLinesWithCategories(
      normalizeCustomLines(b.customLines || []),
      userId
    )
    const before = JSON.stringify(b.customLines || [])
    const after = JSON.stringify(synced)
    if (before !== after) {
      await ProjectBudget.updateOne({ _id: b._id }, { $set: { customLines: synced } })
      updated++
    }
  }
  console.log(
    `[backfill-budget-expense-links] scanned=${budgets.length} updated=${updated}`
  )
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
