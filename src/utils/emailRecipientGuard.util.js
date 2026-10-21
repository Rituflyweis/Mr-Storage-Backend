/**
 * Staging / Render pre-go-live: block outbound mail to info@steelbuildingdepot.com.
 * Set ALLOW_MAIL_TO_INFO_STEELBUILDING=true in env when turning notifications on for production.
 */
const INFO_STEELBUILDING_EMAIL = 'info@steelbuildingdepot.com'

const allowMailToInfoSteelbuilding = () =>
  process.env.ALLOW_MAIL_TO_INFO_STEELBUILDING === 'true'

const normalizeEmail = (value) => String(value || '').trim().toLowerCase()

const isInfoSteelbuildingAddress = (address) =>
  normalizeEmail(address) === INFO_STEELBUILDING_EMAIL

const flattenRecipients = (field) => {
  if (!field) return []
  if (typeof field === 'string') return [field]
  if (Array.isArray(field)) {
    return field.flatMap((entry) => {
      if (typeof entry === 'string') return [entry]
      if (entry && typeof entry === 'object' && entry.email) return [entry.email]
      return []
    })
  }
  if (typeof field === 'object' && field.email) return [field.email]
  return []
}

/** True when send must not leave the server (any to/cc/bcc is the blocked address). */
const isOutboundMailBlockedForSteelInfo = (mailOptions = {}) => {
  if (allowMailToInfoSteelbuilding()) return false
  const recipients = [
    ...flattenRecipients(mailOptions.to),
    ...flattenRecipients(mailOptions.cc),
    ...flattenRecipients(mailOptions.bcc),
  ]
  return recipients.some(isInfoSteelbuildingAddress)
}

const logBlockedSteelInfoEmail = (mailOptions = {}, provider = 'email') => {
  console.warn(
    `[Email] BLOCKED delivery to ${INFO_STEELBUILDING_EMAIL} (set ALLOW_MAIL_TO_INFO_STEELBUILDING=true to enable) | provider=${provider} | to=${JSON.stringify(mailOptions.to)} | subject=${mailOptions.subject || '-'}`
  )
}

module.exports = {
  INFO_STEELBUILDING_EMAIL,
  allowMailToInfoSteelbuilding,
  isOutboundMailBlockedForSteelInfo,
  logBlockedSteelInfoEmail,
}
