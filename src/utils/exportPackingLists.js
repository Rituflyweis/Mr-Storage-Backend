const ExcelJS = require('exceljs')

const generatePackingListExcel = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Packing Lists')

  sheet.columns = [
    { header: 'Packing List #', key: 'packingListNo', width: 18 },
    { header: 'Truck',          key: 'truck',          width: 18 },
    { header: 'Project',        key: 'projectName',    width: 25 },
    { header: 'Total Bundles',  key: 'totalBundles',   width: 14 },
    { header: 'Total Weight',   key: 'totalWeight',    width: 14 },
    { header: 'Destination',    key: 'destination',    width: 20 },
    { header: 'Status',         key: 'status',         width: 14 },
  ]

  for (const pl of rows) {
    sheet.addRow({
      packingListNo: pl.packingListNo || '—',
      truck:         pl.truck || '—',
      projectName:   pl.project?.projectName || '—',
      totalBundles:  pl.totalBundles ?? 0,
      totalWeight:   pl.totalWeight ?? 0,
      destination:   pl.destination || '—',
      status:        pl.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

module.exports = { generatePackingListExcel }
