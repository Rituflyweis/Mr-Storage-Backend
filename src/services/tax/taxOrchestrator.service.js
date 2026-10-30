const Invoice = require('../../models/Invoice')
const Lead = require('../../models/Lead')
const TaxTransaction = require('../../models/TaxTransaction')
const { getActiveTaxProvider, getCompanyCode, isProductionEnv } = require('../../config/taxEngine')
const { buildInstallAddressFromLead, isTaxAddressReady } = require('../../models/schemas/structuredAddress')
const { lookupSalesTaxByZip } = require('../quoting/salesTaxLookup')
const avatax = require('../avalara/avataxClient')
const { buildTaxLinesFromInvoice, isTaxableCode, round2 } = require('./invoiceTaxLines.util')
const taxMapping = require('./taxMapping.service')
const { getShipFromTaxReadiness, toAvaShipFrom } = require('../../utils/avalaraShipFrom.util')

const transactionCodeForInvoice = (invoice) =>
  `INV-${invoice._id}-R${invoice.revision || 1}`

/**
 * Persist an AvaTax transaction attempt for reconciliation (§1, §6, §10).
 * Upserts one row per (invoice, document_code); never throws into the tax flow.
 */
const recordTaxTransaction = async ({ invoice, type, status, model, result, error, correlationId }) => {
  try {
    const documentCode =
      result?.code || model?.code || invoice?.avalara?.transactionCode || transactionCodeForInvoice(invoice)
    const set = {
      internal_document_id: String(invoice?._id || ''),
      document_code: documentCode,
      transaction_type: type || model?.type || '',
      status: status || result?.status || (error ? 'error' : ''),
      correlationId: correlationId || result?.correlationId || error?.correlationId || '',
      calculated_at: new Date(),
    }
    if (model) set.request_json = model
    if (result) {
      set.response_json = result
      if (result.id) set.avalara_transaction_id = String(result.id)
      set.total_tax = round2(result.totalTax)
      set.amount = round2(result.totalAmount ?? result.totalTaxable ?? 0)
    }
    if (error) {
      set.error_json = {
        message: error.message,
        status: error.status || null,
        avataxError: error.avataxError || null,
        correlationId: error.correlationId || null,
      }
    }
    if (status === 'Committed') set.committed_at = new Date()
    await TaxTransaction.findOneAndUpdate(
      { internal_document_id: set.internal_document_id, document_code: documentCode },
      { $set: set },
      { upsert: true }
    )
  } catch (e) {
    console.warn('[tax-tx] record failed:', e.message)
  }
}

/** Compact per-line code freeze for reconciliation (§6 "freeze chosen code"). */
const freezeLineCodes = (resolutions = []) =>
  resolutions.map((r) => ({
    number: r.number,
    taxCode: r.code,
    approved: r.approved,
    source: r.source,
    category: r.category || '',
    amount: round2(r.amount),
  }))

const buildWarnings = (resolutions = []) => {
  const unapproved = resolutions.filter((r) => !r.approved)
  if (!unapproved.length) return []
  const cats = [...new Set(unapproved.map((r) => r.category || r.source))]
  return [
    `TEST-ONLY tax: ${unapproved.length} line(s) used unapproved placeholder codes (${cats.join(', ')}). Approve official Avalara codes before production.`,
  ]
}

/**
 * Resolve a usable exemption for the invoice. Never assume a business customer is
 * exempt (§3): exemption applies only when isExempt AND a usage code or
 * certificate/exemption number is present. Returns { apply, entityUseCode,
 * exemptionNo, warning }.
 */
const resolveExemption = (invoice = {}) => {
  const ex = invoice.exemption || {}
  if (!ex.isExempt) return { apply: false }
  const entityUseCode = String(ex.entityUseCode || '').trim()
  const exemptionNo = String(ex.exemptionNo || ex.certificateRef || '').trim()
  if (!entityUseCode && !exemptionNo) {
    return {
      apply: false,
      warning:
        'Exemption flagged but no entityUseCode or certificate/exemption number provided — treated as TAXABLE.',
    }
  }
  return { apply: true, entityUseCode, exemptionNo }
}

