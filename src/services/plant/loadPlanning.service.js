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

const WEIGHT_BASIS = {
  EXPLICIT_TOTAL: 'EXPLICIT_TOTAL_WEIGHT',
  EXPLICIT_UNIT: 'EXPLICIT_UNIT_WEIGHT',
  LEGACY_TOTAL_ASSUMED: 'LEGACY_TOTAL_ASSUMED',
  LEGACY_UNIT_LF_ASSUMED: 'LEGACY_UNIT_LF_ASSUMED',
  LEGACY_UNIT_EA_ASSUMED: 'LEGACY_UNIT_EA_ASSUMED',
  PRICE_OR_COST_DETECTED: 'PRICE_OR_COST_DETECTED',
  MISSING: 'MISSING',
}

const normalizeText = (value) => String(value || '').trim().toUpperCase()

const toNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback

  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const roundNumber = (value, decimals = 4) => {
  const n = toNumber(value, 0)
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

const approxEqual = (a, b, tolerance = 0.02) => {
  const x = toNumber(a, NaN)
  const y = toNumber(b, NaN)

  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  if (x === 0 && y === 0) return true
  if (x === 0 || y === 0) return false

  return Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y)) <= tolerance
}

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

const getUom = (line) => normalizeText(line.uom)

const getPriceUnit = (line) => normalizeText(line.priceUnit)

const getSafeTotalLinearFeet = (line) => {
  const uom = getUom(line)

  // Some extracted EA rows incorrectly carry qty into totalLinearFeet.
  // Do not let that fake LF value drive weight multiplication.
  if (uom === 'EA' || uom === 'EACH' || uom === 'PCS' || uom === 'PIECES') {
    return 0
  }

  return toNumber(line.totalLinearFeet, 0)
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

  if (['fasteners', 'accessories'].includes(type)) {
    return `${type}|${color}`
  }

  return `${type}|${color}|${part}|${lengthBucket}`
}

const hasMoneyLikeRawKeys = (line) => {
  const rawRow = line.rawRow || {}
  const keys = Object.keys(rawRow).join(' ')
  const text = normalizeText(`${keys} ${line.rawText || ''}`)

  return (
    text.includes('UNIT COST') ||
    text.includes('TOTAL COST') ||
    text.includes('UNIT PRICE') ||
    text.includes('TOTAL PRICE') ||
    text.includes('AMOUNT') ||
    text.includes('EXTENDED')
  )
}

const looksLikePriceOrCost = (line, rawWeight) => {
  const weight = toNumber(rawWeight, 0)
  const unitPrice = toNumber(line.unitPrice, 0)
  const amount = toNumber(line.amount, 0)
  const qty = toNumber(line.qty, 0)
  const pieceQty = toNumber(line.pieceQty, 0)
  const totalLinearFeet = getSafeTotalLinearFeet(line)
  const uom = getUom(line)
  const priceUnit = getPriceUnit(line)

  if (!weight || weight <= 0) return false

  if (unitPrice > 0 && approxEqual(weight, unitPrice, 0.001)) return true
  if (amount > 0 && approxEqual(weight, amount, 0.001)) return true

  if (amount > 0 && totalLinearFeet > 0 && approxEqual(weight * totalLinearFeet, amount, 0.03)) {
    return true
  }

  if (amount > 0 && qty > 0 && approxEqual(weight * qty, amount, 0.03)) {
    return true
  }

  if (amount > 0 && pieceQty > 0 && approxEqual(weight * pieceQty, amount, 0.03)) {
    return true
  }

  if (
    hasMoneyLikeRawKeys(line) &&
    (priceUnit === 'EA' || priceUnit === 'FT' || priceUnit === 'LF' || priceUnit === 'LB') &&
    (unitPrice > 0 || amount > 0)
  ) {
    return true
  }

  if (
    normalizeText(line.extractionFormat) === 'CENTRAL_STATES' &&
    (unitPrice > 0 || amount > 0) &&
    (uom === 'LF' || priceUnit === 'LF' || priceUnit === 'FT')
  ) {
    return true
  }

  return false
}

