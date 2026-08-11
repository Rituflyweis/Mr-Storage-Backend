const ExcelJS = require('exceljs')

const generateFinancialOverviewExcel = async (rows, summary) => {
  const workbook = new ExcelJS.Workbook()
  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.columns = [{ header: 'Metric', key: 'metric', width: 24 }, { header: 'Value', key: 'value', width: 20 }]
  summarySheet.addRow({ metric: 'Total Revenue', value: summary.totalRevenue })
  summarySheet.addRow({ metric: 'Total Expenses', value: summary.totalExpenses })
  summarySheet.addRow({ metric: 'Gross Profit', value: summary.grossProfit })
  summarySheet.getRow(1).font = { bold: true }

  const sheet = workbook.addWorksheet('Paid Invoices')
  sheet.columns = [
    { header: 'Invoice #',  key: 'invoiceNumber', width: 16 },
    { header: 'Project',    key: 'projectName',    width: 25 },
    { header: 'Job ID',     key: 'jobId',           width: 12 },
    { header: 'Customer',   key: 'customerName',    width: 22 },
    { header: 'Amount',     key: 'amount',           width: 14 },
    { header: 'Date',       key: 'date',              width: 16 },
  ]
  for (const row of rows) {
    sheet.addRow({
      invoiceNumber: row.invoiceNumber || '—',
      projectName: row.projectName || '—',
      jobId: row.jobId || '—',
      customerName: row.customerName || '—',
      amount: row.amount || 0,
      date: row.date ? new Date(row.date).toLocaleDateString() : '—',
    })
  }
  sheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

const generateWIPProfitsExcel = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('WIP Profits')

  sheet.columns = [
    { header: 'Project',        key: 'projectName',    width: 25 },
    { header: 'Job ID',         key: 'jobId',            width: 12 },
    { header: 'Customer',       key: 'customerName',     width: 22 },
    { header: 'Order Value',    key: 'orderValue',        width: 14 },
    { header: 'Current Cost',   key: 'currentCost',       width: 14 },
    { header: 'Total Received', key: 'totalReceived',     width: 16 },
    { header: 'Outstanding',    key: 'outstanding',       width: 14 },
    { header: 'WIP Profit',     key: 'wipProfit',          width: 14 },
    { header: 'Margin %',       key: 'marginPct',          width: 12 },
    { header: 'Status',         key: 'status',              width: 14 },
  ]

  for (const row of rows) {
    sheet.addRow({
      projectName: row.projectName || '—',
      jobId: row.jobId || '—',
      customerName: row.customerName || '—',
      orderValue: row.orderValue || 0,
      currentCost: row.currentCost || 0,
      totalReceived: row.totalReceived || 0,
      outstanding: row.outstanding || 0,
      wipProfit: row.wipProfit || 0,
      marginPct: row.marginPct || 0,
      status: row.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateExpensesExcel = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Expenses')

  sheet.columns = [
    { header: 'Expense ID',  key: 'expenseId',    width: 16 },
    { header: 'Date',        key: 'date',           width: 14 },
    { header: 'Category',    key: 'category',        width: 18 },
    { header: 'Subcategory', key: 'subcategory',       width: 18 },
    { header: 'Project',     key: 'projectName',        width: 22 },
    { header: 'Building',    key: 'buildingLabel',       width: 14 },
    { header: 'Amount',      key: 'amount',                width: 14 },
    { header: 'Payment Method', key: 'paymentMethod',       width: 16 },
    { header: 'Status',      key: 'status',                  width: 12 },
    { header: 'Description', key: 'description',              width: 30 },
  ]

  for (const row of rows) {
    sheet.addRow({
      expenseId: row.expenseId || '—',
      date: row.date ? new Date(row.date).toLocaleDateString() : '—',
      category: row.category || '—',
      subcategory: row.subcategory || '—',
      projectName: row.projectName || '—',
      buildingLabel: row.buildingLabel || '—',
      amount: row.amount || 0,
      paymentMethod: row.paymentMethod || '—',
      status: row.status || '—',
      description: row.description || '',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

module.exports = { generateFinancialOverviewExcel, generateWIPProfitsExcel, generateExpensesExcel }
