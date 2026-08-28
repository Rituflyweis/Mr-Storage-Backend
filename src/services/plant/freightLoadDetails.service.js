const Bundle = require('../../models/Bundle')
const BundlePlan = require('../../models/BundlePlan')
const PackingList = require('../../models/PackingList')
const PackingListPlan = require('../../models/PackingListPlan')

const round2 = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100) / 100
}

const DEFAULT_FREIGHT_WIDTH_FEET = 8.5
const DEFAULT_FREIGHT_HEIGHT_FEET = 8
const HOTSHOT_FREIGHT_WIDTH_FEET = 8

const resolveBundleItemEnvelope = (bundle) => {
  let widthFeet = Number(bundle.estimatedWidthFeet || 0)
  let heightFeet = Number(bundle.estimatedHeightFeet || 0)

  for (const item of bundle.items || []) {
    widthFeet = Math.max(widthFeet, Number(item.widthFeet || 0))
    heightFeet = Math.max(heightFeet, Number(item.heightFeet || 0))
  }

  return { widthFeet, heightFeet }
}

const computeFreightEnvelopeDimensions = (bundles = [], packingLists = []) => {
  const maxLengthFeet = bundles.reduce(
    (max, row) => Math.max(max, Number(row.maxLengthFeet || 0)),
    0
  )

  let maxWidthFeet = 0
  let maxHeightFeet = 0
  for (const bundle of bundles) {
    const envelope = resolveBundleItemEnvelope(bundle)
    maxWidthFeet = Math.max(maxWidthFeet, envelope.widthFeet)
    maxHeightFeet = Math.max(maxHeightFeet, envelope.heightFeet)
  }

  if (!maxWidthFeet || !maxHeightFeet) {
    const truckTypes = packingLists.map((row) => row.truckType).filter(Boolean)
    const hotshotOnly =
      truckTypes.length > 0 && truckTypes.every((type) => type === 'HOTSHOT_40')

    if (!maxWidthFeet) {
      maxWidthFeet = hotshotOnly ? HOTSHOT_FREIGHT_WIDTH_FEET : DEFAULT_FREIGHT_WIDTH_FEET
    }
    if (!maxHeightFeet) {
      maxHeightFeet = DEFAULT_FREIGHT_HEIGHT_FEET
    }
  }

  return {
    lengthFeet: maxLengthFeet,
    widthFeet: maxWidthFeet,
    heightFeet: maxHeightFeet,
  }
}

const mapFreightBundleRow = (bundle) => {
  const envelope = resolveBundleItemEnvelope(bundle)

  return {
    _id: bundle._id,
    bundleNo: bundle.bundleNo,
    bundleType: bundle.bundleType,
    title: bundle.title || '',
    totalQty: bundle.totalQty,
    totalWeight: round2(bundle.totalWeight),
    maxLengthFeet: round2(bundle.maxLengthFeet),
    estimatedWidthFeet: round2(envelope.widthFeet || bundle.estimatedWidthFeet),
    estimatedHeightFeet: round2(envelope.heightFeet || bundle.estimatedHeightFeet),
    itemCount: bundle.items?.length || 0,
    loadSequence: bundle.loadSequence,
    status: bundle.status,
    packingListId: bundle.packingListId || null,
    warnings: bundle.warnings || [],
  }
}

const mapFreightPackingListRow = (packingList) => ({
  _id: packingList._id,
  packingListNo: packingList.packingListNo,
  truckNo: packingList.truckNo,
  truckType: packingList.truckType,
  truckLabel: packingList.truckLabel || '',
  totalBundles: packingList.totalBundles,
  totalWeight: round2(packingList.totalWeight),
  maxLengthFeet: round2(packingList.maxLengthFeet),
  maxTruckWeight: round2(packingList.maxTruckWeight),
  maxTruckLengthFeet: round2(packingList.maxTruckLengthFeet),
  bundleIds: packingList.bundleIds || [],
  warnings: packingList.warnings || [],
  status: packingList.status,
})

const mapFreightBundlePlanSummary = (bundlePlan) =>
  bundlePlan
    ? {
        _id: bundlePlan._id,
        planNumber: bundlePlan.planNumber || '',
        status: bundlePlan.status,
        totalBundles: bundlePlan.totalBundles,
        totalWeight: round2(bundlePlan.totalWeight),
        maxLengthFeet: round2(bundlePlan.maxLengthFeet),
      }
    : null

const mapFreightPackingListPlanSummary = (packingListPlan) =>
  packingListPlan
    ? {
        _id: packingListPlan._id,
        planNumber: packingListPlan.planNumber || '',
        status: packingListPlan.status,
        totalPackingLists: packingListPlan.totalPackingLists,
        totalBundles: packingListPlan.totalBundles,
        totalWeight: round2(packingListPlan.totalWeight),
        maxLengthFeet: round2(packingListPlan.maxLengthFeet),
        truckSummary: packingListPlan.truckSummary || null,
      }
    : null

