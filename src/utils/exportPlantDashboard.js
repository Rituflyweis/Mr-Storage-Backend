const ExcelJS = require('exceljs')

const addSection = (sheet, title, rows) => {
  sheet.addRow([title]).font = { bold: true }
  for (const [metric, value] of rows) {
    sheet.addRow([metric, value])
  }
  sheet.addRow([])
}

const generatePlantOverviewExcel = async (payload) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Plant Overview')
  sheet.columns = [
    { header: 'Metric', key: 'metric', width: 36 },
    { header: 'Value', key: 'value', width: 18 },
  ]
  sheet.getRow(1).font = { bold: true }

  const o = payload.orderProgress || {}
  addSection(sheet, 'Order progress', [
    ['Quotations sent', o.quotationsSent ?? 0],
    ['BOM uploaded', o.uploadedBom ?? 0],
    ['Sent to shippers', o.sentToShipper ?? 0],
    ['Loads planned', o.loadsPlanned ?? 0],
    ['Shipped quantity', o.shippedQuantity ?? 0],
  ])

  const l = payload.loadPlanning || {}
  addSection(sheet, 'Load planning', [
    ['In planning', l.loadsPlanning ?? 0],
    ['Planned', l.plannedCount ?? 0],
    ['Ready to ship', l.readyToShip ?? 0],
    ['Dispatched', l.dispatch ?? 0],
  ])

  const m = payload.mismatchSummary || {}
  addSection(sheet, 'Missing / mismatch items', [
    ['Missing items (quote vs shipper)', m.missingItems ?? 0],
    ['Quantity mismatches', m.quantityMismatches ?? 0],
    ['Specification mismatches', m.specificationMismatches ?? 0],
    ['Extra items in shipper', m.extraItems ?? 0],
  ])

  addSection(sheet, 'Shipper quotations', Object.entries(payload.shipperQuotation || {}))
  addSection(sheet, 'Packing lists', Object.entries(payload.packingList || {}))
  addSection(sheet, 'QR labels', Object.entries(payload.qrLabels || {}))
  addSection(sheet, 'Shippers', Object.entries(payload.shippers || {}))
  addSection(sheet, 'Deliveries', Object.entries(payload.deliveries || {}))

  return workbook.xlsx.writeBuffer()
}

module.exports = { generatePlantOverviewExcel }
