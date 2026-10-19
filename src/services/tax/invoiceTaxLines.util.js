const TAX_CODES = require('../../config/avalaraTaxCodes')
const { resolveLineTaxCode } = require('./taxMapping.service')

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100

/**
 * Pure (no-DB) tax-code guess for a line — explicit code/flag, then keyword
 * fallback. Kept for the local engine and unit tests. For AvaTax, prefer
 * buildTaxLinesFromInvoice(invoice, approvedMappings) which also reports whether
 * each line's code is an APPROVED mapping or a test-only fallback.
 */
const inferTaxCodeForLine = (line = {}) => resolveLineTaxCode(line, null).code

const isTaxableCode = (code) => code && code !== TAX_CODES.DEFAULT_NON_TAXABLE && code !== 'NT'

/**
 * Build AvaTax lines from an invoice.
 * @param {object} invoice
 * @param {object|null} approved - result of taxMapping.loadApprovedMappings(); when
 *   provided, lines resolve against APPROVED mappings and fall back to test-only codes.
 * @returns {{ lines: object[], resolutions: object[] }}
 */
const buildTaxLinesFromInvoice = (invoice = {}, approved = null) => {
  const items = Array.isArray(invoice.lineItems) ? invoice.lineItems : []
  const resolutions = []

  if (items.length) {
    const lines = items.map((line, idx) => {
      const qty = Number(line.quantity) || 1
      const lineTotal = round2(
        line.total || (Number(line.effectiveRate || line.rate) || 0) * qty
      )
      const res = resolveLineTaxCode(line, approved)
      resolutions.push({ ...res, number: String(idx + 1), amount: lineTotal })
      return {
        number: String(idx + 1),
        quantity: qty,
        amount: lineTotal,
        taxCode: res.code,
        description: (line.description || line.items?.join(', ') || 'Line item').slice(0, 200),
      }
    })
    return { lines, resolutions }
  }

  // Lump-sum fallback (no line items). Treated as taxable materials, but this
  // path never produces an APPROVED resolution — bundled lump-sum needs review (§3).
  const pretax = round2(
    (Number(invoice.subtotal) || 0) +
      (Number(invoice.markupTotal) || 0) -
      (Number(invoice.discount) || 0)
  )
  if (pretax <= 0) return { lines: [], resolutions: [] }

  const res = resolveLineTaxCode({ description: 'Invoice subtotal (materials)' }, approved)
  resolutions.push({ ...res, number: '1', amount: pretax, lumpSum: true })
  return {
    lines: [
      {
        number: '1',
        quantity: 1,
        amount: pretax,
        taxCode: res.code,
        description: 'Invoice subtotal (materials)',
      },
    ],
    resolutions,
  }
}

module.exports = {
  buildTaxLinesFromInvoice,
  inferTaxCodeForLine,
  isTaxableCode,
  round2,
}
