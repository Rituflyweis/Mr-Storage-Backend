const SHIPPER_COMPARISON_STATUSES = ['idle', 'processing', 'completed', 'failed']

const parsePageLimit = (query, defaultLimit = 20) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(200, Math.max(1, parseInt(query.limit, 10) || defaultLimit))
  return { page, limit }
}

const paginateArray = (items, page, limit) => {
  const total = items.length
  const slice = items.slice((page - 1) * limit, (page - 1) * limit + limit)
  return { items: slice, total, page, limit }
}

const parseShipperProjectListQuery = (query = {}) => {
  const { page, limit } = parsePageLimit(query)
  const hasSubmittedFile =
    query.hasSubmittedFile === 'true'
      ? true
      : query.hasSubmittedFile === 'false'
        ? false
        : null

  return {
    page,
    limit,
    search: String(query.search || '').trim().toLowerCase(),
    fileReceivedStatus: String(query.fileStatus || query.fileReceivedStatus || '').trim(),
    buildingType: String(query.buildingType || '').trim().toLowerCase(),
    status: String(query.status || '').trim(),
    comparisonStatus: String(query.comparisonStatus || '').trim(),
    vendorId: String(query.vendorId || '').trim(),
    hasSubmittedFile,
  }
}

const parseShipperRequestListQuery = (query = {}) => {
  const { page, limit } = parsePageLimit(query)
  const hasSubmittedFile =
    query.hasSubmittedFile === 'true'
      ? true
      : query.hasSubmittedFile === 'false'
        ? false
        : null

  return {
    page,
    limit,
    search: String(query.search || '').trim().toLowerCase(),
    status: String(query.status || '').trim(),
    comparisonStatus: String(query.comparisonStatus || '').trim(),
    vendorId: String(query.vendorId || '').trim(),
    hasSubmittedFile,
  }
}

const projectSearchHaystack = (project) =>
  [
    project.projectName,
    project.jobId,
    project.projectId,
    project.customerName,
    project.buildingType,
    project.location,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

const filterShipperProjects = (projects, opts, requestsByLeadId = new Map()) => {
  let rows = [...projects]

  if (opts.fileReceivedStatus) {
    rows = rows.filter((p) => p.fileReceivedStatus === opts.fileReceivedStatus)
  }
  if (opts.buildingType) {
    rows = rows.filter((p) =>
      (p.buildingType || '').toLowerCase().includes(opts.buildingType),
    )
  }
  if (opts.search) {
    rows = rows.filter((p) => projectSearchHaystack(p).includes(opts.search))
  }

  const hasRequestFilters =
    opts.status ||
    opts.comparisonStatus ||
    opts.vendorId ||
    opts.hasSubmittedFile !== null

  if (hasRequestFilters) {
    rows = rows.filter((p) => {
      const requests = requestsByLeadId.get(String(p.leadId)) || []
      return requests.some((r) => shipperRequestMatchesFilters(r, opts))
    })
  }

  return rows
}

const vendorFields = (request) => {
  const v = request.vendorId
  if (v && typeof v === 'object') {
    return {
      vendorId: String(v._id || v.id || ''),
      vendorName: v.vendorName || '',
      vendorCode: v.vendorCode || '',
    }
  }
  return {
    vendorId: v ? String(v) : '',
    vendorName: '',
    vendorCode: '',
  }
}

const shipperRequestSearchHaystack = (request) => {
  const { vendorName, vendorCode } = vendorFields(request)
  return [
    vendorName,
    vendorCode,
    request.submittedFileName,
    request.status,
    request.comparisonStatus,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

const shipperRequestMatchesFilters = (request, opts) => {
  if (opts.status && request.status !== opts.status) return false
  if (opts.comparisonStatus && (request.comparisonStatus || 'idle') !== opts.comparisonStatus) {
    return false
  }
  if (opts.vendorId) {
    const { vendorId } = vendorFields(request)
    if (vendorId !== opts.vendorId) return false
  }
  if (opts.hasSubmittedFile === true && !request.submittedFileUrl) return false
  if (opts.hasSubmittedFile === false && request.submittedFileUrl) return false
  if (opts.search && !shipperRequestSearchHaystack(request).includes(opts.search)) return false
  return true
}

const filterShipperRequests = (requests, opts) =>
  requests.filter((r) => shipperRequestMatchesFilters(r, opts))

module.exports = {
  SHIPPER_COMPARISON_STATUSES,
  parseShipperProjectListQuery,
  parseShipperRequestListQuery,
  filterShipperProjects,
  filterShipperRequests,
  paginateArray,
}
