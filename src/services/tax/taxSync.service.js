const Tax = require('../../models/Tax')
const TaxComplianceSettings = require('../../models/TaxComplianceSettings')
const Invoice = require('../../models/Invoice')
const { getActiveTaxProvider, isAvalaraConfigured } = require('../../config/taxEngine')
const returnsClient = require('../avalara/returnsGraphqlClient')
const User = require('../../models/User')
const { computeSalesTaxRate } = require('../../utils/taxSalesRate.util')

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100

const salesRateForRow = (taxCollected, taxableSales) => computeSalesTaxRate(taxCollected, taxableSales)

const CUSTOMER_INVOICE_MATCH = {
  invoiceType: { $nin: ['vendor', 'freight_carrier'] },
  status: { $in: ['sent', 'paid'] },
  'avalara.documentStatus': 'Committed',
}

/** Copy AvaTax totals onto invoice when commit saved avalara but omitted split fields. */
const backfillInvoiceAvalaraTaxFields = async () => {
  const cursor = Invoice.find({
    'avalara.documentStatus': 'Committed',
    'avalara.totalTaxable': { $gt: 0 },
  }).select('_id tax taxableSales taxCollected avalara')

  let updated = 0
  for await (const inv of cursor) {
    const taxable = round2(inv.avalara?.totalTaxable)
    const tax = round2(inv.avalara?.totalTax ?? inv.tax)
    if (taxable <= 0 && tax <= 0) continue
    await Invoice.updateOne(
      { _id: inv._id },
      {
        $set: {
          taxableSales: taxable > 0 ? taxable : inv.taxableSales,
          taxCollected: tax > 0 ? tax : inv.taxCollected,
          tax: tax > 0 ? tax : inv.tax,
        },
      }
    )
    updated += 1
  }
  return updated
}

/** Avalara-first rollup amounts for state / project sync. */
const resolveInvoiceTaxRollup = (inv) => {
  const a = inv.avalara || {}
  if (a.documentStatus !== 'Committed') return null

  const taxableSales = round2(a.totalTaxable ?? inv.taxableSales ?? 0)
  const taxCollected = round2(a.totalTax ?? inv.taxCollected ?? inv.tax ?? 0)
  const taxDue = taxCollected

  if (taxableSales <= 0 && taxCollected <= 0) return null
  if (taxableSales > 0 && taxCollected > taxableSales) {
    return null
  }

  return { taxableSales, taxCollected, taxDue }
}

const resolveSyncActorId = async () => {
  const admin = await User.findOne({ role: 'admin' }).select('_id').lean()
  return admin?._id || null
}

/** Roll up committed customer invoices by state for local dev / pre-Returns sync. */
const syncFromCommittedInvoices = async () => {
  const actorId = await resolveSyncActorId()
  if (!actorId) throw new Error('No admin user found to attribute synced tax records')

  const backfilled = await backfillInvoiceAvalaraTaxFields()

  const invoices = await Invoice.find(CUSTOMER_INVOICE_MATCH)
    .select('leadId tax taxableSales taxCollected shipToAddress avalara')
    .populate('leadId', 'state installAddress city pincode location')
    .lean()

  const byState = new Map()
  for (const inv of invoices) {
    const amounts = resolveInvoiceTaxRollup(inv)
    if (!amounts) continue
    const region =
      inv.shipToAddress?.state ||
      inv.leadId?.state ||
      inv.leadId?.installAddress?.state ||
      ''
    if (!region) continue
    const key = region.toUpperCase()
    const bucket = byState.get(key) || {
      state: key,
      taxCollected: 0,
      taxableSales: 0,
      taxDue: 0,
    }
    bucket.taxCollected += amounts.taxCollected
    bucket.taxableSales += amounts.taxableSales
    bucket.taxDue += amounts.taxDue
    byState.set(key, bucket)
  }

  const now = new Date()
  const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 20)

  const byLead = new Map()
  for (const inv of invoices) {
    const amounts = resolveInvoiceTaxRollup(inv)
    if (!amounts) continue
    const leadRef = inv.leadId
    const leadId = leadRef?._id || leadRef
    if (!leadId) continue
    const key = String(leadId)
    const region =
      inv.shipToAddress?.state ||
      leadRef?.state ||
      leadRef?.installAddress?.state ||
      'NA'
    const bucket = byLead.get(key) || {
      leadId,
      state: String(region).toUpperCase(),
      taxCollected: 0,
      taxableSales: 0,
      taxDue: 0,
    }
    bucket.taxCollected += amounts.taxCollected
    bucket.taxableSales += amounts.taxableSales
    bucket.taxDue += amounts.taxDue
    byLead.set(key, bucket)
  }

  for (const row of byState.values()) {
    const payable = Math.max(0, row.taxDue)
    await Tax.findOneAndUpdate(
      { state: row.state, source: 'sync', leadId: null, periodKey: 'rolling' },
      {
        $set: {
          state: row.state,
          dueDate,
          amount: row.taxDue,
          taxableSales: row.taxableSales,
          taxCollected: row.taxCollected,
          taxDue: row.taxDue,
          paidFiled: 0,
          payable,
          status: payable > 0 ? 'pending' : 'paid',
          source: 'sync',
          periodKey: 'rolling',
          syncedAt: now,
          filingFrequency: 'monthly',
          salesTaxRate: salesRateForRow(row.taxCollected, row.taxableSales),
        },
        $setOnInsert: { createdBy: actorId },
      },
      { upsert: true, new: true }
    )
  }

  for (const row of byLead.values()) {
    const payable = Math.max(0, row.taxDue)
    await Tax.findOneAndUpdate(
      { source: 'sync', leadId: row.leadId, periodKey: 'rolling' },
      {
        $set: {
          state: row.state,
          dueDate,
          amount: row.taxDue,
          taxableSales: row.taxableSales,
          taxCollected: row.taxCollected,
          taxDue: row.taxDue,
          paidFiled: 0,
          payable,
          status: payable > 0 ? 'pending' : 'paid',
          source: 'sync',
          periodKey: 'rolling',
          syncedAt: now,
          filingFrequency: 'monthly',
          leadId: row.leadId,
          salesTaxRate: salesRateForRow(row.taxCollected, row.taxableSales),
        },
        $setOnInsert: { createdBy: actorId },
      },
      { upsert: true, new: true }
    )
  }

  await TaxComplianceSettings.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        lastReturnsSyncAt: now,
        lastReturnsSyncError: '',
        syncStatus: byState.size ? 'synced' : 'empty',
        returnsAccountStatus: isAvalaraConfigured() ? 'ACTIVE' : 'LOCAL_DEV',
      },
    },
    { upsert: true }
  )

  return {
    syncedAt: now,
    regions: byState.size,
    projects: byLead.size,
    provider: getActiveTaxProvider(),
    invoicesBackfilled: backfilled,
  }
}

