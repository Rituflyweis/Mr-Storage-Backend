const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { v4: uuidv4 } = require('uuid')
const Lead = require('../../models/Lead')
const Customer = require('../../models/Customer')
const EstimateQuote = require('../../models/EstimateQuote')
const ContractEnvelope = require('../../models/ContractEnvelope')
const env = require('../../config/env')
const { generateContractHtml } = require('../quoting/quoteDocumentGenerator')
const { renderHtmlToPdf } = require('../quoting/htmlPdf')
const {
  docusignConfigured,
  createEnvelope,
  getEnvelope,
  getRecipients,
  downloadCombinedPdf,
  voidEnvelope,
  resendEnvelope,
} = require('./docusign.service')

const DOCUMENT_NAME = 'Fabrication & Supply Agreement'
const OPEN_STATUSES = ['sent', 'delivered', 'viewed']
const CLOSED_STATUSES = ['completed', 'declined', 'voided', 'expired']

const STATUS_LABELS = {
  not_sent: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  viewed: 'Opened',
  completed: 'Signed',
  declined: 'Declined',
  voided: 'Voided',
  expired: 'Expired',
}

const s3 = new S3Client({
  region: env.AWS_REGION,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
})

const money = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `$${Math.round(n).toLocaleString('en-US')}`
}

const buildContractPdf = async (lead, customer, signerEmail) => {
  const estimate = await EstimateQuote.findOne({ leadId: lead._id }).sort({ updatedAt: -1 }).lean()
  const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ').trim()
    || estimate?.leadCompanyName
    || lead.projectName
    || 'Customer'
  const payload = {
    leadCompanyName: name,
    customerEmail: signerEmail || customer?.email || estimate?.customerEmail || '',
    streetAddress: estimate?.streetAddress || lead.location || '',
    cityStateZip: estimate?.cityStateZip || [lead.city, lead.state, lead.pincode].filter(Boolean).join(' '),
    quoteDate: estimate?.quoteDate || new Date(),
    depositTerms: estimate?.depositTerms || null,
    pricingResult: estimate?.pricingResult || null,
    storagePricingResult: estimate?.storagePricingResult || null,
    totalSell: estimate?.revisedContractTotal || estimate?.totalSell || lead.quoteValue || 0,
    grandTotal: estimate?.revisedContractTotal || estimate?.totalSell || lead.quoteValue || 0,
    jobType: estimate?.jobType || 'PEMB',
    contract: {
      customer: name,
      address: estimate?.streetAddress || lead.location || '',
      city: estimate?.cityStateZip || [lead.city, lead.state].filter(Boolean).join(', '),
      email: signerEmail || customer?.email || '',
      date: new Date().toLocaleDateString('en-US'),
      value: money(estimate?.revisedContractTotal || estimate?.totalSell || lead.quoteValue),
    },
  }
  const html = `<!DOCTYPE html><html><body>${generateContractHtml(payload)}
    <p style="margin-top:24px;">Customer signature: /sn1/</p>
    <p>Company signature: /sn2/</p>
    </body></html>`
  return renderHtmlToPdf(html)
}

const mapRecipientStatus = (status) => {
  const value = String(status || '').toLowerCase()
  if (value === 'completed' || value === 'signed') return 'completed'
  if (value === 'declined') return 'declined'
  if (value === 'delivered') return 'viewed'
  if (value === 'sent' || value === 'created') return 'sent'
  return value
}

const mapEnvelopeStatus = (status) => {
  const value = String(status || '').toLowerCase()
  if (value === 'completed' || value === 'signed') return 'completed'
  if (value === 'declined') return 'declined'
  if (value === 'voided') return 'voided'
  if (value === 'timedout' || value === 'expired') return 'expired'
  if (value === 'delivered') return 'delivered'
  if (value === 'sent' || value === 'created') return 'sent'
  return ''
}

const formatSignature = (row) => {
  if (!row) {
    return {
      status: 'not_sent',
      statusLabel: STATUS_LABELS.not_sent,
      signerName: '',
      signerEmail: '',
      documentName: DOCUMENT_NAME,
      signedPdfUrl: '',
      canSend: true,
      canRemind: false,
      canVoid: false,
      canDownload: false,
    }
  }
  const status = row.status || 'not_sent'
  const open = OPEN_STATUSES.includes(status)
  return {
    envelopeId: row.envelopeId || '',
    status,
    statusLabel: STATUS_LABELS[status] || status,
    signerName: row.signerName || '',
    signerEmail: row.signerEmail || '',
    ccEmails: row.ccEmails || [],
    companySignerName: row.companySignerName || '',
    companySignerEmail: row.companySignerEmail || '',
    message: row.message || '',
    signers: row.signers || [],
    documentName: row.documentName || DOCUMENT_NAME,
    sentAt: row.sentAt || null,
    deliveredAt: row.deliveredAt || null,
    viewedAt: row.viewedAt || null,
    completedAt: row.completedAt || null,
    declinedAt: row.declinedAt || null,
    voidedAt: row.voidedAt || null,
    declineReason: row.declineReason || '',
    voidReason: row.voidReason || '',
    signedPdfUrl: row.signedPdfUrl || '',
    updatedAt: row.updatedAt || null,
    canSend: !open && status !== 'completed',
    canRemind: open,
    canVoid: open,
    canDownload: status === 'completed' && Boolean(row.signedPdfUrl),
  }
}

