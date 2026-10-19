const costs = require('../../services/accountCostsPanel.service')
const salaryPayslip = require('../../services/accountSalaryPayslip.service')
const smdtCosts = require('../../services/accountSmdtItemCost.service')
const generateExpenseId = require('../../utils/generateExpenseId')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')

const withGen = (fn) => asyncHandler(async (req, res) => {
  const data = await fn(req.body, req.user._id, generateExpenseId)
  if (data?.error) return badRequest(res, data.error)
  return created(res, data)
})

exports.getFilters = asyncHandler(async (req, res) => success(res, await costs.getFilters()))

exports.getSalarySummary = asyncHandler(async (req, res) => success(res, await costs.getSalarySummary()))
exports.listSalaryRecords = asyncHandler(async (req, res) => success(res, await costs.listSalaryRecords(req.query)))
exports.createSalaryEntry = withGen(costs.createSalaryEntry)
exports.markSalaryPaid = asyncHandler(async (req, res) => {
  const row = await costs.markSalaryPaid(req.params.id)
  if (!row) return notFound(res, 'Salary entry not found')
  return success(res, row)
})
exports.deleteSalaryEntry = asyncHandler(async (req, res) => {
  const ok = await costs.deactivatePanelExpense(req.params.id, 'salary')
  if (!ok) return notFound(res, 'Salary entry not found')
  return success(res, {}, 'Deleted')
})

exports.generateSalaryPayslip = asyncHandler(async (req, res) => {
  const result = await salaryPayslip.generateSalaryPayslip(req.params.id)
  if (!result) return notFound(res, 'Salary entry not found')
  const row = await costs.getSalaryRecordById(result.expense._id)
  return success(
    res,
    {
      ...row,
      downloadPath: `/api/account/costs/salary/${result.expense._id}/payslip`,
    },
    'Payslip generated'
  )
})

exports.downloadSalaryPayslip = asyncHandler(async (req, res) => {
  const result = await salaryPayslip.getSalaryPayslipPdfBuffer(req.params.id)
  if (!result) return notFound(res, 'Salary entry not found')
  const name =
    result.expense.metadata?.payslipFileName ||
    `payslip-${result.expense.expenseId || result.expense._id}.pdf`
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${name}"`)
  return res.send(result.buffer)
})

exports.getManpowerSummary = asyncHandler(async (req, res) => success(res, await costs.getManpowerSummary()))
exports.listManpowerRecords = asyncHandler(async (req, res) => success(res, await costs.listManpowerRecords(req.query)))
exports.createManpowerEntry = withGen(costs.createManpowerEntry)
exports.updateManpowerEntry = asyncHandler(async (req, res) => {
  const row = await costs.updatePanelExpense(req.params.id, req.body, 'manpower')
  if (!row) return notFound(res, 'Manpower entry not found')
  return success(res, { id: row._id })
})
exports.deleteManpowerEntry = asyncHandler(async (req, res) => {
  const ok = await costs.deactivatePanelExpense(req.params.id, 'manpower')
  if (!ok) return notFound(res, 'Manpower entry not found')
  return success(res, {}, 'Deleted')
})

exports.getMiscellaneousSummary = asyncHandler(async (req, res) => success(res, await costs.getMiscellaneousSummary(req.query)))
exports.getMiscellaneousOverviewChart = asyncHandler(async (req, res) =>
  success(res, { points: await costs.getMiscellaneousOverviewChart(req.query) })
)
exports.getMiscellaneousByCategory = asyncHandler(async (req, res) =>
  success(res, { categories: await costs.getMiscellaneousByCategory(req.query) })
)
exports.listMiscellaneousByProject = asyncHandler(async (req, res) => success(res, await costs.listMiscellaneousByProject(req.query)))
exports.listMiscellaneousRecords = asyncHandler(async (req, res) => success(res, await costs.listMiscellaneousRecords(req.query)))
exports.createMiscellaneousEntry = withGen(costs.createMiscellaneousEntry)

