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

const generatePaymentsDashboardExcel = async (stats, recentPayments) => {
  const workbook = new ExcelJS.Workbook()
  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.columns = [{ header: 'Metric', key: 'metric', width: 24 }, { header: 'Value', key: 'value', width: 20 }]
  summarySheet.addRow({ metric: 'Total Payments', value: stats.totalPayments })
  summarySheet.addRow({ metric: 'Total Received', value: stats.totalReceived })
  summarySheet.addRow({ metric: 'Total Outstanding', value: stats.totalOutstanding })
  summarySheet.addRow({ metric: 'Total Overdue', value: stats.totalOverdue })
  summarySheet.addRow({ metric: 'Total Overdue YTD', value: stats.totalOverdueYTD })
  summarySheet.addRow({ metric: 'Total Overdue YTD %', value: stats.totalOverdueYTDPct })
  summarySheet.getRow(1).font = { bold: true }

  const sheet = workbook.addWorksheet('Recent Payments')
  sheet.columns = [
    { header: 'Invoice #',  key: 'invoiceNumber', width: 16 },
    { header: 'Project',    key: 'projectName',    width: 25 },
    { header: 'Customer',   key: 'customerName',    width: 22 },
    { header: 'Amount',     key: 'amount',           width: 14 },
    { header: 'Status',     key: 'status',            width: 14 },
    { header: 'Date',       key: 'date',               width: 16 },
  ]
  for (const inv of recentPayments) {
    sheet.addRow({
      invoiceNumber: inv.invoiceNumber || '—',
      projectName: inv.leadId?.projectName || '—',
      customerName: `${inv.customerId?.firstName || ''} ${inv.customerId?.lastName || ''}`.trim() || '—',
      amount: inv.totalAmount || 0,
      status: inv.status || '—',
      date: inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—',
    })
  }
  sheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

const generateStateWiseTaxExcel = async (stateStats) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('State Wise Tax')

  sheet.columns = [
    { header: 'State',         key: 'state',        width: 20 },
    { header: 'Tax Collected', key: 'taxCollected',  width: 16 },
    { header: 'Taxable Sales', key: 'taxableSales',   width: 16 },
    { header: 'Paid/Filed',    key: 'paidFiled',       width: 14 },
    { header: 'Payable',       key: 'payable',          width: 14 },
    { header: 'Next Due',      key: 'nextDue',           width: 16 },
  ]

  for (const row of stateStats) {
    sheet.addRow({
      state: row._id || '—',
      taxCollected: row.taxCollected || 0,
      taxableSales: row.taxableSales || 0,
      paidFiled: row.paidFiled || 0,
      payable: row.payable || 0,
      nextDue: row.nextDue ? new Date(row.nextDue).toLocaleDateString() : '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateProjectWiseTaxExcel = async (projects) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Project Wise Tax')

  sheet.columns = [
    { header: 'Project',       key: 'projectName',   width: 25 },
    { header: 'Job ID',        key: 'jobId',           width: 12 },
    { header: 'Location',      key: 'location',         width: 18 },
    { header: 'Customer',      key: 'customerName',      width: 22 },
    { header: 'Tax Collected', key: 'taxCollected',       width: 16 },
    { header: 'Taxable Sales', key: 'taxableSales',        width: 16 },
    { header: 'Paid/Filed',    key: 'paidFiled',            width: 14 },
    { header: 'Payable',       key: 'payable',               width: 14 },
    { header: 'Due Date',      key: 'dueDate',                width: 16 },
    { header: 'Status',        key: 'status',                  width: 14 },
  ]

  for (const row of projects) {
    sheet.addRow({
      projectName: row.projectName || '—',
      jobId: row.jobId || '—',
      location: row.location || '—',
      customerName: row.customerName || '—',
      taxCollected: row.taxCollected || 0,
      taxableSales: row.taxableSales || 0,
      paidFiled: row.paidFiled || 0,
      payable: row.payable || 0,
      dueDate: row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '—',
      status: row.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generatePaymentApprovalsExcel = async (approvals) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Payment Approvals')

  sheet.columns = [
    { header: 'Payment ID',    key: 'paymentId',    width: 16 },
    { header: 'Payee',         key: 'payee',          width: 22 },
    { header: 'Category',      key: 'category',        width: 18 },
    { header: 'Amount',        key: 'amount',            width: 14 },
    { header: 'Department',    key: 'department',         width: 16 },
    { header: 'Requested By',  key: 'requestedBy',         width: 20 },
    { header: 'Requested Date', key: 'requestedDate',       width: 16 },
    { header: 'Status',        key: 'status',                width: 14 },
  ]

  for (const row of approvals) {
    sheet.addRow({
      paymentId: row.paymentId || '—',
      payee: row.payee || '—',
      category: row.category || '—',
      amount: row.amount || 0,
      department: row.department || '—',
      requestedBy: row.requestedBy?.name || '—',
      requestedDate: row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—',
      status: row.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generatePaymentHistoryExcel = async (invoices) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Payment History')

  sheet.columns = [
    { header: 'Invoice #',      key: 'invoiceNumber', width: 16 },
    { header: 'Project',        key: 'projectName',    width: 25 },
    { header: 'Customer',       key: 'customerName',    width: 22 },
    { header: 'Amount',         key: 'amount',            width: 14 },
    { header: 'Method',         key: 'paymentMethod',      width: 16 },
    { header: 'Status',         key: 'status',               width: 14 },
    { header: 'Date',           key: 'date',                   width: 16 },
  ]

  for (const inv of invoices) {
    sheet.addRow({
      invoiceNumber: inv.invoiceNumber || '—',
      projectName: inv.leadId?.projectName || '—',
      customerName: `${inv.customerId?.firstName || ''} ${inv.customerId?.lastName || ''}`.trim() || '—',
      amount: inv.totalAmount || 0,
      paymentMethod: inv.paymentMethod || '—',
      status: inv.status || '—',
      date: inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateTaxFilingExcel = async (records) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Tax Filing')

  sheet.columns = [
    { header: 'State',        key: 'state',        width: 18 },
    { header: 'Project',      key: 'projectName',   width: 25 },
    { header: 'Job ID',       key: 'jobId',           width: 12 },
    { header: 'Customer',     key: 'customerName',     width: 22 },
    { header: 'Amount',       key: 'amount',             width: 14 },
    { header: 'Filing Frequency', key: 'filingFrequency', width: 18 },
    { header: 'Due Date',     key: 'dueDate',              width: 16 },
    { header: 'Status',       key: 'status',                 width: 14 },
    { header: 'Paid At',      key: 'paidAt',                   width: 16 },
  ]

  for (const row of records) {
    sheet.addRow({
      state: row.state || '—',
      projectName: row.leadId?.projectName || '—',
      jobId: row.leadId?.jobId || '—',
      customerName: row.customerId ? `${row.customerId.firstName || ''} ${row.customerId.lastName || ''}`.trim() : '—',
      amount: row.amount || 0,
      filingFrequency: row.filingFrequency || '—',
      dueDate: row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '—',
      status: row.status || '—',
      paidAt: row.paidAt ? new Date(row.paidAt).toLocaleDateString() : '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

module.exports = { generateFinancialOverviewExcel, generateWIPProfitsExcel, generateExpensesExcel, generatePaymentsDashboardExcel, generateStateWiseTaxExcel, generateProjectWiseTaxExcel, generatePaymentApprovalsExcel, generatePaymentHistoryExcel, generateTaxFilingExcel }