const loadFreightLoadDetailsForBundlePlan = async (bundlePlan) => {
  if (!bundlePlan) {
    return {
      bundlePlan: null,
      packingListPlan: null,
      bundles: [],
      packingLists: [],
    }
  }

  const [packingListPlan, bundles, packingLists] = await Promise.all([
    PackingListPlan.findOne({ bundlePlanId: bundlePlan._id }).lean(),
    Bundle.find({ bundlePlanId: bundlePlan._id }).sort({ loadSequence: 1, bundleNo: 1 }).lean(),
    PackingList.find({ bundlePlanId: bundlePlan._id }).sort({ truckNo: 1, packingListNo: 1 }).lean(),
  ])

  return {
    bundlePlan: mapFreightBundlePlanSummary(bundlePlan),
    packingListPlan: mapFreightPackingListPlanSummary(packingListPlan),
    bundles: bundles.map(mapFreightBundleRow),
    packingLists: packingLists.map(mapFreightPackingListRow),
  }
}

const loadFreightLoadDetailsByLeadId = async (leadId) => {
  const bundlePlan = await BundlePlan.findOne({ leadId, status: { $ne: 'cancelled' } })
    .sort({ updatedAt: -1 })
    .lean()

  return loadFreightLoadDetailsForBundlePlan(bundlePlan)
}

const loadFreightLoadDetailsByBundlePlanId = async (bundlePlanId) => {
  const bundlePlan = await BundlePlan.findById(bundlePlanId).lean()
  return loadFreightLoadDetailsForBundlePlan(bundlePlan)
}

const escapeHtml = (str) => {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const formatFreightLoadDetailsText = ({ bundles = [], packingLists = [] } = {}) => {
  const lines = []

  if (packingLists.length) {
    lines.push('Packing lists / trucks:')
    for (const row of packingLists) {
      lines.push(
        `  - ${row.packingListNo || row._id}: ${row.truckType || ''} (${row.truckLabel || row.truckNo || ''}), ` +
          `${row.totalBundles || 0} bundle(s), ${row.totalWeight ?? '—'} lbs, max length ${row.maxLengthFeet ?? '—'} ft`
      )
    }
    lines.push('')
  }

  if (bundles.length) {
    lines.push('Bundles:')
    for (const row of bundles) {
      lines.push(
        `  - ${row.bundleNo || ''}: ${row.bundleType || ''} — ${row.title || 'Untitled'}, ` +
          `qty ${row.totalQty ?? '—'}, ${row.totalWeight ?? '—'} lbs, max length ${row.maxLengthFeet ?? '—'} ft`
      )
    }
  }

  if (!lines.length) return 'No bundle or packing list details available.'

  return lines.join('\n')
}

const formatFreightLoadDetailsHtml = ({ bundles = [], packingLists = [] } = {}) => {
  if (!packingLists.length && !bundles.length) {
    return '<p><em>No bundle or packing list details available.</em></p>'
  }

  let html = ''

  if (packingLists.length) {
    const plRows = packingLists
      .map((row) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.packingListNo)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.truckType)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.truckLabel || row.truckNo)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${row.totalBundles ?? '—'}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${row.totalWeight ?? '—'}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${row.maxLengthFeet ?? '—'}</td>
        </tr>`)
      .join('')

    html += `
      <h3 style="margin:20px 0 8px;font-size:15px">Packing lists / trucks</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px;text-align:left">PL #</th>
            <th style="padding:8px;text-align:left">Truck type</th>
            <th style="padding:8px;text-align:left">Truck</th>
            <th style="padding:8px;text-align:right">Bundles</th>
            <th style="padding:8px;text-align:right">Weight (lbs)</th>
            <th style="padding:8px;text-align:right">Max length (ft)</th>
          </tr>
        </thead>
        <tbody>${plRows}</tbody>
      </table>`
  }

  if (bundles.length) {
    const bundleRows = bundles
      .map((row) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.bundleNo)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.bundleType)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(row.title || '—')}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${row.totalQty ?? '—'}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${row.totalWeight ?? '—'}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${row.maxLengthFeet ?? '—'}</td>
        </tr>`)
      .join('')

    html += `
      <h3 style="margin:20px 0 8px;font-size:15px">Bundles</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px;text-align:left">Bundle #</th>
            <th style="padding:8px;text-align:left">Type</th>
            <th style="padding:8px;text-align:left">Title</th>
            <th style="padding:8px;text-align:right">Qty</th>
            <th style="padding:8px;text-align:right">Weight (lbs)</th>
            <th style="padding:8px;text-align:right">Max length (ft)</th>
          </tr>
        </thead>
        <tbody>${bundleRows}</tbody>
      </table>`
  }

  return html
}

module.exports = {
  computeFreightEnvelopeDimensions,
  mapFreightBundleRow,
  mapFreightPackingListRow,
  loadFreightLoadDetailsByLeadId,
  loadFreightLoadDetailsByBundlePlanId,
  formatFreightLoadDetailsHtml,
  formatFreightLoadDetailsText,
}
