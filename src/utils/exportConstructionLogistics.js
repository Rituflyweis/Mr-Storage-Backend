const ExcelJS = require('exceljs')

const addSheet = async (rows, columns, sheetName) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns
  for (const row of rows) sheet.addRow(row)
  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateBundleLabelsExcel = async (rows) =>
  addSheet(
    rows.map((r) => ({
      bundleNo: r.bundleNo || '—',
      loadId: r.loadId || '—',
      projectName: r.project?.projectName || '—',
      jobId: r.project?.jobId || '—',
      bundleType: r.bundleType || '—',
      totalWeight: r.totalWeight ?? 0,
      status: r.status || '—',
      labelPrinted: r.labelPrinted ? 'Yes' : 'No',
    })),
    [
      { header: 'Bundle #', key: 'bundleNo', width: 14 },
      { header: 'Load ID', key: 'loadId', width: 16 },
      { header: 'Project', key: 'projectName', width: 24 },
      { header: 'Job ID', key: 'jobId', width: 12 },
      { header: 'Type', key: 'bundleType', width: 12 },
      { header: 'Weight (lbs)', key: 'totalWeight', width: 14 },
      { header: 'Bundle Status', key: 'status', width: 16 },
      { header: 'Label Printed', key: 'labelPrinted', width: 14 },
    ],
    'Bundle Labels'
  )

const generateBundleScanExcel = async (rows) =>
  addSheet(
    rows.map((r) => ({
      bundleNo: r.bundleNo || '—',
      projectName: r.project?.projectName || '—',
      totalWeight: r.totalWeight ?? 0,
      status: r.status || '—',
      scannedAt: r.scannedAt ? new Date(r.scannedAt).toISOString() : '—',
    })),
    [
      { header: 'Bundle #', key: 'bundleNo', width: 14 },
      { header: 'Project', key: 'projectName', width: 24 },
      { header: 'Weight (lbs)', key: 'totalWeight', width: 14 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Last Updated', key: 'scannedAt', width: 22 },
    ],
    'Bundle Scan'
  )

const generateDispatchVerificationExcel = async (rows) =>
  addSheet(
    rows.map((r) => ({
      packingListNo: r.packingListNo || '—',
      projectName: r.project?.projectName || '—',
      truck: r.truck || '—',
      totalBundles: r.totalBundles ?? 0,
      totalWeight: r.totalWeight ?? 0,
      destination: r.destination || '—',
      status: r.status || '—',
    })),
    [
      { header: 'Load #', key: 'packingListNo', width: 16 },
      { header: 'Project', key: 'projectName', width: 24 },
      { header: 'Truck', key: 'truck', width: 16 },
      { header: 'Bundles', key: 'totalBundles', width: 10 },
      { header: 'Weight (lbs)', key: 'totalWeight', width: 14 },
      { header: 'Destination', key: 'destination', width: 20 },
      { header: 'Status', key: 'status', width: 14 },
    ],
    'Dispatch Verification'
  )

module.exports = {
  generateBundleLabelsExcel,
  generateBundleScanExcel,
  generateDispatchVerificationExcel,
}
