const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const displayBomId = (consolidated, jobId) => {
  if (jobId) return String(jobId)
  if (consolidated?._id) return `BOM-${String(consolidated._id).slice(-6).toUpperCase()}`
  return null
}

/** Account panel — BOM Files Details screen (consolidated only). */
exports.formatAccountConsolidatedBom = ({ lead, consolidated }) => {
  const items = consolidated?.items || []
  const missingDataCount = items.filter(
    (item) => item.isFullyPriced === false || !String(item.description || '').trim()
  ).length

  const rows = items.map((item, index) => {
    const qty = Number(item.totalQty) || 0
    const totalWeight = Number(item.totalWeight) || 0
    const unitWeightLbs = qty > 0 ? round2(totalWeight / qty) : round2(totalWeight)

    return {
      lineNumber: index + 1,
      category: item.category || '',
      item: item.partCode || item.markIds?.[0] || '',
      description: item.description || '',
      quantity: qty,
      unitWeightLbs,
      totalWeightLbs: round2(totalWeight),
      partColor: item.partColor || null,
      costUnit: item.costUnit || null,
      unitCost: item.unitCost ?? null,
      totalCost: item.totalCost ?? null,
      buildings: item.buildings || [],
    }
  })

  const fileUrl = consolidated?.fileUrl || ''
  const isExcel = /\.(xlsx|xls)$/i.test(fileUrl)
  const isPdf = /\.pdf$/i.test(fileUrl)

  return {
    leadId: lead._id,
    projectName: lead.projectName || '',
    jobId: lead.jobId || '',
    bomId: displayBomId(consolidated, lead.jobId),
    uploadId: consolidated?.fileName || displayBomId(consolidated, lead.jobId),
    consolidatedBOMId: consolidated._id,
    status: consolidated.status,
    generatedAt: consolidated.createdAt,
    updatedAt: consolidated.updatedAt,
    summary: {
      totalItems: consolidated.itemCount ?? items.length,
      totalWeightLbs: round2(consolidated.totalWeight ?? 0),
      totalPanelsAreaSqm: round2(consolidated.totalPanelsArea ?? 0),
      totalCost: consolidated.totalCost != null ? round2(consolidated.totalCost) : null,
      missingDataCount,
    },
    downloads: {
      excelUrl: isExcel ? fileUrl : fileUrl && !isPdf ? fileUrl : null,
      pdfUrl: isPdf ? fileUrl : null,
      fileUrl,
      fileName: consolidated.fileName || '',
    },
    rows,
  }
}
