const TRUCK_TYPES = {
  SEMI_53: {
    truckType: 'SEMI_53',
    label: '53 ft Semi',
    maxWeight: 45000,
    hardMaxWeight: 48000,
    maxLengthFeet: 53,
  },

  HOTSHOT_40: {
    truckType: 'HOTSHOT_40',
    label: '40 ft Hot Shot',
    maxWeight: 18000,
    hardMaxWeight: 18000,
    maxLengthFeet: 40,
  },
}

const BUNDLE_LIMITS = {
  maxBundleWeight: 6000,
  preferredBundleWeight: 3500,
  maxBundleLengthFeet: 53,
}

const normalizeText = (value) => String(value || '').trim().toUpperCase()

const isMissingWeight = (value) => {
  const n = Number(value)
  return !Number.isFinite(n) || n <= 0
}

const getPhysicalQty = (line) => {
  if (line.pieceQty != null && Number(line.pieceQty) > 0) {
    return Number(line.pieceQty)
  }

  return Number(line.qty || 0)
}

const classifyBundleType = (line) => {
  const text = normalizeText(`
    ${line.category || ''}
    ${line.partCode || ''}
    ${line.vendorProductCode || ''}
    ${line.description || ''}
  `)

  if (
    text.includes('PANEL') ||
    text.includes('SHEETING') ||
    text.includes('SHEET') ||
    text.includes('R-LOC') ||
    text.includes('RLOC') ||
    text.includes('PLOC') ||
    text.includes('PBR')
  ) {
    return 'panels'
  }

  if (
    text.includes('TRIM') ||
    text.includes('FLASH') ||
    text.includes('GUTTER') ||
    text.includes('DOWNSPOUT') ||
    text.includes('RAKE') ||
    text.includes('JAMB COVER')
  ) {
    return 'trim'
  }

  if (
    text.includes('SCREW') ||
    text.includes('BOLT') ||
    text.includes('FASTENER') ||
    text.includes('ANCHOR') ||
    text.includes('RIVET') ||
    text.includes('WEDGE')
  ) {
    return 'fasteners'
  }

  if (
    text.includes('CEE') ||
    text.includes('ZEE') ||
    text.includes('PURLIN') ||
    text.includes('GIRT') ||
    text.includes('JAMB') ||
    text.includes('HEADER') ||
    text.includes('RAFTER') ||
    /^[CZ]\d+/i.test(line.partCode || line.vendorProductCode || '')
  ) {
    return 'framing'
  }

  if (
    text.includes('INSULATION') ||
    text.includes('SKYLIGHT') ||
    text.includes('ACCESSORY') ||
    text.includes('CLIP') ||
    text.includes('BUTYL') ||
    text.includes('SEALANT') ||
    text.includes('CLOSURE')
  ) {
    return 'accessories'
  }

  return 'mixed'
}

const getLengthBucket = (lengthFeet) => {
  const len = Number(lengthFeet || 0)

  if (!len) return 'NO_LENGTH'
  if (len <= 4) return '0_4'
  if (len <= 8) return '4_8'
  if (len <= 12) return '8_12'
  if (len <= 20) return '12_20'
  if (len <= 30) return '20_30'
  if (len <= 40) return '30_40'
  if (len <= 53) return '40_53'

  return 'OVERSIZE'
}