const latestForLead = (leadId) =>
  ContractEnvelope.findOne({ leadId }).sort({ createdAt: -1 })

const storeSignedPdf = async (lead, pdfBuffer, uploadedBy) => {
  const key = `contracts/${lead._id}/${uuidv4()}.pdf`
  await s3.send(new PutObjectCommand({
    Bucket: env.AWS_S3_BUCKET,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  }))
  const url = `https://${env.AWS_S3_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`
  const name = 'Signed Fabrication & Supply Agreement.pdf'
  lead.documents.push({
    url,
    name,
    type: 'contract',
    uploadedBy: uploadedBy || null,
    uploadedAt: new Date(),
    approvalStatus: 'approved',
  })
  await lead.save()
  return url
}

const applyRemoteStatus = async (row, remote, recipients) => {
  const envelopeStatus = mapEnvelopeStatus(remote.status)
  const signerRows = []
  for (const signer of recipients?.signers || []) {
    signerRows.push({
      role: signer.routingOrder === '2' ? 'company' : 'customer',
      name: signer.name || '',
      email: signer.email || '',
      recipientId: String(signer.recipientId || ''),
      status: mapRecipientStatus(signer.status),
    })
  }
  if (signerRows.length) row.signers = signerRows

  const customerOpened = signerRows.some((s) => s.role === 'customer' && s.status === 'viewed')
  let next = envelopeStatus
  if (customerOpened && (next === 'sent' || next === 'delivered')) next = 'viewed'
  if (!next) return row

  const rank = ['sent', 'delivered', 'viewed', 'completed', 'declined', 'voided', 'expired']
  const currentRank = rank.indexOf(row.status)
  const nextRank = rank.indexOf(next)
  if (CLOSED_STATUSES.includes(row.status) && row.status !== next) {
    if (row.status === 'completed') return row
  }
  if (nextRank >= 0 && currentRank >= 0 && nextRank < currentRank && !CLOSED_STATUSES.includes(next)) return row

  row.status = next
  const now = remote.statusChangedDateTime ? new Date(remote.statusChangedDateTime) : new Date()
  if (next === 'sent' && !row.sentAt) row.sentAt = now
  if (next === 'delivered' && !row.deliveredAt) row.deliveredAt = now
  if (next === 'viewed' && !row.viewedAt) row.viewedAt = now
  if (next === 'completed') row.completedAt = row.completedAt || now
  if (next === 'declined') {
    row.declinedAt = row.declinedAt || now
    row.declineReason = remote.voidedReason || recipients?.signers?.find((s) => s.declinedReason)?.declinedReason || row.declineReason
  }
  if (next === 'voided') {
    row.voidedAt = row.voidedAt || now
    row.voidReason = remote.voidedReason || row.voidReason
  }
  return row
}

const pullSignedPdf = async (row) => {
  if (row.status !== 'completed' || row.signedPdfUrl || !row.envelopeId) return row
  const pdf = await downloadCombinedPdf(row.envelopeId)
  const lead = await Lead.findById(row.leadId)
  if (!lead) return row
  row.signedPdfUrl = await storeSignedPdf(lead, pdf, row.sentBy)
  return row
}

const refreshEnvelope = async (row) => {
  if (!row?.envelopeId || !docusignConfigured()) return row
  if (row.status === 'completed' && row.signedPdfUrl) return row
  if (row.status === 'voided') return row
  const [remote, recipients] = await Promise.all([
    getEnvelope(row.envelopeId),
    getRecipients(row.envelopeId),
  ])
  await applyRemoteStatus(row, remote, recipients)
  await pullSignedPdf(row)
  await row.save()
  return row
}

