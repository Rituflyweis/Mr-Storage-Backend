const Lead = require('../models/Lead')

/** UI sort keys shared across construction logistics lists */
const CONSTRUCTION_SORT_BY = ['Latest', 'Oldest', 'Weight', 'BundleNo', 'PackingListNo', 'DeliveryDate']

const parseSortBy = (sortBy, fieldMap) => {
  const key = sortBy && CONSTRUCTION_SORT_BY.includes(sortBy) ? sortBy : 'Latest'
  return fieldMap[key] || fieldMap.Latest
}

const bundleSortMap = {
  Latest: { createdAt: -1 },
  Oldest: { createdAt: 1 },
  Weight: { totalWeight: -1 },
  BundleNo: { bundleNo: 1 },
  PackingListNo: { createdAt: -1 },
  DeliveryDate: { createdAt: -1 },
}

const packingListSortMap = {
  Latest: { createdAt: -1 },
  Oldest: { createdAt: 1 },
  Weight: { totalWeight: -1 },
  PackingListNo: { packingListNo: 1 },
  BundleNo: { createdAt: -1 },
  DeliveryDate: { createdAt: -1 },
}

const dispatchSortMap = {
  Latest: { updatedAt: -1 },
  Oldest: { updatedAt: 1 },
  Weight: { totalWeight: -1 },
  PackingListNo: { packingListNo: 1 },
  BundleNo: { updatedAt: -1 },
  DeliveryDate: { updatedAt: -1 },
}

const deliverySortMap = {
  Latest: { deliveryDate: -1 },
  Oldest: { deliveryDate: 1 },
  Weight: { loadWeight: -1 },
  DeliveryDate: { deliveryDate: -1 },
  BundleNo: { deliveryDate: -1 },
  PackingListNo: { deliveryDate: -1 },
}

/** Bundle scan screen — UI status pills (not always 1:1 with BUNDLE_STATUSES). */
const BUNDLE_SCAN_UI_STATUSES = ['pending', 'staged', 'on_truck', 'loaded', 'all']

const bundleScanStatusToDb = (status) => {
  switch (status) {
    case 'pending':
      return ['draft', 'confirmed']
    case 'staged':
      return ['staged']
    case 'on_truck':
      return ['assigned_to_truck']
    case 'loaded':
      return ['loaded']
    case 'all':
    default:
      return ['draft', 'confirmed', 'assigned_to_truck', 'staged', 'loaded']
  }
}

/** Label printing — optional label print state filter */
const LABEL_UI_STATUSES = ['pending', 'printed', 'all']

const labelStatusToFilter = (status) => {
  if (status === 'printed') return { labelPrinted: true }
  if (status === 'pending') return { labelPrinted: { $ne: true } }
  return {}
}

/** Dispatch verification — UI status */
const DISPATCH_VERIFICATION_UI_STATUSES = ['pending', 'verified', 'dispatched', 'all']

const dispatchVerificationStatusFilter = (status) => {
  switch (status) {
    case 'pending':
      return { $or: [{ weightVerified: { $ne: true } }, { loadingVerified: { $ne: true } }] }
    case 'verified':
      return { weightVerified: true, loadingVerified: true, status: { $ne: 'dispatched' } }
    case 'dispatched':
      return { status: 'dispatched' }
    case 'all':
    default:
      return {}
  }
}

const appendLeadProjectSearch = async (filter, search, leadIdField = 'leadId') => {
  const term = search?.trim()
  if (!term) return
  const regex = { $regex: term, $options: 'i' }
  const leadIds = await Lead.find({ $or: [{ projectName: regex }, { jobId: regex }] })
    .distinct('_id')
  const orClause = [{ bundleNo: regex }, { title: regex }]
  if (leadIds.length) orClause.push({ [leadIdField]: { $in: leadIds } })
  if (filter.$or) {
    filter.$and = [...(filter.$and || []), { $or: filter.$or }, { $or: orClause }]
    delete filter.$or
  } else {
    filter.$or = orClause
  }
}

const appendPackingListSearch = (filter, search) => {
  const term = search?.trim()
  if (!term) return
  const regex = { $regex: term, $options: 'i' }
  filter.$or = [
    { packingListNo: regex },
    { truckLabel: regex },
    { truckNo: regex },
    { deliveryLocation: regex },
  ]
}

module.exports = {
  CONSTRUCTION_SORT_BY,
  BUNDLE_SCAN_UI_STATUSES,
  LABEL_UI_STATUSES,
  DISPATCH_VERIFICATION_UI_STATUSES,
  parseSortBy,
  bundleSortMap,
  packingListSortMap,
  dispatchSortMap,
  deliverySortMap,
  bundleScanStatusToDb,
  labelStatusToFilter,
  dispatchVerificationStatusFilter,
  appendLeadProjectSearch,
  appendPackingListSearch,
}
