const User = require('../models/User')
const { MEDIA_DOCUMENT_TYPES } = require('../models/Lead')

const isMediaType = (type) => MEDIA_DOCUMENT_TYPES.includes(type)

/**
 * Filter lead.documents to photos/videos (optionally one type).
 * Sorted newest first.
 */
const pickMediaDocuments = (documents = [], type) => {
  let docs = (documents || []).filter((d) => isMediaType(d.type))
  if (type && isMediaType(type)) {
    docs = docs.filter((d) => d.type === type)
  }
  return [...docs].sort(
    (a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)
  )
}

const formatMediaDocuments = async (documents = []) => {
  const uploaderIds = [
    ...new Set(
      documents.map((d) => d.uploadedBy).filter(Boolean).map(String)
    ),
  ]
  const uploaders = uploaderIds.length
    ? await User.find({ _id: { $in: uploaderIds } })
        .select('_id name email role')
        .lean()
    : []
  const uploaderMap = new Map(uploaders.map((u) => [String(u._id), u]))

  return documents.map((doc) => ({
    _id: doc._id,
    url: doc.url,
    name: doc.name,
    type: doc.type,
    uploadedAt: doc.uploadedAt,
    approvalStatus: doc.approvalStatus || 'pending',
    reviewedAt: doc.reviewedAt || null,
    uploadedBy: doc.uploadedBy
      ? uploaderMap.get(String(doc.uploadedBy)) || { _id: doc.uploadedBy }
      : null,
  }))
}

const buildLeadMediaPayload = async (lead, type) => {
  const media = pickMediaDocuments(lead.documents, type)
  const documents = await formatMediaDocuments(media)
  const photos = documents.filter((d) => d.type === 'photo')
  const videos = documents.filter((d) => d.type === 'video')
  return {
    leadId: lead._id,
    projectId: lead.jobId,
    projectName: lead.projectName || '',
    documents,
    photos,
    videos,
    total: documents.length,
    photoCount: photos.length,
    videoCount: videos.length,
  }
}

module.exports = {
  MEDIA_DOCUMENT_TYPES,
  isMediaType,
  pickMediaDocuments,
  formatMediaDocuments,
  buildLeadMediaPayload,
}
