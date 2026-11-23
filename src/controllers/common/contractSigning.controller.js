const Lead = require('../../models/Lead')
const { success, created, notFound, badRequest, forbidden } = require('../../utils/apiResponse')
const asyncHandler = require('../../utils/asyncHandler')
const {
  formatSignature,
  latestForLead,
  refreshEnvelope,
  sendContract,
  remindContract,
  voidContract,
  resendContract,
  handleConnectEvent,
  mapEnvelopeStatus,
} = require('../../services/docusign/contractEnvelope.service')
const { verifyConnectSignature } = require('../../services/docusign/docusign.service')

const loadLead = async (req, leadId) => {
  const lead = await Lead.findById(leadId)
  if (!lead || lead.isDeleted) return { error: 'Lead not found', code: 404 }
  if (req.user.role === 'sales' && String(lead.assignedSales) !== String(req.user._id)) {
    return { error: 'Access denied', code: 403 }
  }
  return { lead }
}

const fail = (res, err) => {
  const code = err.code || 400
  if (code === 404) return notFound(res, err.message || err.error)
  if (code === 403) return forbidden(res, err.message || err.error)
  return badRequest(res, err.message || err.error || 'Request failed')
}

exports.getContract = asyncHandler(async (req, res) => {
  const loaded = await loadLead(req, req.params.leadId)
  if (loaded.error) return fail(res, loaded)
  let row = await latestForLead(req.params.leadId)
  if (row) {
    try { row = await refreshEnvelope(row) } catch (err) {
      console.error('[DocuSign] status refresh failed:', err.message)
    }
  }
  return success(res, { signature: formatSignature(row) })
})

exports.sendContract = asyncHandler(async (req, res) => {
  const loaded = await loadLead(req, req.params.leadId)
  if (loaded.error) return fail(res, loaded)
  try {
    const row = await sendContract({ lead: loaded.lead, user: req.user, body: req.body || {} })
    return created(res, { signature: formatSignature(row) }, 'Contract sent via DocuSign')
  } catch (err) {
    return badRequest(res, err.message)
  }
})

exports.remindContract = asyncHandler(async (req, res) => {
  const loaded = await loadLead(req, req.params.leadId)
  if (loaded.error) return fail(res, loaded)
  const row = await latestForLead(req.params.leadId)
  if (!row) return notFound(res, 'No contract has been sent')
  try {
    await remindContract(row)
    return success(res, { signature: formatSignature(row) }, 'Reminder sent')
  } catch (err) {
    return badRequest(res, err.message)
  }
})

exports.voidContract = asyncHandler(async (req, res) => {
  const loaded = await loadLead(req, req.params.leadId)
  if (loaded.error) return fail(res, loaded)
  const row = await latestForLead(req.params.leadId)
  if (!row) return notFound(res, 'No contract has been sent')
  try {
    await voidContract(row, String(req.body?.reason || req.body?.voidReason || '').trim())
    return success(res, { signature: formatSignature(row) }, 'Contract voided')
  } catch (err) {
    return badRequest(res, err.message)
  }
})

exports.resendContract = asyncHandler(async (req, res) => {
  const loaded = await loadLead(req, req.params.leadId)
  if (loaded.error) return fail(res, loaded)
  const row = await latestForLead(req.params.leadId)
  try {
    const next = await resendContract({ lead: loaded.lead, user: req.user, body: req.body || {}, row })
    return success(res, { signature: formatSignature(next) }, 'Contract resent')
  } catch (err) {
    return badRequest(res, err.message)
  }
})

const envelopeIdFrom = (body, raw) => {
  if (body?.data?.envelopeId) return body.data.envelopeId
  if (body?.envelopeId) return body.envelopeId
  if (body?.data?.envelopeSummary?.envelopeId) return body.data.envelopeSummary.envelopeId
  const text = typeof raw === 'string' ? raw : ''
  return text.match(/<EnvelopeID>([^<]+)<\/EnvelopeID>/i)?.[1] || ''
}

const statusFrom = (body, raw) => {
  const fromJson = body?.event || body?.data?.envelopeSummary?.status || body?.status
  if (fromJson && !String(fromJson).includes('envelope-')) return fromJson
  const text = typeof raw === 'string' ? raw : ''
  const xml = text.match(/<Status>([^<]+)<\/Status>/i)?.[1]
  if (xml) return xml
  const event = String(fromJson || '')
  if (event.includes('completed')) return 'completed'
  if (event.includes('declined')) return 'declined'
  if (event.includes('voided')) return 'voided'
  if (event.includes('delivered')) return 'delivered'
  if (event.includes('sent')) return 'sent'
  return ''
}

exports.webhook = async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.rawBody || '')
    const signature = req.get('X-DocuSign-Signature-1')
    if (!verifyConnectSignature(raw, signature)) {
      return res.status(401).json({ success: false, message: 'Invalid DocuSign signature' })
    }
    const text = raw.toString('utf8')
    let body = {}
    try { body = JSON.parse(text) } catch { body = {} }
    const envelopeId = envelopeIdFrom(body, text)
    const status = mapEnvelopeStatus(statusFrom(body, text)) || statusFrom(body, text)
    await handleConnectEvent({ envelopeId, status })
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('[DocuSign] webhook error:', err.message)
    return res.status(200).json({ success: true })
  }
}
