const crypto = require('crypto')
const env = require('../../config/env')

let cachedToken = { value: '', expiresAt: 0 }

const docusignConfigured = () =>
  Boolean(
    env.DOCUSIGN_INTEGRATION_KEY &&
    env.DOCUSIGN_USER_ID &&
    env.DOCUSIGN_ACCOUNT_ID &&
    env.DOCUSIGN_RSA_PRIVATE_KEY
  )

const privateKey = () => env.DOCUSIGN_RSA_PRIVATE_KEY.replace(/\\n/g, '\n')

const b64url = (input) => Buffer.from(input).toString('base64url')

const signJwt = () => {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({
    iss: env.DOCUSIGN_INTEGRATION_KEY,
    sub: env.DOCUSIGN_USER_ID,
    aud: env.DOCUSIGN_OAUTH_HOST,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  }))
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(`${header}.${body}`)
  const signature = signer.sign(privateKey()).toString('base64url')
  return `${header}.${body}.${signature}`
}

const readJson = async (res) => {
  const text = await res.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return { message: text.slice(0, 400) } }
}

const accessToken = async () => {
  if (!docusignConfigured()) {
    throw new Error('DocuSign is not configured. Set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID, and DOCUSIGN_RSA_PRIVATE_KEY.')
  }
  if (cachedToken.value && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value

  const res = await fetch(`https://${env.DOCUSIGN_OAUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJwt(),
    }),
    signal: AbortSignal.timeout(20000),
  })
  const body = await readJson(res)
  if (!res.ok) {
    throw new Error(body.error_description || body.message || body.error || 'DocuSign login failed')
  }
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
  }
  return cachedToken.value
}

const api = async (method, path, payload, { raw = false } = {}) => {
  const token = await accessToken()
  const res = await fetch(`${env.DOCUSIGN_BASE_URL}/v2.1/accounts/${env.DOCUSIGN_ACCOUNT_ID}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/pdf' : 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(raw ? 60000 : 30000),
  })
  if (raw) {
    if (!res.ok) {
      const body = await readJson(res)
      throw new Error(body.message || `DocuSign document download failed (${res.status})`)
    }
    return Buffer.from(await res.arrayBuffer())
  }
  const body = await readJson(res)
  if (!res.ok) throw new Error(body.message || `DocuSign request failed (${res.status})`)
  return body
}

const signHere = (anchor) => ({
  anchorString: anchor,
  anchorUnits: 'pixels',
  anchorXOffset: '0',
  anchorYOffset: '-10',
  documentId: '1',
})

const createEnvelope = async ({ pdfBuffer, documentName, signerName, signerEmail, message, ccEmails, companySigner }) => {
  const signers = [{
    email: signerEmail,
    name: signerName,
    recipientId: '1',
    routingOrder: '1',
    tabs: { signHereTabs: [signHere('/sn1/')] },
  }]
  if (companySigner?.email) {
    signers.push({
      email: companySigner.email,
      name: companySigner.name || 'Company signer',
      recipientId: '2',
      routingOrder: '2',
      tabs: { signHereTabs: [signHere('/sn2/')] },
    })
  }
  const carbonCopies = (ccEmails || []).filter(Boolean).slice(0, 5).map((email, index) => ({
    email,
    name: email,
    recipientId: String(10 + index),
    routingOrder: '1',
  }))

  const created = await api('POST', '/envelopes', {
    emailSubject: `Please sign: ${documentName}`,
    emailBlurb: message || 'Please review and sign the Fabrication & Supply Agreement.',
    status: 'sent',
    documents: [{
      documentBase64: pdfBuffer.toString('base64'),
      name: documentName,
      fileExtension: 'pdf',
      documentId: '1',
    }],
    recipients: { signers, ...(carbonCopies.length ? { carbonCopies } : {}) },
  })
  return created.envelopeId
}

const getEnvelope = (envelopeId) => api('GET', `/envelopes/${envelopeId}`)
const getRecipients = (envelopeId) => api('GET', `/envelopes/${envelopeId}/recipients`)

const downloadCombinedPdf = (envelopeId) => api('GET', `/envelopes/${envelopeId}/documents/combined`, null, { raw: true })

const voidEnvelope = (envelopeId, reason) =>
  api('PUT', `/envelopes/${envelopeId}`, {
    status: 'voided',
    voidedReason: reason || 'Voided by staff',
  })

const resendEnvelope = (envelopeId, { signerName, signerEmail, companySigner }) => {
  const signers = []
  if (signerEmail) {
    signers.push({ recipientId: '1', name: signerName, email: signerEmail })
  }
  if (companySigner?.email) {
    signers.push({
      recipientId: '2',
      name: companySigner.name || 'Company signer',
      email: companySigner.email,
    })
  }
  const query = 'resend_envelope=true'
  return api('PUT', `/envelopes/${envelopeId}/recipients?${query}`, { signers })
}

const verifyConnectSignature = (rawBody, signatureHeader) => {
  const secret = env.DOCUSIGN_CONNECT_SECRET
  if (!secret) return env.NODE_ENV !== 'production'
  if (!signatureHeader || !rawBody) return false
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  const given = Buffer.from(String(signatureHeader))
  const expected = Buffer.from(digest)
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

module.exports = {
  docusignConfigured,
  createEnvelope,
  getEnvelope,
  getRecipients,
  downloadCombinedPdf,
  voidEnvelope,
  resendEnvelope,
  verifyConnectSignature,
}
