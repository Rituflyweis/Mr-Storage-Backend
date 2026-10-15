const ExcelJS = require('exceljs')

const generateAccountDashboardExcel = async (overview) => {
  const workbook = new ExcelJS.Workbook()

  const summary = workbook.addWorksheet('Financial Overview')
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Value', key: 'value', width: 18 },
  ]
  const fo = overview.financialOverview || {}
  const inv = overview.invoiceReport || {}
  const del = overview.deliveryFinance || {}
  const ovp = overview.orderVsPlantCosts || {}

  ;[
    ['Total Revenue', fo.totalRevenue],
    ['Total Expenses', fo.totalExpenses],
    ['Net Profit', fo.netProfit],
    ['Outstanding Payments', fo.outstandingPayments],
    ['Invoices Generated', inv.totalInvoicesGenerated],
    ['Total Paid (Invoices)', inv.totalPaid],
    ['Total Unpaid', inv.totalUnpaid],
    ['Overdue Amount', inv.overdueAmount],
    ['Freight Spend', del.freightSpend],
    ['Pending Carrier Payments', del.pendingCarrierPayments],
    ['Freight Savings', del.freightSavings],
    ['Total Order Value', ovp.totalOrderValue],
    ['Total Plant Costs', ovp.totalPlantCosts],
    ['Projected Profit', ovp.projectedProfit],
  ].forEach(([metric, value]) => summary.addRow({ metric, value: value ?? 0 }))
  summary.getRow(1).font = { bold: true }

  const txSheet = workbook.addWorksheet('Recent Transactions')
  txSheet.columns = [
    { header: 'Label', key: 'label', width: 22 },
    { header: 'Entity', key: 'entityName', width: 24 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Status', key: 'status', width: 12 },
  ]
  for (const t of overview.recentTransactions || []) {
    txSheet.addRow({
      label: t.label,
      entityName: t.entityName,
      date: t.date ? new Date(t.date).toLocaleDateString() : '',
      amount: t.amount,
      status: t.status,
    })
  }
  txSheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

module.exports = { generateAccountDashboardExcel }
