const env = require('../../config/env')
const { AUDIT_ACTIONS } = require('../../config/constants')
const Customer = require('../../models/Customer')
const Lead = require('../../models/Lead')
const Message = require('../../models/Message')
const MetaLeadAdSubmission = require('../../models/MetaLeadAdSubmission')
const generateCustomerId = require('../../utils/generateCustomerId')
const auditService = require('../audit.service')
const leadListSocket = require('../leadListSocket.service')
const { syncLeadBuildings } = require('../leadBuilding.service')

const graphUrl = (path) =>
  `https://graph.facebook.com/${env.FACEBOOK_GRAPH_VERSION || 'v21.0'}${path}`

const fieldMap = (fieldData = []) => {
  const map = new Map()
  for (const row of fieldData) {
    const key = String(row?.name || '').trim().toLowerCase()
    if (!key) continue
    const val = Array.isArray(row.values) ? row.values.map((v) => String(v).trim()).filter(Boolean) : []
    map.set(key, val.join(', '))
  }
  return map
}

const splitName = (full) => {
  const s = String(full || '').trim()
  if (!s) return { firstName: 'Lead', lastName: '' }
  const parts = s.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

const normalizePhone = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return { number: '', countryCode: '' }
  const digits = s.replace(/\D/g, '')
  if (s.startsWith('+') && digits.length > 10) {
    return { number: digits.slice(-10), countryCode: `+${digits.slice(0, -10)}` || '+1' }
  }
  return { number: digits || s.replace(/\D/g, ''), countryCode: '+1' }
}

const findCustomerByEmailOrPhone = async (email, phoneNumber) => {
  const or = []
  if (email) or.push({ email: email.toLowerCase() })
  if (phoneNumber) or.push({ 'phone.number': phoneNumber })
  if (!or.length) return null
  return Customer.findOne({ $or: or })
}

const formatLeadAdMessage = (fields) => {
  const lines = ['Submitted a Meta (Facebook / Instagram) lead ad form:', '']
  for (const row of fields) {
    const label = String(row.name || '').replace(/_/g, ' ')
    const value = (row.values || []).join(', ')
    if (value) lines.push(`${label}: ${value}`)
  }
  return lines.join('\n').trim()
}

const applyLeadFieldsFromForm = (leadPatch, map) => {
  const zip = map.get('zip_code') || map.get('zip') || map.get('post_code') || ''
  const city = map.get('city') || ''
  const state = map.get('state') || map.get('province') || ''
  const street = map.get('street_address') || map.get('address') || ''
  const location = [street, city, state, zip].filter(Boolean).join(', ')
  const building =
    map.get('building_type') || map.get('what_are_you_looking_for?') || map.get('project_type') || ''
  const notes = map.get('comments') || map.get('message') || map.get('notes') || map.get('details') || ''

  if (location) leadPatch.location = location
  if (building) leadPatch.projectName = building.slice(0, 200)
  if (notes) leadPatch.notes = notes
  if (zip) leadPatch.pincode = zip
  if (city) leadPatch.city = city
  if (state) leadPatch.state = state
}