const getWeightMultiplier = (line) => {
  const uom = getUom(line)
  const priceUnit = getPriceUnit(line)
  const qty = toNumber(line.qty, 0)
  const pieceQty = toNumber(line.pieceQty, 0)
  const totalLinearFeet = getSafeTotalLinearFeet(line)
  const lengthFeet = toNumber(line.lengthFeet, 0)

  if (uom === 'LF' || priceUnit === 'LF' || priceUnit === 'FT') {
    if (totalLinearFeet > 0) return totalLinearFeet
    if (pieceQty > 0 && lengthFeet > 0) return pieceQty * lengthFeet
    if (qty > 0) return qty
  }

  if (pieceQty > 0) return pieceQty
  if (qty > 0) return qty

  return 1
}

const isHighQuantityEachLine = (line) => {
  const uom = getUom(line)
  const priceUnit = getPriceUnit(line)
  const qty = toNumber(line.qty, 0)
  const pieceQty = toNumber(line.pieceQty, 0)

  return (
    uom === 'EA' ||
    uom === 'EACH' ||
    uom === 'PCS' ||
    uom === 'PIECES' ||
    priceUnit === 'EA' ||
    qty >= 100 ||
    pieceQty >= 100
  )
}

const resolveBundleItemWeight = (line) => {
  const warnings = []

  // Future-safe support. These fields are not required by your current schema,
  // but this lets the service work correctly if extractor starts sending them later.
  const explicitTotalWeight = toNumber(line.totalWeight, 0)
  if (explicitTotalWeight > 0) {
    return {
      rawWeight: toNumber(line.weight, 0),
      resolvedWeight: roundNumber(explicitTotalWeight),
      multiplier: 1,
      basis: WEIGHT_BASIS.EXPLICIT_TOTAL,
      confidence: 1,
      warnings,
    }
  }

  const explicitUnitWeight = toNumber(line.unitWeight, 0)
  if (explicitUnitWeight > 0) {
    const multiplier = getWeightMultiplier(line)

    return {
      rawWeight: toNumber(line.weight, 0),
      resolvedWeight: roundNumber(explicitUnitWeight * multiplier),
      multiplier,
      basis: WEIGHT_BASIS.EXPLICIT_UNIT,
      confidence: 0.95,
      warnings,
    }
  }

  const rawWeight = toNumber(line.weight, 0)

  if (!rawWeight || rawWeight <= 0) {
    return {
      rawWeight,
      resolvedWeight: 0,
      multiplier: 0,
      basis: WEIGHT_BASIS.MISSING,
      confidence: 0,
      warnings: ['Missing/zero physical weight.'],
    }
  }

  if (looksLikePriceOrCost(line, rawWeight)) {
    return {
      rawWeight,
      resolvedWeight: 0,
      multiplier: 0,
      basis: WEIGHT_BASIS.PRICE_OR_COST_DETECTED,
      confidence: 0,
      warnings: [
        'Ignored weight because the value appears to be quote price/cost, not physical shipping weight.',
      ],
    }
  }

  const multiplier = getWeightMultiplier(line)
  const uom = getUom(line)
  const priceUnit = getPriceUnit(line)

  // EA/high-count rows are usually already a total line/carton weight.
  // Multiplying 48 by 3000 screws would create nonsense.
  if (isHighQuantityEachLine(line)) {
    return {
      rawWeight,
      resolvedWeight: roundNumber(rawWeight),
      multiplier: 1,
      basis: WEIGHT_BASIS.LEGACY_TOTAL_ASSUMED,
      confidence: 0.75,
      warnings: [
        'Legacy weight treated as total line weight because this is an EA/high-quantity item.',
      ],
    }
  }

  // LF rows are the place where your old code failed when a real unit weight was stored.
  // Here we multiply only after price/cost detection has already ruled out quote-cost values.
  if ((uom === 'LF' || priceUnit === 'LF' || priceUnit === 'FT') && multiplier > 1) {
    return {
      rawWeight,
      resolvedWeight: roundNumber(rawWeight * multiplier),
      multiplier,
      basis: WEIGHT_BASIS.LEGACY_UNIT_LF_ASSUMED,
      confidence: 0.65,
      warnings: [
        'Legacy weight treated as unit LF weight and multiplied for bundle planning. Verify extractor is not storing unit cost here.',
      ],
    }
  }

  // Small piece rows can be unit-weight rows. Use multiplier, but keep warning.
  if (multiplier > 1 && multiplier <= 99) {
    return {
      rawWeight,
      resolvedWeight: roundNumber(rawWeight * multiplier),
      multiplier,
      basis: WEIGHT_BASIS.LEGACY_UNIT_EA_ASSUMED,
      confidence: 0.6,
      warnings: [
        'Legacy weight treated as unit item weight and multiplied by quantity. Verify manually.',
      ],
    }
  }

  return {
    rawWeight,
    resolvedWeight: roundNumber(rawWeight),
    multiplier: 1,
    basis: WEIGHT_BASIS.LEGACY_TOTAL_ASSUMED,
    confidence: 0.55,
    warnings: ['Legacy weight basis unclear. Treated as total line weight.'],
  }
}

