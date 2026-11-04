/**
 * Upsert canonical expense categories aligned with project budget presets.
 * Usage: node scripts/seed-default-expense-categories.js
 */
require('dotenv').config()
const mongoose = require('mongoose')
const User = require('../src/models/User')
const {
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
  const names = await ensureDefaultPresetExpenseCategories(staff?._id || null)
  console.log('[seed-default-expense-categories] ensured:', names.join(', '))
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
