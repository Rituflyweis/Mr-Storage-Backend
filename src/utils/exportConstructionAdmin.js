const ExcelJS = require('exceljs')

const generateDeliveriesExcel = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Deliveries')

  sheet.columns = [
    { header: 'Delivery #',  key: 'deliveryNumber', width: 16 },
    { header: 'Project',     key: 'projectName',     width: 25 },
    { header: 'Job ID',      key: 'jobId',            width: 12 },
    { header: 'Material',    key: 'material',         width: 25 },
    { header: 'Delivery Date', key: 'deliveryDate',   width: 16 },
    { header: 'Transporter', key: 'transporter',      width: 20 },
    { header: 'Driver',      key: 'driver',            width: 18 },
    { header: 'Status',      key: 'status',            width: 14 },
  ]

  for (const row of rows) {
    sheet.addRow({
      deliveryNumber: row.deliveryNumber || '—',
      projectName: row.projectName || '—',
      jobId: row.jobId || '—',
      material: row.material || '—',
      deliveryDate: row.deliveryDate ? new Date(row.deliveryDate).toLocaleDateString() : '—',
      transporter: row.transporter || '—',
      driver: row.driver || '—',
      status: row.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateReportExcel = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Project Progress')

  sheet.columns = [
    { header: 'Project', key: 'projectName', width: 28 },
    { header: 'Job ID',  key: 'jobId',        width: 14 },
    { header: 'Actual Progress %', key: 'actual', width: 18 },
  ]

  for (const row of rows) {
    sheet.addRow({
      projectName: row.projectName || '—',
      jobId: row.jobId || '—',
      actual: row.actual ?? 0,
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateMaterialRequestsExcel = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Material Requests')

  sheet.columns = [
    { header: 'Request ID', key: 'requestId',   width: 16 },
    { header: 'Project',    key: 'projectName', width: 25 },
    { header: 'Department', key: 'department',  width: 16 },
    { header: 'Items',      key: 'itemCount',   width: 10 },
    { header: 'Requested By', key: 'requestedBy', width: 20 },
    { header: 'Request Date', key: 'requestDate', width: 16 },
    { header: 'Required By',  key: 'requiredBy',  width: 16 },
    { header: 'Priority',   key: 'priority',    width: 12 },
    { header: 'Status',     key: 'status',       width: 12 },
  ]

  for (const row of rows) {
    sheet.addRow({
      requestId: row.requestId || '—',
      projectName: row.projectName || '—',
      department: row.department || '—',
      itemCount: row.itemCount ?? 0,
      requestedBy: row.requestedBy || '—',
      requestDate: row.requestDate ? new Date(row.requestDate).toLocaleDateString() : '—',
      requiredBy: row.requiredBy ? new Date(row.requiredBy).toLocaleDateString() : '—',
      priority: row.priority || '—',
      status: row.status || '—',
    })
  }

  sheet.getRow(1).font = { bold: true }
  return workbook.xlsx.writeBuffer()
}

const generateConstructionDashboardExcel = async ({ projectStats = {}, projects = [], exportedAt = new Date() }) => {
  const workbook = new ExcelJS.Workbook()

  const summary = workbook.addWorksheet('Summary')
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Value', key: 'value', width: 20 },
  ]
  const summaryRows = [
    { metric: 'Exported at', value: new Date(exportedAt).toISOString() },
    { metric: 'Total projects (active)', value: projectStats.total ?? 0 },
    { metric: 'Total including completed', value: projectStats.totalIncludingCompleted ?? 0 },
    { metric: 'On track', value: projectStats.onTrack ?? 0 },
    { metric: 'Delayed', value: projectStats.delayed ?? 0 },
    { metric: 'Completed (delivered)', value: projectStats.completed ?? 0 },
    { metric: 'On track %', value: projectStats.onTrackPct ?? 0 },
    { metric: 'Delayed %', value: projectStats.delayedPct ?? 0 },
    { metric: 'Completed %', value: projectStats.completedPct ?? 0 },
    { metric: projectStats.completionRateLabel || 'Average completion %', value: projectStats.completionRate ?? 0 },
    { metric: 'Upcoming deadlines (30d)', value: projectStats.upcomingDeadlines ?? 0 },
    { metric: 'Total change vs yesterday %', value: projectStats.totalChangePctVsYesterday ?? 0 },
  ]
  for (const row of summaryRows) summary.addRow(row)
  summary.getRow(1).font = { bold: true }

  const sheet = workbook.addWorksheet('Projects')
  sheet.columns = [
    { header: 'Job ID', key: 'jobId', width: 14 },
    { header: 'Project', key: 'projectName', width: 28 },
    { header: 'Site', key: 'site', width: 22 },
    { header: 'Business unit', key: 'businessUnitLabel', width: 18 },
    { header: 'Lifecycle status', key: 'lifecycleStatus', width: 22 },
    { header: 'Progress %', key: 'progressPct', width: 12 },
    { header: 'Health', key: 'health', width: 12 },
    { header: 'Delivery status', key: 'deliveryStatus', width: 16 },
    { header: 'Deadline', key: 'deadline', width: 14 },
  ]

  for (const row of projects) {
    sheet.addRow({
      jobId: row.jobId || '—',
      projectName: row.projectName || '—',
      site: row.site || '—',
      businessUnitLabel: row.businessUnitLabel || '—',
      lifecycleStatus: row.lifecycleStatus || '—',
      progressPct: row.progressPct ?? 0,
      health: row.health || '—',
      deliveryStatus: row.deliveryStatus || '—',
      deadline: row.deadline ? new Date(row.deadline).toLocaleDateString() : '—',
    })
  }
  sheet.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

module.exports = {
  generateDeliveriesExcel,
  generateReportExcel,
  generateMaterialRequestsExcel,
  generateConstructionDashboardExcel,
}
