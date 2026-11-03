const User = require('../models/User')
const {
  INFO_STEELBUILDING_EMAIL,
  allowMailToInfoSteelbuilding,
  isInfoSteelbuildingAddress,
} = require('./emailRecipientGuard.util')

/** Distinct, normalized emails for active admin staff (in-app role = admin). */
const getActiveAdminNotificationEmails = async () => {
  const users = await User.find({
    role: 'admin',
    isActive: true,
    email: { $exists: true, $ne: '' },
  })
    .select('email')
    .lean()

  const seen = new Set()
  const out = []
  for (const u of users) {
    const email = String(u.email || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

/**
 * Recipients for AI chat / website form enquiry nodemailer alerts.
 * Prefer every active admin User.email; fall back to info@ only if none configured.
 * When ALLOW_MAIL_TO_INFO_STEELBUILDING is false, info@ is omitted so UAT can still mail other admins.
 */
const resolveEnquiryNotificationRecipients = async () => {
  let recipients = await getActiveAdminNotificationEmails()
  if (!recipients.length) {
    recipients = [INFO_STEELBUILDING_EMAIL]
  }
  if (!allowMailToInfoSteelbuilding()) {
    recipients = recipients.filter((e) => !isInfoSteelbuildingAddress(e))
  }
  return recipients
}

module.exports = {
  getActiveAdminNotificationEmails,
  resolveEnquiryNotificationRecipients,
}