const getDefaultStackingRules = (bundleType) => {
  switch (bundleType) {
    case 'framing':
      return {
        stackLevel: 'bottom',
        canStackOnTop: true,
        canHaveItemsStackedOnIt: true,
        isFragile: false,
        mustStayFlat: false,
        keepDry: false,
        requiresEdgeProtection: false,
        loadingPriority: 10,
        unloadingPriority: 50,
        stackingNotes: 'Heavy structural bundle. Load low/bottom.',
      }

    case 'panels':
      return {
        stackLevel: 'middle',
        canStackOnTop: false,
        canHaveItemsStackedOnIt: false,
        isFragile: true,
        mustStayFlat: true,
        keepDry: true,
        requiresEdgeProtection: true,
        loadingPriority: 30,
        unloadingPriority: 40,
        stackingNotes: 'Panels must stay flat/protected.',
      }

    case 'trim':
      return {
        stackLevel: 'top',
        canStackOnTop: false,
        canHaveItemsStackedOnIt: false,
        isFragile: true,
        mustStayFlat: true,
        keepDry: true,
        requiresEdgeProtection: true,
        loadingPriority: 70,
        unloadingPriority: 20,
        stackingNotes: 'Trim should not be crushed.',
      }

    case 'fasteners':
      return {
        stackLevel: 'top',
        canStackOnTop: true,
        canHaveItemsStackedOnIt: false,
        isFragile: false,
        mustStayFlat: false,
        keepDry: true,
        requiresEdgeProtection: false,
        loadingPriority: 80,
        unloadingPriority: 10,
        stackingNotes: 'Small boxed items.',
      }

    case 'accessories':
      return {
        stackLevel: 'top',
        canStackOnTop: false,
        canHaveItemsStackedOnIt: false,
        isFragile: true,
        mustStayFlat: false,
        keepDry: true,
        requiresEdgeProtection: false,
        loadingPriority: 75,
        unloadingPriority: 15,
        stackingNotes: 'Accessory bundle. Verify manually.',
      }

    default:
      return {
        stackLevel: 'any',
        canStackOnTop: true,
        canHaveItemsStackedOnIt: true,
        isFragile: false,
        mustStayFlat: false,
        keepDry: false,
        requiresEdgeProtection: false,
        loadingPriority: 50,
        unloadingPriority: 50,
        stackingNotes: '',
      }
  }
}

const buildBundleKey = (line) => {
  const type = classifyBundleType(line)
  const color = normalizeText(line.colorNormalized || line.color || 'NO_COLOR')
  const part = normalizeText(line.partCode || line.vendorProductCode || 'NO_PART')
  const lengthBucket = getLengthBucket(line.lengthFeet)

  /**
   * Fasteners/accessories can be grouped more loosely.
   * Framing/panels/trim should include part grouping to avoid bad mixed bundles.
   */
  if (['fasteners', 'accessories'].includes(type)) {
    return `${type}|${color}`
  }

  return `${type}|${color}|${part}|${lengthBucket}`
}

const toBundleItem = (line) => {
  const weightMissing = isMissingWeight(line.weight)

  return {
    vendorQuoteLineId: line._id,

    partCode: line.partCode || line.vendorProductCode || '',
    description: line.description || '',
    category: line.category || '',
    color: line.color || '',

    qty: getPhysicalQty(line),

    lengthFeet: line.lengthFeet || null,
    widthFeet: line.widthFeet || null,
    heightFeet: line.heightFeet || null,

    weight: weightMissing ? 0 : Number(line.weight || 0),

    markIds: line.pieceMark ? [line.pieceMark] : [],

    sourceLineSnapshot: {
      _id: line._id,
      vendorLineNo: line.vendorLineNo,
      extractionFormat: line.extractionFormat,

      qty: line.qty,
      pieceQty: line.pieceQty,
      totalLinearFeet: line.totalLinearFeet,
      uom: line.uom,

      partCode: line.partCode,
      vendorProductCode: line.vendorProductCode,
      description: line.description,
      color: line.color,

      lengthText: line.lengthText,
      lengthFeet: line.lengthFeet,

      weight: line.weight,
      weightMissing,

      pieceMark: line.pieceMark,
      warnings: line.warnings || [],
    },
  }
}

const getBundleWarnings = (bundle) => {
  const warnings = []

  const missingWeightItems = (bundle.items || []).filter((item) => {
    return item.sourceLineSnapshot?.weightMissing === true
  })

  if (missingWeightItems.length > 0) {
    warnings.push(
      `${missingWeightItems.length} item(s) in this bundle have missing/zero weight. Bundle weight and truck plan may be inaccurate.`
    )
  }

  if ((bundle.totalWeight || 0) <= 0) {
    warnings.push('Bundle has no valid weight. Truck/load plan is not trustworthy until weight is reviewed.')
  }

  if (bundle.maxLengthFeet > 53) {
    warnings.push('Bundle length exceeds 53 ft truck limit')
  }

  if (bundle.totalWeight > BUNDLE_LIMITS.maxBundleWeight) {
    warnings.push('Bundle exceeds recommended 6,000 lbs weight')
  }

  if (bundle.stacking.keepDry) {
    warnings.push('Keep dry')
  }

  if (bundle.stacking.requiresEdgeProtection) {
    warnings.push('Edge protection required')
  }

  if (bundle.stacking.mustStayFlat) {
    warnings.push('Must stay flat')
  }

  if (bundle.stacking.canHaveItemsStackedOnIt === false) {
    warnings.push('Do not stack other bundles on this bundle')
  }

  return [...new Set(warnings)]
}