/** Sum of line-item taxAmount (sales UI / quote 8% on materials). */
const sumLineTaxAmounts = (invoice) => {
  if (!Array.isArray(invoice?.lineItems)) return 0
  return round2(
    invoice.lineItems.reduce((s, li) => s + (Number(li.taxAmount) || 0), 0),
  )
}

/**
 * Persist AvaTax/local snapshot on invoice.avalara.
 * Estimates (SalesOrder / testOnly / Saved) must NOT overwrite an existing
 * quote/line tax — that caused INV totals like tax $14,437 vs correct $3,259.
 * Committed tax always wins as the charged amount.
 */
const applyAvalaraSnapshot = (invoice, snapshot) => {
  invoice.avalara = {
    ...(invoice.avalara || {}),
    ...snapshot,
  }

  const committed = String(snapshot.documentStatus || '') === 'Committed'
  const isEstimate =
    !committed &&
    (snapshot.estimate === true ||
      snapshot.testOnly === true ||
      String(snapshot.transactionType || '') === 'SalesOrder' ||
      String(snapshot.documentStatus || '') === 'Saved')

  const existingTax = round2(invoice.tax)
  const lineTax = sumLineTaxAmounts(invoice)
  const preservedTax = existingTax > 0 ? existingTax : lineTax

  if (snapshot.totalTax != null) {
    if (committed || !isEstimate || preservedTax <= 0) {
      invoice.tax = round2(snapshot.totalTax)
    }
    // else: keep quote/line tax; AvaTax figure stays on invoice.avalara.totalTax only
  }
  if (snapshot.totalTaxable != null) {
    invoice.taxableSales = round2(snapshot.totalTaxable)
    invoice.taxCollected = committed ? round2(snapshot.totalTax) : invoice.taxCollected
  }
}

const calculateWithLocalEngine = async (invoice, shipTo, approved) => {
  const lookup = await lookupSalesTaxByZip(shipTo.postalCode)
  const rate = Number(lookup.rate) || 0
  const { lines, resolutions } = buildTaxLinesFromInvoice(invoice, approved)
  const taxableBase = lines
    .filter((l) => isTaxableCode(l.taxCode))
    .reduce((s, l) => s + Number(l.amount || 0), 0)
  const totalTax = rate > 0 ? round2(taxableBase * (rate / 100)) : 0
  return {
    provider: 'local',
    transactionCode: transactionCodeForInvoice(invoice),
    documentStatus: 'Saved',
    totalTax,
    totalTaxable: round2(taxableBase),
    rate,
    message: lookup.message || '',
    // local is always an estimate — never a final charged tax (§5).
    testOnly: true,
    estimate: true,
    mappingVersion: approved?.mappingVersion || 'none',
    lineCodes: freezeLineCodes(resolutions),
    warnings: ['Local engine produces ESTIMATED tax only — not a final charged amount.'],
  }
}

/** Build the AvaTax CreateTransactionModel (shared by calculate, preview, adjust). */
const buildTransactionModel = (invoice, shipTo, lead, approved, { type = 'SalesInvoice', commit = false } = {}) => {
  const { lines, resolutions } = buildTaxLinesFromInvoice(invoice, approved)
  const exemption = resolveExemption(invoice)
  const correlationId = avatax.newCorrelationId()
  const model = {
    lines,
    type,
    companyCode: getCompanyCode(),
    date: new Date(invoice.date || Date.now()).toISOString().slice(0, 10),
    customerCode: String(invoice.customerId || lead?.customerId || 'guest'),
    code: transactionCodeForInvoice(invoice),
    currencyCode: 'USD',
    commit,
    addresses: {
      shipFrom: toAvaShipFrom(invoice),
      shipTo: avatax.toAvaAddress(shipTo),
    },
    description: `Invoice ${invoice.invoiceNumber || ''}`.trim(),
  }
  // Exemption (§3) — only applied when validated; never assumed.
  if (exemption.apply) {
    if (exemption.entityUseCode) model.entityUseCode = exemption.entityUseCode
    if (exemption.exemptionNo) model.exemptionNo = exemption.exemptionNo
  }
  return { model, resolutions, exemption, correlationId, empty: !lines.length }
}