const toBundleItem = (line) => {
  const weightResolution = resolveBundleItemWeight(line)
  const weightMissing = isMissingWeight(weightResolution.resolvedWeight)

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

    // IMPORTANT:
    // No schema change. This existing field now stores the resolved TOTAL line weight.
    // It is no longer a blind copy of VendorQuoteLine.weight.
    weight: weightMissing ? 0 : Number(weightResolution.resolvedWeight || 0),

    markIds: line.pieceMark ? [line.pieceMark] : [],

    sourceLineSnapshot: {
      _id: line._id,
      vendorLineNo: line.vendorLineNo,
      extractionFormat: line.extractionFormat,

      qty: line.qty,
      pieceQty: line.pieceQty,
      totalLinearFeet: line.totalLinearFeet,
      safeTotalLinearFeet: getSafeTotalLinearFeet(line),
      uom: line.uom,

      partCode: line.partCode,
      vendorProductCode: line.vendorProductCode,
      description: line.description,
      color: line.color,

      lengthText: line.lengthText,
      lengthFeet: line.lengthFeet,

      weight: line.weight,
      rawWeight: weightResolution.rawWeight,
      resolvedWeight: weightResolution.resolvedWeight,
      weightMultiplier: weightResolution.multiplier,
      weightBasis: weightResolution.basis,
      weightConfidence: weightResolution.confidence,
      weightMissing,
      weightWarnings: weightResolution.warnings,

      unitPrice: line.unitPrice,
      priceUnit: line.priceUnit,
      amount: line.amount,

      pieceMark: line.pieceMark,
      warnings: [
        ...(line.warnings || []),
        ...(weightResolution.warnings || []),
      ],
    },
  }
}