const createEmptyBundle = (counter, bundleType) => ({
  bundleNo: `B-${String(counter).padStart(3, '0')}`,
  bundleType,
  title: `${bundleType.toUpperCase()} Bundle`,
  items: [],

  totalQty: 0,
  totalWeight: 0,
  maxLengthFeet: 0,
  estimatedWidthFeet: 0,
  estimatedHeightFeet: 0,

  packingListId: null,

  stacking: getDefaultStackingRules(bundleType),

  loadSequence: null,
  handlingInstruction: '',
  warnings: [],
  notes: '',

  status: 'draft',
})

const finalizeBundle = (bundle) => ({
  ...bundle,
  warnings: getBundleWarnings(bundle),
})

const assignLoadSequence = (bundles) => {
  return [...bundles]
    .sort(
      (a, b) =>
        (a.stacking?.loadingPriority || 50) - (b.stacking?.loadingPriority || 50) ||
        (b.totalWeight || 0) - (a.totalWeight || 0) ||
        (b.maxLengthFeet || 0) - (a.maxLengthFeet || 0)
    )
    .map((bundle, index) => ({
      ...bundle,
      loadSequence: index + 1,
    }))
}

const generateBundlesFromVendorLines = (vendorLines) => {
  const groups = new Map()

  for (const line of vendorLines) {
    const key = buildBundleKey(line)

    if (!groups.has(key)) {
      groups.set(key, [])
    }

    groups.get(key).push(line)
  }

  const bundles = []
  let counter = 1

  for (const [key, lines] of groups.entries()) {
    const bundleType = key.split('|')[0]

    const sorted = [...lines].sort(
      (a, b) =>
        (b.lengthFeet || 0) - (a.lengthFeet || 0) ||
        (b.weight || 0) - (a.weight || 0)
    )

    let bundle = createEmptyBundle(counter++, bundleType)

    for (const line of sorted) {
      const item = toBundleItem(line)

      const lineWeight = Number(item.weight || 0)
      const lineLength = Number(item.lengthFeet || 0)

      const exceedsWeight =
        bundle.items.length > 0 &&
        bundle.totalWeight + lineWeight > BUNDLE_LIMITS.maxBundleWeight

      const exceedsLength =
        Math.max(bundle.maxLengthFeet, lineLength) > BUNDLE_LIMITS.maxBundleLengthFeet

      if (exceedsWeight || exceedsLength) {
        bundles.push(finalizeBundle(bundle))
        bundle = createEmptyBundle(counter++, bundleType)
      }

      bundle.items.push(item)

      bundle.totalQty += Number(item.qty || 0)
      bundle.totalWeight += lineWeight
      bundle.maxLengthFeet = Math.max(bundle.maxLengthFeet, lineLength)

      bundle.estimatedWidthFeet = Math.max(
        bundle.estimatedWidthFeet || 0,
        item.widthFeet || 0
      )

      bundle.estimatedHeightFeet = Math.max(
        bundle.estimatedHeightFeet || 0,
        item.heightFeet || 0
      )
    }

    if (bundle.items.length > 0) {
      bundles.push(finalizeBundle(bundle))
    }
  }

  return assignLoadSequence(bundles)
}