const snapshotFromResult = (result, model, resolutions, approved, exemption, correlationId) => {
  const warnings = buildWarnings(resolutions)
  if (exemption?.warning) warnings.push(exemption.warning)
  return {
    provider: 'avalara',
    transactionType: model.type,
    transactionCode: result.code || model.code,
    documentId: result.id,
    documentStatus: result.status || 'Saved',
    totalTax: round2(result.totalTax),
    totalTaxable: round2(result.totalTaxable),
    jurisdictions: Array.isArray(result.summary) ? result.summary : [],
    exemptionApplied: Boolean(exemption?.apply),
    testOnly: taxMapping.hasUnapprovedCodes(resolutions),
    mappingVersion: approved?.mappingVersion || 'none',
    lineCodes: freezeLineCodes(resolutions),
    warnings,
    correlationId,
  }
}

const calculateWithAvalara = async (invoice, shipTo, lead, approved, opts = {}) => {
  const { model, resolutions, exemption, correlationId, empty } = buildTransactionModel(
    invoice,
    shipTo,
    lead,
    approved,
    opts
  )
  if (empty) {
    return {
      provider: 'avalara',
      transactionType: model.type,
      transactionCode: model.code,
      documentStatus: 'Saved',
      totalTax: 0,
      totalTaxable: 0,
      testOnly: false,
      lineCodes: [],
      correlationId,
    }
  }
  let result
  try {
    result = await avatax.createTransaction(model, { correlationId })
  } catch (err) {
    await recordTaxTransaction({ invoice, type: model.type, status: 'error', model, error: err, correlationId })
    throw err
  }
  await recordTaxTransaction({ invoice, type: model.type, status: result.status || 'Saved', model, result, correlationId })
  return snapshotFromResult(result, model, resolutions, approved, exemption, correlationId)
}

exports.calculateInvoiceTax = async (invoiceDoc, { lead: leadInput } = {}) => {
  const provider = getActiveTaxProvider()
  if (provider === 'legacy') return { skipped: true, provider }

  const lead =
    leadInput ||
    (invoiceDoc.leadId
      ? await Lead.findById(invoiceDoc.leadId).lean()
      : null)
  const shipTo = invoiceDoc.shipToAddress?.line1
    ? invoiceDoc.shipToAddress
    : buildInstallAddressFromLead(lead || {})

  if (!isTaxAddressReady(shipTo)) {
    return {
      skipped: true,
      provider,
      error: 'Project install address is incomplete (line1, city, state, postalCode, country required)',
    }
  }

  invoiceDoc.shipToAddress = shipTo

  if (provider === 'avalara') {
    const shipFromCheck = getShipFromTaxReadiness(invoiceDoc)
    if (!shipFromCheck.ready) {
      return {
        skipped: true,
        provider,
        error: shipFromCheck.error,
        reason: 'ship_from_incomplete',
      }
    }
  }

  const approved = await taxMapping.loadApprovedMappings()

  let snapshot
  if (provider === 'avalara') {
    snapshot = await calculateWithAvalara(invoiceDoc, shipTo, lead, approved)
  } else {
    snapshot = await calculateWithLocalEngine(invoiceDoc, shipTo, approved)
  }

  applyAvalaraSnapshot(invoiceDoc, {
    ...snapshot,
    lastCalculatedAt: new Date(),
  })

  return { ok: true, provider, snapshot }
}

