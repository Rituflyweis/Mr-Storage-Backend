const buildLoadAndBundleSummary = (delivery, loadDetails) => {
  const { bundlePlan, packingLists } = loadDetails || {}
  const truckNumber = (packingLists || [])
    .map((pl) => pl.truckLabel || pl.truckNo)
    .filter(Boolean)
    .join(', ') || null

  return {
    loadId: bundlePlan?.planNumber || delivery.deliveryNumber || '',
    bundleCount: bundlePlan?.totalBundles ?? null,
    truckNumber,
    totalWeight: bundlePlan?.totalWeight ?? delivery.loadWeight ?? null,
  }
}

const buildPackingListSummary = (delivery, loadDetails) => {
  const bundles = loadDetails?.bundles || []
  const totalParts = bundles.reduce((s, b) => s + (b.totalQty || 0), 0)
  const bundleTypes = new Set(bundles.map((b) => b.bundleType).filter(Boolean)).size

  return {
    totalParts: totalParts || null,
    bundleTypes: bundleTypes || null,
    material: delivery.materialType || bundles[0]?.bundleType || '',
  }
}

/** Shape expected by utils/exportDelivery PDF generators. */
const mapDeliveryForPdfExport = (delivery, lead, carrier, loadDetails) => {
  const siteContact = {
    name: delivery.receivingPoc || '',
    phone: delivery.pickupContactPhone || '',
    email: delivery.receivingPocEmail || '',
  }
  const deliveryCompany = carrier
    ? {
        name: carrier.carrierName || '',
        driver: carrier.contactName || '',
        phone: carrier.phone || '',
        email: carrier.email || '',
      }
    : null

  return {
    deliveryId: delivery._id,
    deliveryNumber: delivery.deliveryNumber,
    status: delivery.status,
    deliveryDate: delivery.deliveryDate,
    timings: delivery.timings || '',
    estimatedWeight: delivery.loadWeight || null,
    loadingEquipment: delivery.loadingEquipment || [],
    siteContact,
    siteInstructions: delivery.specialRequirements || '',
    specialNotes: delivery.additionalNotes || '',
    deliveryCompany,
    loadAndBundle: buildLoadAndBundleSummary(delivery, loadDetails),
    packingListSummary: buildPackingListSummary(delivery, loadDetails),
    project: {
      leadId: lead?._id || delivery.leadId,
      projectId: lead?.jobId || '',
      projectName: lead?.projectName || '',
    },
  }
}

module.exports = { mapDeliveryForPdfExport }