const selectTruckTypeForBundle = (bundle) => {
  const weight = Number(bundle.totalWeight || 0)
  const length = Number(bundle.maxLengthFeet || 0)

  /**
   * If weight is zero/missing, do not pretend a truck can be selected accurately.
   * We still allow the packing list generation, but it must carry warnings.
   */
  if (weight <= 0) {
    if (length <= 40) return TRUCK_TYPES.HOTSHOT_40
    if (length <= 53) return TRUCK_TYPES.SEMI_53
    return null
  }

  if (length <= 40 && weight <= 18000) return TRUCK_TYPES.HOTSHOT_40
  if (length <= 53 && weight <= 45000) return TRUCK_TYPES.SEMI_53

  return null
}

const canFitBundleInPackingList = (packingList, bundle) => {
  const newWeight = packingList.totalWeight + Number(bundle.totalWeight || 0)
  const newLength = Math.max(
    packingList.maxLengthFeet || 0,
    bundle.maxLengthFeet || 0
  )

  return (
    newWeight <= packingList.maxTruckWeight &&
    newLength <= packingList.maxTruckLengthFeet
  )
}

const createEmptyPackingList = (counter, truckConfig) => ({
  packingListNo: `PL-${String(counter).padStart(3, '0')}`,
  truckNo: `TRUCK-${counter}`,

  truckType: truckConfig.truckType,
  truckLabel: truckConfig.label,

  maxTruckWeight: truckConfig.maxWeight,
  hardMaxTruckWeight: truckConfig.hardMaxWeight,
  maxTruckLengthFeet: truckConfig.maxLengthFeet,

  bundleIds: [],
  bundles: [],

  totalBundles: 0,
  totalItems: 0,
  totalWeight: 0,
  maxLengthFeet: 0,

  loadLayout: {
    bottomLayerBundleIds: [],
    middleLayerBundleIds: [],
    topLayerBundleIds: [],
    loadingNotes: '',
  },

  warnings: [],
  status: 'draft',
})

const addBundleToPackingList = (packingList, bundle) => {
  packingList.bundleIds.push(bundle._id)
  packingList.bundles.push(bundle)

  packingList.totalBundles += 1
  packingList.totalItems += bundle.items?.length || 0
  packingList.totalWeight += Number(bundle.totalWeight || 0)
  packingList.maxLengthFeet = Math.max(
    packingList.maxLengthFeet || 0,
    bundle.maxLengthFeet || 0
  )
}

const assignPackingListLayers = (bundles) => {
  const layout = {
    bottomLayerBundleIds: [],
    middleLayerBundleIds: [],
    topLayerBundleIds: [],
    loadingNotes: 'Heavy framing at bottom, panels protected, trim/accessories on top.',
  }

  for (const bundle of assignLoadSequence(bundles)) {
    const level = bundle.stacking?.stackLevel || 'any'

    if (level === 'bottom') {
      layout.bottomLayerBundleIds.push(bundle._id)
    } else if (level === 'middle') {
      layout.middleLayerBundleIds.push(bundle._id)
    } else if (level === 'top') {
      layout.topLayerBundleIds.push(bundle._id)
    } else if ((bundle.totalWeight || 0) > 3000) {
      layout.bottomLayerBundleIds.push(bundle._id)
    } else if (bundle.stacking?.isFragile) {
      layout.topLayerBundleIds.push(bundle._id)
    } else {
      layout.middleLayerBundleIds.push(bundle._id)
    }
  }

  return layout
}

const getPackingListWarnings = (packingList) => {
  const warnings = []

  const bundles = packingList.bundles || []

  const missingWeightBundles = bundles.filter((bundle) => {
    return (
      (bundle.warnings || []).some((warning) =>
        String(warning).toLowerCase().includes('missing/zero weight')
      ) ||
      (bundle.totalWeight || 0) <= 0
    )
  })

  if (missingWeightBundles.length > 0) {
    warnings.push(
      `${missingWeightBundles.length} bundle(s) have missing/zero weight. Truck weight calculation may be inaccurate.`
    )
  }

  if (packingList.totalWeight <= 0) {
    warnings.push('Packing list has no valid total weight. Truck selection must be manually reviewed.')
  }

  if (packingList.totalWeight > packingList.maxTruckWeight) {
    warnings.push(
      `Truck exceeds safe weight capacity by ${packingList.totalWeight - packingList.maxTruckWeight} lbs`
    )
  }

  if (
    packingList.hardMaxTruckWeight &&
    packingList.totalWeight > packingList.hardMaxTruckWeight
  ) {
    warnings.push(
      `Truck exceeds hard maximum weight by ${packingList.totalWeight - packingList.hardMaxTruckWeight} lbs`
    )
  }

  if (
    packingList.totalWeight > 0 &&
    packingList.totalWeight > packingList.maxTruckWeight * 0.95
  ) {
    warnings.push('Truck is above 95% safe capacity')
  }

  if (packingList.maxLengthFeet > packingList.maxTruckLengthFeet) {
    warnings.push(
      `Bundle length exceeds truck length by ${packingList.maxLengthFeet - packingList.maxTruckLengthFeet} ft`
    )
  }

  for (const bundle of bundles) {
    warnings.push(
      ...(bundle.warnings || []).map((warning) => `${bundle.bundleNo}: ${warning}`)
    )
  }

  return [...new Set(warnings)]
}