/**
 * Quote estimate (spec §8, §9) — non-committed SalesOrder. Returns tax totals and
 * jurisdiction detail WITHOUT persisting a committed transaction or mutating the
 * invoice's stored tax. Safe to call repeatedly from the quote/checkout UI.
 */
exports.previewInvoiceTax = async (invoiceDoc, { lead: leadInput } = {}) => {
  const provider = getActiveTaxProvider()
  if (provider === 'legacy') return { skipped: true, provider }

  const lead =
    leadInput ||
    (invoiceDoc.leadId ? await Lead.findById(invoiceDoc.leadId).lean() : null)
  const shipTo = invoiceDoc.shipToAddress?.line1
    ? invoiceDoc.shipToAddress
    : buildInstallAddressFromLead(lead || {})

  if (!isTaxAddressReady(shipTo)) {
    return {
      skipped: true,
      provider,
      error: 'Job-site / ship-to address is incomplete (line1, city, state, postalCode, country required)',
      reason: 'ship_to_incomplete',
    }
  }

  if (provider === 'avalara') {
    const shipFromCheck = getShipFromTaxReadiness(invoiceDoc)
    if (!shipFromCheck.ready) {
      return { skipped: true, provider, error: shipFromCheck.error, reason: 'ship_from_incomplete' }
    }
  }

  const approved = await taxMapping.loadApprovedMappings()
  const preview =
    provider === 'avalara'
      ? await calculateWithAvalara({ ...invoiceDoc, shipToAddress: shipTo }, shipTo, lead, approved, {
          type: 'SalesOrder',
          commit: false,
        })
      : await calculateWithLocalEngine(invoiceDoc, shipTo, approved)

  return { ok: true, provider, preview: { ...preview, committed: false, isEstimate: true } }
}

exports.commitInvoiceTax = async (invoiceId) => {
  const provider = getActiveTaxProvider()
  if (provider === 'legacy') return { skipped: true, provider }

  const invoice = await Invoice.findById(invoiceId)
  if (!invoice) throw new Error('Invoice not found')
  if (invoice.invoiceType && invoice.invoiceType !== 'customer') {
    return { skipped: true, reason: 'non_customer_invoice' }
  }
  if (invoice.avalara?.documentStatus === 'Committed') {
    return { ok: true, alreadyCommitted: true }
  }

  const lead = await Lead.findById(invoice.leadId).lean()
  const alreadySaved =
    invoice.avalara?.documentStatus === 'Saved' &&
    invoice.avalara?.transactionCode &&
    Number(invoice.tax || 0) >= 0
  if (!alreadySaved) {
    const calc = await exports.calculateInvoiceTax(invoice, { lead })
    if (calc.skipped) {
      return {
        skipped: true,
        provider,
        error: calc.error,
        reason: calc.reason || 'tax_calc_skipped',
      }
    }
    await invoice.save()
  }

  const code = invoice.avalara?.transactionCode || transactionCodeForInvoice(invoice)
  if (provider === 'avalara') {
    const shipFromCheck = getShipFromTaxReadiness(invoice)
    if (!shipFromCheck.ready) {
      return {
        skipped: true,
        provider,
        error: shipFromCheck.error,
        reason: 'ship_from_incomplete',
      }
    }
    // §5/§8 — never commit test-only (unapproved placeholder) tax as final in production.
    if (invoice.avalara?.testOnly && isProductionEnv()) {
      return {
        skipped: true,
        provider,
        error:
          'Tax used unapproved placeholder codes (test-only). Approve official Avalara tax codes before committing in production.',
        reason: 'unapproved_tax_codes',
        warnings: invoice.avalara?.warnings || [],
      }
    }
    const companyCode = getCompanyCode()
    const correlationId = invoice.avalara?.correlationId || avatax.newCorrelationId()
    try {
      await avatax.commitTransaction(companyCode, code, { correlationId })
    } catch (err) {
      await recordTaxTransaction({ invoice, type: 'SalesInvoice', status: 'error', error: err, correlationId })
      throw err
    }
    await recordTaxTransaction({ invoice, type: 'SalesInvoice', status: 'Committed', correlationId })
  }

  invoice.avalara = {
    ...(invoice.avalara || {}),
    documentStatus: 'Committed',
    committedAt: new Date(),
  }
  invoice.taxCollected = round2(invoice.tax || invoice.avalara?.totalTax || 0)
  invoice.taxableSales = round2(
    invoice.taxableSales ?? invoice.avalara?.totalTaxable ?? 0
  )
  await invoice.save()

  return { ok: true, provider, transactionCode: code }
}

