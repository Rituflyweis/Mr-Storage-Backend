const mapPlantFreightBidRow = (row, { lowestId = null } = {}) => {
  const revisionNote = String(row.resubmitNote || '').trim()

  return {
    bidId: row._id,
    carrierId: row.carrierId?._id || row.carrierId,
    carrierName: row.carrierId?.carrierName || '',
    submittedAt: row.submittedAt,
    carrierNote: row.carrierNotes || '',
    bidAmount: row.quotedAmount != null && Number.isFinite(Number(row.quotedAmount))
      ? Number(row.quotedAmount)
      : null,
    status: row.status,
    isLowest: lowestId ? String(row._id) === lowestId : false,
    resubmitCount: row.resubmitCount || 0,
    resubmitRequestedAt: row.resubmitRequestedAt || null,
    resubmitNote: revisionNote,
    plantNote: revisionNote,
    canRequestResubmit: row.status === 'submitted',
  }
}

const mapSelectedFreightBidDetails = (selectedBidDoc) => {
  if (!selectedBidDoc) return null

  const revisionNote = String(selectedBidDoc.resubmitNote || '').trim()

  return {
    bidId: selectedBidDoc._id,
    carrierId: selectedBidDoc.carrierId?._id || selectedBidDoc.carrierId,
    carrierName: selectedBidDoc.carrierId?.carrierName || '',
    quotedAmount: selectedBidDoc.quotedAmount ?? null,
    currency: selectedBidDoc.currency || 'USD',
    carrierNotes: selectedBidDoc.carrierNotes || '',
    submittedAt: selectedBidDoc.submittedAt,
    selectedAt: selectedBidDoc.selectedAt,
    status: selectedBidDoc.status,
    resubmitCount: selectedBidDoc.resubmitCount || 0,
    resubmitRequestedAt: selectedBidDoc.resubmitRequestedAt || null,
    resubmitNote: revisionNote,
    plantNote: revisionNote,
    canRequestResubmit: selectedBidDoc.status === 'submitted',
  }
}

const mapPublicFreightBidRevisionNote = (bid) => {
  if (bid.status !== 'resubmit_requested') return ''
  return String(bid.resubmitNote || '').trim()
}

module.exports = {
  mapPlantFreightBidRow,
  mapSelectedFreightBidDetails,
  mapPublicFreightBidRevisionNote,
}
