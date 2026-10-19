const Tax = require('../../models/Tax')
const TaxComplianceSettings = require('../../models/TaxComplianceSettings')
const returnsClient = require('../avalara/returnsGraphqlClient')
const { sendTaxPaymentConfirmationEmail } = require('../email/mailer')

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100

const periodParts = (tax) => {
  const d = tax.periodStart ? new Date(tax.periodStart) : tax.dueDate ? new Date(tax.dueDate) : new Date()
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

const tryAvalaraApprove = async (tax) => {
  if (!returnsClient.isReturnsConfigured()) return { skipped: true, reason: 'returns_not_configured' }
  const companyId = process.env.AVALARA_COMPANY_ID
  const { month, year } = periodParts(tax)
  const result = await returnsClient.approveFilings({
    companyId,
    month,
    year,
    region: tax.state,
    country: 'US',
    approve: true,
  })
  const regionRow = result?.[0]?.filingRegions?.[0] || result?.filingRegions?.[0] || null
  return { ok: true, avalara: result, regionRow }
}

exports.submitTaxPayment = async (taxId, user, body = {}, { useAvalaraApprove = false } = {}) => {
  const tax = await Tax.findById(taxId)
  if (!tax) return { error: 'not_found' }
  if (tax.status === 'paid') return { error: 'already_paid' }

  let avalaraResult = null
  if (useAvalaraApprove) {
    try {
      avalaraResult = await tryAvalaraApprove(tax)
      if (avalaraResult.regionRow?.filingId) {
        tax.avalaraFilingId = String(avalaraResult.regionRow.filingId)
      }
    } catch (err) {
      return { error: 'avalara_approve_failed', message: err.message }
    }
  }

  const paymentMethod = String(body.paymentMethod || '').trim() || (useAvalaraApprove ? 'ACH (via Avalara)' : 'Manual')
  const amount = round2(tax.payable ?? tax.taxDue ?? tax.amount ?? 0)
  const confirmationNumber =
    String(body.confirmationNumber || '').trim() ||
    (avalaraResult?.regionRow?.filingId
      ? `Tx-${tax.state}-${avalaraResult.regionRow.filingId}`
      : `Tx-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}`)

  const avalaraApproved = useAvalaraApprove && avalaraResult?.ok && !avalaraResult?.skipped

  tax.paymentMethod = paymentMethod
  tax.paymentStatus = avalaraApproved ? 'processing' : 'completed'
  tax.confirmationNumber = confirmationNumber
  tax.providerMethod = avalaraApproved ? 'Avalara API' : 'Manual (local)'
  tax.source = avalaraApproved ? 'avalara' : tax.source || 'sync'
  tax.paidFiled = amount
  tax.status = 'paid'
  tax.paidBy = user._id
  tax.paidAt = new Date()
  tax.payable = 0
  tax.activityLog = [
    ...(tax.activityLog || []),
    {
      at: new Date(),
      type: 'payment',
      amount,
      label: `${amount} Paid`,
    },
    {
      at: new Date(),
      type: 'filing',
      amount: null,
      label: useAvalaraApprove ? 'Return approved via Avalara' : 'Return Filed',
    },
  ]
  await tax.save()

  const settings = await TaxComplianceSettings.findOne({ key: 'default' }).lean()
  const notifyPrefs = settings?.taxFilingNotifications || {}
  const toEmail =
    String(body.notificationEmail || '').trim() ||
    String(notifyPrefs.recipientEmail || '').trim()
  if (toEmail && notifyPrefs.emailReminders !== false) {
    try {
      await sendTaxPaymentConfirmationEmail({ toEmail, tax: tax.toObject() })
    } catch (err) {
      console.warn('[tax-filing] payment confirmation email failed:', err.message)
    }
  }

  return {
    ok: true,
    tax,
    avalara: avalaraResult,
    payment: {
      amountPaid: amount,
      filingPeriod:
        tax.periodStart && tax.periodEnd
          ? { start: tax.periodStart, end: tax.periodEnd }
          : null,
      paymentMethod,
      confirmationNumber,
      status: avalaraApproved ? 'processing' : 'completed',
      estimatedSettlement: '1-3 business days',
      notificationEmail: body.notificationEmail || '',
    },
  }
}

module.exports = exports