const syncFromAvalaraReturns = async () => {
  if (!returnsClient.isReturnsConfigured()) return null

  const actorId = await resolveSyncActorId()
  if (!actorId) throw new Error('No admin user found to attribute synced tax records')

  const companyId = Number(process.env.AVALARA_COMPANY_ID)
  const filings = await returnsClient.listFilings(companyId)
  if (filings == null) return null

  const now = new Date()
  let count = 0

  for (const f of filings) {
    const region = String(f.region || '').toUpperCase()
    if (!region) continue
    const taxDue = round2(f.taxAmount ?? f.collectAmount ?? 0)
    const taxableSales = round2(f.salesAmount ?? 0)
    const taxCollected = round2(f.taxAmount ?? f.collectAmount ?? 0)
    const dueDate = f.dueDate ? new Date(f.dueDate) : new Date(now.getFullYear(), now.getMonth() + 1, 20)
    const isFiled = String(f.status || '').toLowerCase().includes('file')
    const periodStart = f.startDate ? new Date(f.startDate) : null
    const periodEnd = f.endDate ? new Date(f.endDate) : null
    const periodKey = f.month && f.year ? `${f.year}-${f.month}` : 'rolling'

    await Tax.findOneAndUpdate(
      {
        source: 'avalara',
        state: region,
        leadId: null,
        periodKey,
      },
      {
        $set: {
          state: region,
          dueDate,
          amount: taxDue,
          taxDue,
          taxableSales,
          taxCollected,
          paidFiled: isFiled ? taxDue : 0,
          payable: isFiled ? 0 : taxDue,
          status: isFiled || taxDue <= 0 ? 'paid' : 'pending',
          source: 'avalara',
          periodKey,
          periodStart,
          periodEnd,
          avalaraFilingId: f.filingId ? String(f.filingId) : f.id ? String(f.id) : '',
          syncedAt: now,
          filingFrequency: 'monthly',
          providerMethod: 'Avalara API',
          salesTaxRate: salesRateForRow(taxCollected, taxableSales),
        },
        $setOnInsert: { createdBy: actorId },
      },
      { upsert: true }
    )
    count += 1
  }

  await TaxComplianceSettings.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        lastReturnsSyncAt: now,
        lastReturnsSyncError: '',
        syncStatus: count ? 'synced' : 'empty',
        returnsAccountStatus: 'ACTIVE',
        avalaraCompanyId: String(companyId),
      },
    },
    { upsert: true }
  )

  return {
    syncedAt: now,
    regions: count,
    projects: 0,
    provider: 'avalara',
    mode: 'returns_graphql',
  }
}

exports.syncTaxData = async () => {
  const provider = getActiveTaxProvider()
  if (provider === 'legacy') {
    return { syncedAt: new Date(), message: 'TAX_ENGINE=legacy — sync no-op' }
  }

  await backfillInvoiceAvalaraTaxFields()

  try {
    const fromReturns = await syncFromAvalaraReturns()
    if (fromReturns) return fromReturns
  } catch (err) {
    await TaxComplianceSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: { lastReturnsSyncError: err.message, syncStatus: 'error' } },
      { upsert: true }
    )
    console.warn('[tax-sync] Returns sync failed, falling back to invoices:', err.message)
  }

  return syncFromCommittedInvoices()
}
