const { CLIENT_URL } = require('../config/env')

const RESUBMIT_ALLOWED_STATUSES = new Set([
  'submitted',
  'comparison_completed',
  'comparison_failed',
  'resubmit_requested',
])

const buildVendorUploadPageUrl = (token) => {
  const base = String(CLIENT_URL || '').replace(/\/$/, '')
  return `${base}/vendor/${token}`
}

const getComparisonBlockers = (summary = null) => {
  if (!summary) return ['comparison_not_run']
  const blockers = []
  if ((summary.missingItems || 0) > 0) blockers.push('missing_items')
  if ((summary.extraItems || 0) > 0) blockers.push('extra_items')
  if ((summary.qtyMismatches || 0) > 0) blockers.push('qty_mismatch')
  if ((summary.lengthMismatches || 0) > 0) blockers.push('length_mismatch')
  if ((summary.weightMismatches || 0) > 0) blockers.push('weight_mismatch')
  if ((summary.ambiguousMatches || 0) > 0) blockers.push('ambiguous_match')
  if ((summary.partMismatches || 0) > 0) blockers.push('part_mismatch')
  return blockers
}

const ISSUE_TYPE_LABELS = {
  missing: 'Missing in vendor quote',
  extra: 'Extra in vendor quote',
  qty_mismatch: 'Quantity mismatch',
  length_mismatch: 'Length mismatch',
  weight_mismatch: 'Weight mismatch',
  ambiguous: 'Ambiguous match',
  part_mismatch: 'Part mismatch',
  unknown: 'Review required',
}

const formatIssueTypeLabel = (issueType) =>
  ISSUE_TYPE_LABELS[issueType] || ISSUE_TYPE_LABELS.unknown

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * HTML snippet for resubmit emails. Caps rows to keep email size reasonable.
 */
const formatExceptionsForEmailHtml = (exceptionSummary, { maxRows = 25 } = {}) => {
  if (!exceptionSummary) {
    return '<p>No comparison exception details were attached to this resubmit request.</p>'
  }

  const summary = exceptionSummary.comparisonSummary
  const highlights = exceptionSummary.highlights || []
  const exceptions = exceptionSummary.exceptions || []

  let html = ''

  if (summary) {
    html += '<table role="presentation" cellspacing="0" cellpadding="6" style="width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;">'
    html += '<tr style="background:#f3f4f6;"><th align="left">Metric</th><th align="right">Count</th></tr>'
    const rows = [
      ['Expected lines', summary.expectedLines],
      ['Vendor lines', summary.vendorLines],
      ['Matched', summary.matchedLines],
      ['Missing', summary.missingItems],
      ['Extra', summary.extraItems],
      ['Qty mismatches', summary.qtyMismatches],
      ['Length mismatches', summary.lengthMismatches],
      ['Ambiguous', summary.ambiguousMatches],
      ['Part mismatches', summary.partMismatches],
    ]
    for (const [label, count] of rows) {
      if (count == null) continue
      html += `<tr><td>${escapeHtml(label)}</td><td align="right">${escapeHtml(count)}</td></tr>`
    }
    html += '</table>'
  }

  if (highlights.length) {
    html += '<p style="margin:12px 0 6px;font-weight:bold;">Issue breakdown</p><ul style="margin:0;padding-left:20px;">'
    for (const group of highlights) {
      html += `<li>${escapeHtml(formatIssueTypeLabel(group.issueType))}: ${escapeHtml(group.count)}</li>`
    }
    html += '</ul>'
  }

  const detailRows = exceptions.slice(0, maxRows)
  if (detailRows.length) {
    html += '<p style="margin:16px 0 6px;font-weight:bold;">Exception details</p>'
    html += '<table role="presentation" cellspacing="0" cellpadding="8" style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;">'
    html += '<tr style="background:#f3f4f6;"><th align="left">Type</th><th align="left">Mark</th><th align="left">Severity</th><th align="left">Details</th></tr>'
    for (const row of detailRows) {
      html += '<tr>'
      html += `<td style="border-top:1px solid #e5e7eb;">${escapeHtml(formatIssueTypeLabel(row.issueType))}</td>`
      html += `<td style="border-top:1px solid #e5e7eb;">${escapeHtml(row.mark || '—')}</td>`
      html += `<td style="border-top:1px solid #e5e7eb;">${escapeHtml(row.severity || '')}</td>`
      html += `<td style="border-top:1px solid #e5e7eb;">${escapeHtml(row.reason || '')}</td>`
      html += '</tr>'
    }
    html += '</table>'
    if (exceptions.length > maxRows) {
      html += `<p style="font-size:12px;color:#6b7280;">Showing ${maxRows} of ${exceptions.length} exceptions. Open the upload link for the full list.</p>`
    }
  }

  return html || '<p>Please review the upload page for comparison details.</p>'
}