const fetchLeadFromGraph = async (leadgenId) => {
  const token = env.FACEBOOK_PAGE_ACCESS_TOKEN
  if (!token) throw new Error('FACEBOOK_PAGE_ACCESS_TOKEN is not set')
  const url = `${graphUrl(`/${encodeURIComponent(leadgenId)}`)}?fields=created_time,id,field_data,ad_id,form_id,platform`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Meta lead fetch failed (${response.status}): ${body.slice(0, 400)}`)
  }
  return response.json()
}

const ingestLeadgen = async ({ leadgenId, formId, adId, adgroupId, pageId, createdTime }) => {
  const existing = await MetaLeadAdSubmission.findOne({ leadgenId }).lean()
  if (existing) return { skipped: true, leadId: existing.leadId }

  const graphLead = await fetchLeadFromGraph(leadgenId)
  const fieldData = Array.isArray(graphLead.field_data) ? graphLead.field_data : []
  const map = fieldMap(fieldData)

  const email = (map.get('email') || '').trim().toLowerCase()
  const phoneRaw = map.get('phone_number') || map.get('phone') || map.get('mobile') || ''
  const { firstName, lastName } = splitName(map.get('full_name') || map.get('name') || map.get('first_name'))
  const phone = normalizePhone(phoneRaw)

  let customer = await findCustomerByEmailOrPhone(email, phone.number)
  if (!customer) {
    const customerId = await generateCustomerId()
    customer = await Customer.create({
      customerId,
      firstName,
      lastName,
      ...(email ? { email } : {}),
      ...(phone.number ? { phone: { number: phone.number, countryCode: phone.countryCode || '+1' } } : {}),
      source: 'meta_lead_ads',
    })
  }

  const leadPatch = {
    customerId: customer._id,
    source: 'meta_lead_ads',
    lifecycleStatus: 'initial_contact',
    lifecycleHistory: [{ stage: 'initial_contact', changedAt: new Date(), changedBy: null }],
  }
  applyLeadFieldsFromForm(leadPatch, map)

  const lead = await Lead.create(leadPatch)

  const submission = await MetaLeadAdSubmission.create({
    leadgenId: String(graphLead.id || leadgenId),
    formId: String(formId || graphLead.form_id || ''),
    adId: String(adId || graphLead.ad_id || ''),
    adgroupId: String(adgroupId || ''),
    pageId: String(pageId || ''),
    leadId: lead._id,
    customerId: customer._id,
    fieldData: fieldData.map((row) => ({
      name: String(row.name || ''),
      values: (row.values || []).map((v) => String(v)),
    })),
    metaCreatedTime: createdTime
      ? new Date(createdTime * 1000)
      : graphLead.created_time
        ? new Date(graphLead.created_time)
        : null,
  })

  const content = formatLeadAdMessage(submission.fieldData)
  const message = await Message.create({
    leadId: lead._id,
    customerId: customer._id,
    senderType: 'customer',
    content,
    origin: 'meta_lead',
    senderName: [firstName, lastName].filter(Boolean).join(' ') || 'Meta lead',
    isRead: false,
  })

  if (global.io) {
    const payload = {
      _id: message._id,
      senderType: 'customer',
      content,
      createdAt: message.createdAt,
      leadId: lead._id,
      origin: 'meta_lead',
      source: 'facebook_lead_ad',
      sourceLabel: 'Meta lead ad',
    }
    global.io.of('/admin').to(`lead:${lead._id}`).emit('new_message', payload)
    global.io.of('/admin').to('admin_room').emit('new_customer_message', { leadId: lead._id, message: payload })
  }

  await auditService.log({
    type: 'lead',
    action: AUDIT_ACTIONS.LEAD_CREATED,
    leadId: lead._id,
    customerId: customer._id,
    performedBy: null,
    metadata: { source: 'meta_lead_ads', leadgenId, formId: submission.formId },
  })

  await leadListSocket.emitLeadListCreated(lead._id, { trigger: 'meta_lead_ads' }).catch(() => {})
  await syncLeadBuildings(lead, { createdBy: null }).catch(() => {})

  const { notifyAdminsOfNewLead } = require('../../utils/leadCreatedNotify.util')
  await notifyAdminsOfNewLead(lead, {
    customerId: customer._id,
    inbound: true,
    source: 'meta_lead_ads',
  }).catch(() => {})

  console.info('[MetaLeadAds] lead ingested', {
    leadId: String(lead._id),
    leadgenId: submission.leadgenId,
    customerId: String(customer._id),
  })

  return { skipped: false, leadId: lead._id, submissionId: submission._id }
}

const parseLeadgenWebhook = (body) => {
  if (String(body?.object || '').toLowerCase() !== 'page') return []
  const out = []
  const entries = Array.isArray(body?.entry) ? body.entry : []
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      if (String(change?.field || '') !== 'leadgen') continue
      const value = change?.value || {}
      const leadgenId = String(value.leadgen_id || '').trim()
      if (!leadgenId) continue
      out.push({
        leadgenId,
        formId: value.form_id,
        adId: value.ad_id,
        adgroupId: value.adgroup_id,
        pageId: value.page_id || entry.id,
        createdTime: value.created_time,
      })
    }
  }
  return out
}

const handleWebhookBody = async (body) => {
  for (const payload of parseLeadgenWebhook(body)) {
    try {
      await ingestLeadgen(payload)
    } catch (err) {
      console.error('[MetaLeadAds] ingest failed:', err.message)
    }
  }
}

const getSubmissionForLead = async (leadId) => {
  const doc = await MetaLeadAdSubmission.findOne({ leadId })
    .select('leadgenId formId adId adgroupId pageId fieldData metaCreatedTime createdAt')
    .lean()
  if (!doc) return null
  return {
    leadgenId: doc.leadgenId,
    formId: doc.formId,
    adId: doc.adId,
    adgroupId: doc.adgroupId,
    pageId: doc.pageId,
    fieldData: doc.fieldData || [],
    submittedAt: doc.metaCreatedTime || doc.createdAt,
  }
}

module.exports = {
  handleWebhookBody,
  parseLeadgenWebhook,
  ingestLeadgen,
  getSubmissionForLead,
  fetchLeadFromGraph,
}