const getBundleWarnings = (bundle) => {
  const warnings = []

  const missingWeightItems = (bundle.items || []).filter((item) => {
    return (
      item.sourceLineSnapshot?.weightMissing === true ||
      item.sourceLineSnapshot?.weightBasis === WEIGHT_BASIS.MISSING ||
      item.sourceLineSnapshot?.weightBasis === WEIGHT_BASIS.PRICE_OR_COST_DETECTED ||
      Number(item.weight || 0) <= 0
    )
  })

  if (missingWeightItems.length > 0) {
    warnings.push(
      `${missingWeightItems.length} item(s) in this bundle have missing/invalid physical weight. Bundle weight and truck plan may be inaccurate.`
    )
  }

  const assumedWeightItems = (bundle.items || []).filter((item) => {
    const basis = item.sourceLineSnapshot?.weightBasis
    const confidence = Number(item.sourceLineSnapshot?.weightConfidence || 0)

    return (
      basis === WEIGHT_BASIS.LEGACY_TOTAL_ASSUMED ||
      basis === WEIGHT_BASIS.LEGACY_UNIT_LF_ASSUMED ||
      basis === WEIGHT_BASIS.LEGACY_UNIT_EA_ASSUMED ||
      (confidence > 0 && confidence < 0.8)
    )
  })

  if (assumedWeightItems.length > 0) {
    warnings.push(
      `${assumedWeightItems.length} item(s) use assumed legacy weight basis. Verify before final dispatch.`
    )
  }

  if ((bundle.totalWeight || 0) <= 0) {
    warnings.push(
      'Bundle has no valid physical weight. Truck/load plan is not trustworthy until weight is reviewed.'
    )
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
  totalWeight: roundNumber(bundle.totalWeight || 0),
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

    const sorted = [...lines].sort((a, b) => {
      const aWeight = resolveBundleItemWeight(a).resolvedWeight
      const bWeight = resolveBundleItemWeight(b).resolvedWeight

      return (
        (b.lengthFeet || 0) - (a.lengthFeet || 0) ||
        (bWeight || 0) - (aWeight || 0)
      )
    })

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
  packingList.totalWeight = roundNumber(
    Number(packingList.totalWeight || 0) + Number(bundle.totalWeight || 0)
  )

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
      (bundle.warnings || []).some((warning) => {
        const text = String(warning).toLowerCase()
        return (
          text.includes('missing') ||
          text.includes('invalid physical weight') ||
          text.includes('price/cost') ||
          text.includes('not physical')
        )
      }) ||
      (bundle.totalWeight || 0) <= 0
    )
  })

  if (missingWeightBundles.length > 0) {
    warnings.push(
      `${missingWeightBundles.length} bundle(s) have missing/invalid physical weight. Truck weight calculation may be inaccurate.`
    )
  }

  if (packingList.totalWeight <= 0) {
    warnings.push(
      'Packing list has no valid total physical weight. Truck selection must be manually reviewed.'
    )
  }

  if (packingList.totalWeight > packingList.maxTruckWeight) {
    warnings.push(
      `Truck exceeds safe weight capacity by ${roundNumber(packingList.totalWeight - packingList.maxTruckWeight)} lbs`
    )
  }

  if (
    packingList.hardMaxTruckWeight &&
    packingList.totalWeight > packingList.hardMaxTruckWeight
  ) {
    warnings.push(
      `Truck exceeds hard maximum weight by ${roundNumber(packingList.totalWeight - packingList.hardMaxTruckWeight)} lbs`
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
      `Bundle length exceeds truck length by ${roundNumber(packingList.maxLengthFeet - packingList.maxTruckLengthFeet)} ft`
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
    packingList.totalWeight = roundNumber(packingList.totalWeight || 0)
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
    totalWeight: roundNumber(totalWeight),
    maxLengthFeet,
    estimatedWidthFeet,
    estimatedHeightFeet,
  })
}

const aggregateBundlePlanSummary = (bundles = []) => {
  const totalBundles = bundles.length

  const totalWeight = roundNumber(
    bundles.reduce((sum, bundle) => sum + Number(bundle.totalWeight || 0), 0)
  )

  const maxLengthFeet = bundles.reduce(
    (max, bundle) => Math.max(max, Number(bundle.maxLengthFeet || 0)),
    0
  )

  const warnings = [
    ...new Set(bundles.flatMap((bundle) => bundle.warnings || [])),
  ]

  if (totalWeight <= 0 && totalBundles > 0) {
    warnings.push(
      'Bundle plan has no valid total physical weight. Truck/load planning must be manually reviewed.'
    )
  }

  return {
    totalBundles,
    totalWeight,
    maxLengthFeet,
    warnings: [...new Set(warnings)],
  }
}

module.exports = {
  TRUCK_TYPES,
  BUNDLE_LIMITS,
  WEIGHT_BASIS,

  generateBundlesFromVendorLines,
  generateMixedTruckPackingLists,

  assignLoadSequence,
  assignPackingListLayers,

  recalculateBundleMetrics,
  aggregateBundlePlanSummary,

  classifyBundleType,
  getPhysicalQty,
  getBundleWarnings,
  resolveBundleItemWeight,
}