exports.getFreightSummary = asyncHandler(async (req, res) => success(res, await costs.getFreightSummary(req.query)))
exports.getFreightTrend = asyncHandler(async (req, res) => success(res, { points: await costs.getFreightTrend(req.query) }))
exports.getFreightCarrierDistribution = asyncHandler(async (req, res) =>
  success(res, { carriers: await costs.getFreightCarrierDistribution() })
)
exports.listFreightRecords = asyncHandler(async (req, res) => success(res, await costs.listFreightRecords(req.query)))

exports.getLogisticsSummary = asyncHandler(async (req, res) => success(res, await costs.getLogisticsSummary()))
exports.listLogisticsRecords = asyncHandler(async (req, res) => success(res, await costs.listLogisticsRecords(req.query)))
exports.lookupDelivery = asyncHandler(async (req, res) => {
  const data = await costs.lookupDeliveryForLogistics(req.params.deliveryRef)
  if (!data) return notFound(res, 'Delivery not found')
  return success(res, data)
})
exports.createLogisticsCost = withGen(costs.createLogisticsCost)

exports.getVarianceSummary = asyncHandler(async (req, res) => success(res, await costs.getVarianceSummary()))
exports.getVarianceAlerts = asyncHandler(async (req, res) => success(res, { alerts: await costs.getVarianceAlerts() }))
exports.getVarianceTrend = asyncHandler(async (req, res) => success(res, { points: await costs.getVarianceTrend() }))
exports.listVarianceDetails = asyncHandler(async (req, res) => success(res, await costs.listVarianceDetails(req.query)))

exports.getRentSummary = asyncHandler(async (req, res) => success(res, await costs.getRentSummary()))
exports.listRentRecords = asyncHandler(async (req, res) => success(res, await costs.listRentRecords(req.query)))
exports.createRentEntry = withGen(costs.createRentEntry)

exports.getFutureSummary = asyncHandler(async (req, res) => success(res, await costs.getFutureSummary()))
exports.listFutureRecords = asyncHandler(async (req, res) => success(res, await costs.listFutureRecords(req.query)))
exports.createFutureEntry = withGen(costs.createFutureEntry)

exports.getItemCostCategories = asyncHandler(async (req, res) => success(res, smdtCosts.getCategories()))

exports.getItemCostSummary = asyncHandler(async (req, res) => success(res, await smdtCosts.getSummary(req.query)))

/** Combined Figma screen: stats + part table (alias: records). */
exports.getItemCostList = asyncHandler(async (req, res) => success(res, await smdtCosts.getPartCostList(req.query)))
exports.listItemCosts = exports.getItemCostList

exports.getItemCostStats = asyncHandler(async (req, res) => {
  const data = await smdtCosts.getSummary(req.query)
  return success(res, { stats: data.stats, costVersion: data.costVersion })
})

exports.getItemCostById = asyncHandler(async (req, res) => {
  const row = await smdtCosts.getPartCostById(req.params.itemId)
  if (!row) return notFound(res, 'SMDT item not found')
  return success(res, row)
})

exports.createItemCost = asyncHandler(async (req, res) => {
  const result = await smdtCosts.createPartCost(req.body, req.user._id)
  if (result.error) return badRequest(res, result.error)
  return created(res, result)
})

exports.updateItemCost = asyncHandler(async (req, res) => {
  const result = await smdtCosts.updatePartCost(req.params.itemId, req.body, req.user._id)
  if (result.error === 'Item not found') return notFound(res, result.error)
  if (result.error) return badRequest(res, result.error)
  return success(res, result)
})

exports.exportItemCostList = asyncHandler(async (req, res) => {
  const buffer = await smdtCosts.exportPartCostExcel(req.query)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="smdt-item-cost-list.xlsx"')
  return res.send(buffer)
})