exports.voidInvoiceTax = async (invoiceId) => {
  const provider = getActiveTaxProvider()
  if (provider === 'legacy') return { skipped: true }

  const invoice = await Invoice.findById(invoiceId)
  if (!invoice?.avalara?.transactionCode) return { skipped: true }
  if (invoice.avalara.documentStatus !== 'Committed') return { skipped: true }

  if (provider === 'avalara') {
    const correlationId = avatax.newCorrelationId()
    try {
      await avatax.voidTransaction(getCompanyCode(), invoice.avalara.transactionCode, 'DocVoided', { correlationId })
    } catch (err) {
      await recordTaxTransaction({ invoice, type: 'SalesInvoice', status: 'error', error: err, correlationId })
      throw err
    }
    await recordTaxTransaction({ invoice, type: 'SalesInvoice', status: 'Voided', correlationId })
  }
  invoice.avalara.documentStatus = 'Voided'
  invoice.avalara.voidedAt = new Date()
  invoice.taxCollected = 0
  await invoice.save()
  return { ok: true }
}

/**
 * Corrections / refunds / voids (spec §9). action: 'void' cancels the committed
 * transaction; 'adjust' (default) recalculates — for a committed Avalara doc it
 * uses AvaTax adjust, otherwise it recalculates the saved estimate. Never deletes.
 */
exports.adjustInvoiceTax = async (invoiceId, { action = 'adjust', reason = '' } = {}) => {
  const provider = getActiveTaxProvider()
  if (provider === 'legacy') return { skipped: true, provider }

  const invoice = await Invoice.findById(invoiceId)
  if (!invoice) throw new Error('Invoice not found')

  if (action === 'void') {
    const res = await exports.voidInvoiceTax(invoiceId)
    return { ...res, mode: 'voided' }
  }

  const committed = invoice.avalara?.documentStatus === 'Committed'
  const lead = await Lead.findById(invoice.leadId).lean()

  // Not yet committed, or non-Avalara provider → plain recalculation.
  if (!committed || provider !== 'avalara') {
    const calc = await exports.calculateInvoiceTax(invoice, { lead })
    if (calc.skipped) return { skipped: true, provider, ...calc }
    await invoice.save()
    return { ok: true, provider, mode: 'recalculated', snapshot: calc.snapshot }
  }

  // Committed Avalara doc → AvaTax adjust with a fresh transaction model.
  const shipTo = invoice.shipToAddress?.line1
    ? invoice.shipToAddress
    : buildInstallAddressFromLead(lead || {})
  const shipFromCheck = getShipFromTaxReadiness(invoice)
  if (!shipFromCheck.ready) {
    return { skipped: true, provider, error: shipFromCheck.error, reason: 'ship_from_incomplete' }
  }
  const approved = await taxMapping.loadApprovedMappings()
  const { model, resolutions, exemption, correlationId, empty } = buildTransactionModel(
    invoice,
    shipTo,
    lead,
    approved,
    { type: 'SalesInvoice', commit: false }
  )
  if (empty) return { skipped: true, provider, reason: 'no_lines' }
  if (taxMapping.hasUnapprovedCodes(resolutions) && isProductionEnv()) {
    return {
      skipped: true,
      provider,
      reason: 'unapproved_tax_codes',
      error: 'Adjustment uses unapproved placeholder codes; approve official Avalara codes first.',
    }
  }
  let result
  try {
    result = await avatax.adjustTransaction(
      getCompanyCode(),
      invoice.avalara.transactionCode,
      {
        adjustmentReason: 'PriceAdjusted',
        adjustmentDescription: reason || 'Invoice adjusted',
        newTransaction: model,
      },
      { correlationId }
    )
  } catch (err) {
    await recordTaxTransaction({ invoice, type: 'SalesInvoice', status: 'error', model, error: err, correlationId })
    throw err
  }
  await recordTaxTransaction({ invoice, type: 'SalesInvoice', status: 'Adjusted', model, result, correlationId })
  const snapshot = snapshotFromResult(result, model, resolutions, approved, exemption, correlationId)
  applyAvalaraSnapshot(invoice, {
    ...snapshot,
    documentStatus: 'Committed',
    adjustedAt: new Date(),
    lastCalculatedAt: new Date(),
  })
  invoice.taxCollected = round2(invoice.tax || snapshot.totalTax || 0)
  invoice.taxableSales = round2(snapshot.totalTaxable ?? invoice.taxableSales ?? 0)
  await invoice.save()
  return { ok: true, provider, mode: 'adjusted', snapshot }
}