const sendContract = async ({ lead, user, body }) => {
  if (!docusignConfigured()) {
    throw new Error('DocuSign is not configured. Set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID, and DOCUSIGN_RSA_PRIVATE_KEY.')
  }
  const current = await latestForLead(lead._id)
  if (current && OPEN_STATUSES.includes(current.status)) {
    throw new Error('A contract is already out for signature. Void it before sending another.')
  }
  if (current && current.status === 'completed') {
    throw new Error('This contract is already signed.')
  }

  const customer = await Customer.findById(lead.customerId).select('firstName lastName email').lean()
  const signerEmail = String(body.signerEmail || customer?.email || '').trim().toLowerCase()
  const signerName = String(body.signerName || [customer?.firstName, customer?.lastName].filter(Boolean).join(' ')).trim()
  if (!signerEmail || !signerName) throw new Error('Signer name and email are required')

  const ccEmails = []
  const ccRaw = body.cc ?? body.ccEmails ?? body.ccEmail
  const ccList = Array.isArray(ccRaw) ? ccRaw : String(ccRaw || '').split(/[,;]+/)
  for (const item of ccList) {
    const email = String(item || '').trim().toLowerCase()
    if (email) ccEmails.push(email)
  }
  const companySigner = body.companySigner?.email
    ? { name: String(body.companySigner.name || '').trim(), email: String(body.companySigner.email).trim().toLowerCase() }
    : null

  const pdf = await buildContractPdf(lead, customer, signerEmail)
  const envelopeId = await createEnvelope({
    pdfBuffer: pdf,
    documentName: DOCUMENT_NAME,
    signerName,
    signerEmail,
    message: String(body.message || '').trim(),
    ccEmails,
    companySigner,
  })

  const row = await ContractEnvelope.create({
    leadId: lead._id,
    customerId: lead.customerId,
    envelopeId,
    status: 'sent',
    signerName,
    signerEmail,
    ccEmails,
    companySignerName: companySigner?.name || '',
    companySignerEmail: companySigner?.email || '',
    message: String(body.message || '').trim(),
    documentName: DOCUMENT_NAME,
    sentAt: new Date(),
    sentBy: user?._id || null,
    signers: [
      { role: 'customer', name: signerName, email: signerEmail, recipientId: '1', status: 'sent' },
      ...(companySigner ? [{ role: 'company', name: companySigner.name, email: companySigner.email, recipientId: '2', status: 'sent' }] : []),
    ],
  })
  return row
}

const remindContract = async (row) => {
  if (!OPEN_STATUSES.includes(row.status)) throw new Error('There is no open contract to remind')
  await resendEnvelope(row.envelopeId, { signerName: row.signerName, signerEmail: row.signerEmail })
  return row
}

const voidContract = async (row, reason) => {
  if (!OPEN_STATUSES.includes(row.status)) throw new Error('Only an open contract can be voided')
  await voidEnvelope(row.envelopeId, reason)
  row.status = 'voided'
  row.voidedAt = new Date()
  row.voidReason = reason || 'Voided by staff'
  await row.save()
  return row
}

const resendContract = async ({ lead, user, body, row }) => {
  if (row && OPEN_STATUSES.includes(row.status)) {
    const signerEmail = String(body.signerEmail || row.signerEmail).trim().toLowerCase()
    const signerName = String(body.signerName || row.signerName).trim()
    await resendEnvelope(row.envelopeId, {
      signerName,
      signerEmail,
      companySigner: body.companySigner?.email
        ? { name: body.companySigner.name, email: String(body.companySigner.email).trim().toLowerCase() }
        : (row.companySignerEmail ? { name: row.companySignerName, email: row.companySignerEmail } : null),
    })
    row.signerName = signerName
    row.signerEmail = signerEmail
    if (body.message !== undefined) row.message = String(body.message || '')
    await row.save()
    return row
  }
  return sendContract({ lead, user, body })
}

const handleConnectEvent = async ({ envelopeId, status, rawStatus }) => {
  if (!envelopeId) return null
  const row = await ContractEnvelope.findOne({ envelopeId })
  if (!row) return null
  const mapped = mapEnvelopeStatus(status || rawStatus)
  if (mapped) await applyRemoteStatus(row, { status: mapped }, null)
  if (docusignConfigured() && row.envelopeId) {
    try {
      const [remote, recipients] = await Promise.all([
        getEnvelope(row.envelopeId),
        getRecipients(row.envelopeId),
      ])
      await applyRemoteStatus(row, remote, recipients)
      await pullSignedPdf(row)
    } catch (err) {
      console.error('[DocuSign] webhook refresh failed:', err.message)
    }
  }
  await row.save()
  return row
}

module.exports = {
  STATUS_LABELS,
  formatSignature,
  latestForLead,
  refreshEnvelope,
  sendContract,
  remindContract,
  voidContract,
  resendContract,
  handleConnectEvent,
  mapEnvelopeStatus,
}