const formatExceptionsForEmailText = (exceptionSummary, { maxRows = 25 } = {}) => {
  if (!exceptionSummary) return 'No comparison exception details were attached.'

  const lines = []
  const summary = exceptionSummary.comparisonSummary
  if (summary) {
    lines.push(
      `Expected ${summary.expectedLines}, vendor ${summary.vendorLines}, matched ${summary.matchedLines}, missing ${summary.missingItems}, extra ${summary.extraItems}, qty mismatches ${summary.qtyMismatches}`
    )
  }

  for (const row of (exceptionSummary.exceptions || []).slice(0, maxRows)) {
    lines.push(
      `- ${formatIssueTypeLabel(row.issueType)} | mark ${row.mark || 'n/a'} | ${row.reason || ''}`
    )
  }

  if ((exceptionSummary.exceptions || []).length > maxRows) {
    lines.push(`... and ${exceptionSummary.exceptions.length - maxRows} more (see upload page).`)
  }

  return lines.join('\n')
}

const buildExceptionHighlights = (exceptions = []) => {
  const byType = {}
  for (const row of exceptions) {
    const type = row.issueType || 'unknown'
    if (!byType[type]) {
      byType[type] = { issueType: type, count: 0, samples: [] }
    }
    byType[type].count += 1
    if (byType[type].samples.length < 5) {
      byType[type].samples.push({
        mark: row.mark || null,
        severity: row.severity || null,
        reason: row.reason || '',
        direction: row.direction || null,
      })
    }
  }
  return Object.values(byType)
}

const buildVendorExceptionSummary = (request) => {
  const summary = request.comparisonSummary || null
  const exceptions = Array.isArray(request.exceptions) ? request.exceptions : []
  const blockers = getComparisonBlockers(summary)

  return {
    blockers,
    canProceedToApproval: summary ? blockers.length === 0 : false,
    comparisonSummary: summary
      ? {
          expectedLines: summary.expectedLines ?? null,
          vendorLines: summary.vendorLines ?? null,
          matchedLines: summary.matchedLines ?? null,
          missingItems: summary.missingItems ?? 0,
          extraItems: summary.extraItems ?? 0,
          qtyMismatches: summary.qtyMismatches ?? 0,
          lengthMismatches: summary.lengthMismatches ?? 0,
          weightMismatches: summary.weightMismatches ?? 0,
          priceMismatches: summary.priceMismatches ?? 0,
          partMismatches: summary.partMismatches ?? 0,
          ambiguousMatches: summary.ambiguousMatches ?? 0,
          manualReviewRequired: summary.manualReviewRequired ?? 0,
        }
      : null,
    exceptionCount: exceptions.length,
    exceptions: exceptions.slice(0, 150),
    highlights: buildExceptionHighlights(exceptions),
    priorQuoteValue: request.quoteValue ?? null,
    priorSubmittedFileName: request.submittedFileName || '',
    priorSubmittedAt: request.submittedAt || null,
  }
}

const buildAutoResubmitNote = (exceptionSummary) => {
  if (!exceptionSummary?.comparisonSummary) {
    return 'Please review the comparison exceptions and submit a revised quote.'
  }
  const s = exceptionSummary.comparisonSummary
  const parts = []
  if (s.missingItems) parts.push(`${s.missingItems} missing`)
  if (s.extraItems) parts.push(`${s.extraItems} extra`)
  if (s.qtyMismatches) parts.push(`${s.qtyMismatches} qty mismatch`)
  if (s.lengthMismatches) parts.push(`${s.lengthMismatches} length mismatch`)
  if (s.ambiguousMatches) parts.push(`${s.ambiguousMatches} ambiguous`)
  if (s.partMismatches) parts.push(`${s.partMismatches} part mismatch`)
  if (!parts.length) return 'Please submit a revised quote.'
  return `Please correct the following comparison issues and resubmit: ${parts.join(', ')}.`
}

module.exports = {
  buildVendorUploadPageUrl,
  getComparisonBlockers,
  buildVendorExceptionSummary,
  buildAutoResubmitNote,
  buildExceptionHighlights,
  formatIssueTypeLabel,
  formatExceptionsForEmailHtml,
  formatExceptionsForEmailText,
  ISSUE_TYPE_LABELS,
  RESUBMIT_ALLOWED_STATUSES,
}