/** Persisted tax breakdown/status for an invoice (spec §7 GET /invoices/:id/tax). */
exports.getInvoiceTax = async (invoiceId) => {
  const invoice = await Invoice.findById(invoiceId)
    .select('invoiceNumber tax taxableSales taxCollected avalara orderType installationProvider exemption shipToAddress status')
    .lean()
  if (!invoice) return { error: 'not_found' }
  const a = invoice.avalara || {}
  return {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    provider: a.provider || getActiveTaxProvider(),
    documentStatus: a.documentStatus || 'None',
    transactionCode: a.transactionCode || '',
    transactionType: a.transactionType || '',
    totalTax: invoice.tax ?? a.totalTax ?? 0,
    totalTaxable: invoice.taxableSales ?? a.totalTaxable ?? 0,
    taxCollected: invoice.taxCollected ?? 0,
    testOnly: Boolean(a.testOnly),
    estimate: Boolean(a.estimate),
    exemptionApplied: Boolean(a.exemptionApplied),
    orderType: invoice.orderType,
    installationProvider: invoice.installationProvider,
    lineCodes: a.lineCodes || [],
    warnings: a.warnings || [],
    correlationId: a.correlationId || '',
    lastError: a.lastError || '',
    lastCalculatedAt: a.lastCalculatedAt || null,
    committedAt: a.committedAt || null,
    voidedAt: a.voidedAt || null,
  }
}

exports.getTaxComplianceMeta = async () => {
  const TaxComplianceSettings = require('../../models/TaxComplianceSettings')
  const { isAvalaraConfigured } = require('../../config/taxEngine')
  let settings = await TaxComplianceSettings.findOne({ key: 'default' }).lean()
  if (!settings) {
    settings = {
      returnsAccountStatus: 'NOTYETFILING',
      syncStatus: isAvalaraConfigured() ? 'empty' : 'not_configured',
      lastReturnsSyncAt: null,
    }
  }
  const provider = getActiveTaxProvider()
  return {
    provider,
    complianceStatus: settings.returnsAccountStatus,
    lastSyncedAt: settings.lastReturnsSyncAt,
    syncState: settings.syncStatus,
    canSync: provider !== 'legacy' && (provider === 'local' || isAvalaraConfigured()),
    message:
      settings.syncStatus === 'not_configured'
        ? 'Configure Avalara Returns or use local tax engine for development.'
        : settings.syncStatus === 'empty'
          ? 'Tax filings will appear after Avalara compliance review and sync.'
          : '',
  }
}