const finalizePackingLists = (packingLists) => {
  return packingLists.map((packingList) => {
    packingList.loadLayout = assignPackingListLayers(packingList.bundles || [])
    packingList.warnings = getPackingListWarnings(packingList)

    delete packingList.bundles

    return packingList
  })
}

const generateMixedTruckPackingLists = (bundles) => {
  const sorted = [...bundles].sort(
    (a, b) =>
      (b.maxLengthFeet || 0) - (a.maxLengthFeet || 0) ||
      (b.totalWeight || 0) - (a.totalWeight || 0)
  )

  const packingLists = []
  let counter = 1

  for (const bundle of sorted) {
    let placed = false

    for (const packingList of packingLists) {
      if (canFitBundleInPackingList(packingList, bundle)) {
        addBundleToPackingList(packingList, bundle)
        placed = true
        break
      }
    }

    if (placed) continue

    const truckConfig = selectTruckTypeForBundle(bundle)

    if (!truckConfig) {
      throw new Error(
        `No truck can carry bundle ${bundle.bundleNo}. Weight=${bundle.totalWeight}, Length=${bundle.maxLengthFeet}`
      )
    }

    const packingList = createEmptyPackingList(counter++, truckConfig)
    addBundleToPackingList(packingList, bundle)
    packingLists.push(packingList)
  }

  return finalizePackingLists(packingLists)
}

const recalculateBundleMetrics = (bundle) => {
  const items = bundle.items || []

  let totalQty = 0
  let totalWeight = 0
  let maxLengthFeet = 0
  let estimatedWidthFeet = 0
  let estimatedHeightFeet = 0

  for (const item of items) {
    totalQty += Number(item.qty || 0)
    totalWeight += Number(item.weight || 0)
    maxLengthFeet = Math.max(maxLengthFeet, Number(item.lengthFeet || 0))
    estimatedWidthFeet = Math.max(estimatedWidthFeet, Number(item.widthFeet || 0))
    estimatedHeightFeet = Math.max(estimatedHeightFeet, Number(item.heightFeet || 0))
  }

  return finalizeBundle({
    ...bundle,
    totalQty,
    totalWeight,
    maxLengthFeet,
    estimatedWidthFeet,
    estimatedHeightFeet,
  })
}

const aggregateBundlePlanSummary = (bundles = []) => {
  const totalBundles = bundles.length
  const totalWeight = bundles.reduce((sum, bundle) => sum + Number(bundle.totalWeight || 0), 0)
  const maxLengthFeet = bundles.reduce(
    (max, bundle) => Math.max(max, Number(bundle.maxLengthFeet || 0)),
    0
  )
  const warnings = [...new Set(bundles.flatMap((bundle) => bundle.warnings || []))]

  return { totalBundles, totalWeight, maxLengthFeet, warnings }
}

module.exports = {
  TRUCK_TYPES,
  BUNDLE_LIMITS,

  generateBundlesFromVendorLines,
  generateMixedTruckPackingLists,

  assignLoadSequence,
  assignPackingListLayers,
  recalculateBundleMetrics,
  aggregateBundlePlanSummary,

  classifyBundleType,
  getPhysicalQty,
  getBundleWarnings,
}