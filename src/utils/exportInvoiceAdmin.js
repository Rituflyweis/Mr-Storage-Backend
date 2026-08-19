const ExcelJS = require('exceljs')

const generateVendorInvoicesExcel = async (invoices) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Vendor Invoices')

  sheet.columns = [
    { header: 'Invoice #',  key: 'invoiceNumber', width: 16 },
    { header: 'Vendor',     key: 'vendorName',      width: 22 },
    { header: 'Project',    key: 'projectName',      width: 25 },
    { header: 'Job ID',     key: 'jobId',              width: 12 },
    { header: 'Category',   key: 'category',            width: 14 },
    { header: 'Amount',     key: 'amount',                width: 14 },
    { header: 'Date',       key: 'date',                    width: 16 },
    { header: 'Status',     key: 'status',                    width: 14 },
  ]

  for (const inv of invoices) {
    sheet.addRow({
      invoiceNumber: inv.invoiceNumber || '—',
      vendorName: inv.vendorId?.vendorName || inv.payeeName || '—',
      projectName: inv.leadId?.projectName || '—',
      jobId: inv.leadId?.jobId || '—',
      category: inv.category || '—',
      amount: inv.totalAmount || 0,
      date: inv.date ? new Date(inv.date).toLocaleDateString() : '—',
      status: inv.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateFreightCarrierInvoicesExcel = async (invoices) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Freight Carrier Invoices')

  sheet.columns = [
    { header: 'Invoice #',  key: 'invoiceNumber', width: 16 },
    { header: 'Carrier',    key: 'carrierName',     width: 22 },
    { header: 'Project',    key: 'projectName',      width: 25 },
    { header: 'Job ID',     key: 'jobId',              width: 12 },
    { header: 'Amount',     key: 'amount',               width: 14 },
    { header: 'Date',       key: 'date',                   width: 16 },
    { header: 'Status',     key: 'status',                   width: 14 },
  ]

  for (const inv of invoices) {
    sheet.addRow({
      invoiceNumber: inv.invoiceNumber || '—',
      carrierName: inv.carrierId?.carrierName || inv.payeeName || '—',
      projectName: inv.leadId?.projectName || '—',
      jobId: inv.leadId?.jobId || '—',
      amount: inv.totalAmount || 0,
      date: inv.date ? new Date(inv.date).toLocaleDateString() : '—',
      status: inv.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

// Single "Individual Invoice" export — header info + line items, works for any invoiceType.
const generateSingleInvoiceExcel = async (invoice) => {
  const workbook = new ExcelJS.Workbook()
  const infoSheet = workbook.addWorksheet('Invoice')

  const payeeLabel = invoice.vendorId?.vendorName || invoice.carrierId?.carrierName || invoice.payeeName || '—'
  infoSheet.columns = [{ header: 'Field', key: 'field', width: 20 }, { header: 'Value', key: 'value', width: 30 }]
  infoSheet.addRow({ field: 'Invoice #', value: invoice.invoiceNumber || '—' })
  infoSheet.addRow({ field: 'Type', value: invoice.invoiceType || 'customer' })
  infoSheet.addRow({ field: 'Payee', value: payeeLabel })
  infoSheet.addRow({ field: 'Project', value: invoice.leadId?.projectName || '—' })
  infoSheet.addRow({ field: 'Job ID', value: invoice.leadId?.jobId || '—' })
  infoSheet.addRow({ field: 'Date', value: invoice.date ? new Date(invoice.date).toLocaleDateString() : '—' })
  infoSheet.addRow({ field: 'Due Date', value: invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : '—' })
  infoSheet.addRow({ field: 'Status', value: invoice.status || '—' })
  infoSheet.addRow({ field: 'Subtotal', value: invoice.subtotal || 0 })
  infoSheet.addRow({ field: 'Tax', value: invoice.tax || 0 })
  infoSheet.addRow({ field: 'Discount', value: invoice.discount || 0 })
  infoSheet.addRow({ field: 'Total Amount', value: invoice.totalAmount || 0 })
  infoSheet.getRow(1).font = { bold: true }

  const lineSheet = workbook.addWorksheet('Line Items')
  lineSheet.columns = [
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Rate',        key: 'rate',           width: 12 },
    { header: 'Quantity',    key: 'quantity',         width: 12 },
    { header: 'Markup',      key: 'markup',             width: 12 },
    { header: 'Tax',         key: 'tax',                  width: 12 },
    { header: 'Total',       key: 'total',                 width: 14 },
  ]
  for (const item of (invoice.lineItems || [])) {
    lineSheet.addRow({
      description: item.description || '',
      rate: item.rate || 0,
      quantity: item.quantity || 0,
      markup: item.markupAmount || 0,
      tax: item.taxAmount || 0,
      total: item.total || 0,
    })
  }
  lineSheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

module.exports = { generateVendorInvoicesExcel, generateFreightCarrierInvoicesExcel, generateSingleInvoiceExcel }
