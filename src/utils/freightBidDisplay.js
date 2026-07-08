const normalizeBidAmount = (value) => {
  if (value == null || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

const mapPlantFreightBidRow = (row, { lowestId = null, bidAmount = null } = {}) => {
  const revisionNote = String(row.resubmitNote || '').trim()
  const normalizedAmount =
    bidAmount != null
      ? bidAmount
      : row.quotedAmount != null && Number.isFinite(Number(row.quotedAmount))
        ? Number(row.quotedAmount)
        : null
  const requestedBidAmount = normalizeBidAmount(row.resubmitRequestedAmount)

  return {
    bidId: row._id,
    carrierId: row.carrierId?._id || row.carrierId,
    carrierName: row.carrierId?.carrierName || '',
    submittedAt: row.submittedAt,
    carrierNote: row.carrierNotes || '',
    bidAmount: normalizedAmount,
    status: row.status,
    isLowest: lowestId ? String(row._id) === lowestId : false,
    resubmitCount: row.resubmitCount || 0,
    resubmitRequestedAt: row.resubmitRequestedAt || null,
    requestedBidAmount,
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
    requestedBidAmount: normalizeBidAmount(selectedBidDoc.resubmitRequestedAmount),
    resubmitNote: revisionNote,
    plantNote: revisionNote,
    canRequestResubmit: selectedBidDoc.status === 'submitted',
  }
}

const mapPublicFreightBidRevisionNote = (bid) => {
  if (bid.status !== 'resubmit_requested') return ''
  return String(bid.resubmitNote || '').trim()
}

const getPriorQuotedAmountFromBid = (bid) => {
  if (bid.status !== 'resubmit_requested') return null
  const history = Array.isArray(bid.submissionHistory) ? bid.submissionHistory : []
  if (!history.length) return null
  return normalizeBidAmount(history[history.length - 1]?.quotedAmount)
}

const mapPublicFreightBidInfo = (bid) => {
  const revisionNote = mapPublicFreightBidRevisionNote(bid)
  const priorQuotedAmount = getPriorQuotedAmountFromBid(bid)
  const requestedBidAmount = normalizeBidAmount(bid.resubmitRequestedAmount)

  return {
    bidId: bid._id,
    status: bid.status,
    quotedAmount: bid.quotedAmount ?? null,
    carrierNotes: bid.carrierNotes || '',
    resubmitNote: revisionNote,
    plantNote: revisionNote,
    note: revisionNote,
    resubmitRequestedAt: bid.resubmitRequestedAt || null,
    priorQuotedAmount,
    requestedBidAmount,
    resubmitCount: bid.resubmitCount || 0,
    bidDeadline: bid.expiresAt,
  }
}

module.exports = {
  mapPlantFreightBidRow,
  mapSelectedFreightBidDetails,
  mapPublicFreightBidRevisionNote,
  getPriorQuotedAmountFromBid,
  mapPublicFreightBidInfo,
}
