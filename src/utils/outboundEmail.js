const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_CC = 10

const isValidEmail = (value) => EMAIL_RE.test(String(value || '').trim())

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

const emailFromItem = (item) => {
  if (item == null || item === '') return ''
  if (typeof item === 'string' || typeof item === 'number') return normalizeEmail(item)
  if (typeof item === 'object') {
    return normalizeEmail(item.email || item.Email || item.value || item.address || '')
  }
  return ''
}

const parseEmailList = (raw) => {
  if (raw == null || raw === '') return []
  const values = Array.isArray(raw)
    ? raw
    : String(raw).split(/[,;]+/)
  const emails = []
  const seen = new Set()
  for (const item of values) {
    const email = emailFromItem(item)
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

const extractCustomMessage = (body = {}) => {
  const candidates = [
    ['message', body.message],
    ['note', body.note],
    ['emailMessage', body.emailMessage],
    ['coverNote', body.coverNote],
  ]
  const first = candidates.find(([, value]) => String(value || '').trim())
  return {
    customMessage: String(first?.[1] || '').trim(),
    messageSourceKey: first?.[0] || null,
  }
}

const resolveOutboundRecipients = ({ body = {}, fallbackToEmail = '' } = {}) => {
  const toRaw = body.toEmail || body.to || fallbackToEmail
  const toEmail = normalizeEmail(toRaw)
  if (!toEmail) return { error: 'A To email is required' }
  if (!isValidEmail(toEmail)) return { error: 'Invalid To email' }

  const cc = parseEmailList(
    body.cc ?? body.ccEmail ?? body.ccEmails ?? body.ccRecipients ?? body.ccList ?? body.ccs
  )
  if (cc.length > MAX_CC) return { error: `A maximum of ${MAX_CC} CC emails is allowed` }
  const invalidCc = cc.find((email) => !isValidEmail(email))
  if (invalidCc) return { error: `Invalid CC email: ${invalidCc}` }

  const { customMessage, messageSourceKey } = extractCustomMessage(body)
  return {
    toEmail,
    cc: cc.filter((email) => email !== toEmail),
    customMessage,
    messageSourceKey,
  }
}

module.exports = {
  EMAIL_RE,
  MAX_CC,
  isValidEmail,
  normalizeEmail,
  parseEmailList,
  extractCustomMessage,
  resolveOutboundRecipients,
}
