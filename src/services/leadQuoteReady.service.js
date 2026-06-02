const Lead = require('../models/Lead')
const roundRobinService = require('./roundRobin.service')
const auditService = require('./audit.service')
const leadListSocket = require('./leadListSocket.service')
const { AUDIT_ACTIONS, LIFECYCLE_STAGES } = require('../config/constants')

const advanceLifecycleIfNeeded = async (leadId, stage) => {
  if (!stage || !LIFECYCLE_STAGES.includes(stage)) return

  const lead = await Lead.findById(leadId)
  if (!lead) return

  const newIdx = LIFECYCLE_STAGES.indexOf(stage)
  const currentIdx = LIFECYCLE_STAGES.indexOf(lead.lifecycleStatus)
  if (newIdx <= currentIdx) return

  lead.lifecycleStatus = stage
  lead.lifecycleHistory.push({
    stage,
    changedAt: new Date(),
    changedBy: null,
  })
  await lead.save()
}

const parseBudgetFromText = (text) => {
  const t = String(text || '').toLowerCase().replace(/,/g, '').trim()
  if (!t) return 0

  const kMatch = t.match(/(?:\$?\s*)(\d+(?:\.\d+)?)\s*k\b/)
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000)

  const dollarMatch = t.match(/(?:\$?\s*)(\d+(?:\.\d+)?)(?:\s*(?:dollars?|usd|bucks?))?/)
  if (dollarMatch) {
    const n = parseFloat(dollarMatch[1])
    if (n > 0) return Math.round(n)
  }
  return 0
}

/** Customer-stated budget — used for lead.quoteValue (not internal AI estimate). */
const extractCustomerBudget = (messages = [], quoteData = {}, scoreData = {}) => {
  const direct =
    quoteData.customerBudget ??
    quoteData.details?.customerBudget ??
    quoteData.details?.budget
  const fromMeta = Number(direct)
  if (!Number.isNaN(fromMeta) && fromMeta > 0) return fromMeta

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m.senderType !== 'customer') continue
    const amount = parseBudgetFromText(m.content)
    if (amount > 0) return amount
  }

  const budgetReason = scoreData.scoreBreakdown?.budgetSignals?.reason || ''
  const fromReason = parseBudgetFromText(budgetReason)
  if (fromReason > 0) return fromReason

  const fromRequirements = parseBudgetFromText(scoreData.requirements || '')
  if (fromRequirements > 0) return fromRequirements

  return 0
}

/** Server-side quote payload when the model omits quoteData. */
const buildFallbackQuoteData = (lead, scoreData = {}, messages = []) => {
  const summary = scoreData.requirements || lead.leadScoring?.requirements || ''
  const sqftMatch = summary.match(/(\d[\d,]*)\s*sq\s*ft/i)
  const sqft = sqftMatch ? sqftMatch[1].replace(/,/g, '') : ''

  let region = ''
  const locMatch = summary.match(/\b(in|at)\s+([A-Za-z\s,]+?)(?:,|\s+with|\s*$)/i)
  if (locMatch) region = locMatch[2].trim()

  const customerBudget = extractCustomerBudget(messages, {}, scoreData)

  return {
    customerBudget,
    priceMin: 0,
    priceMax: 0,
    complexity: 3,
    basis: 'Requirements gathered — sales to prepare formal quote',
    details: {
      sqft,
      roofType: '',
      wallPanels: '',
      insulation: '',
      doors: '',
      region,
      specialRequirements: summary,
      customerBudget,
    },
  }
}

const syncLeadProjectFields = async (leadId, quoteData) => {
  const d = quoteData?.details || {}
  const update = {}
  if (d.sqft) update.sqft = String(d.sqft)
  if (d.region) update.location = String(d.region)
  if (d.roofType) update.roofStyle = String(d.roofType)
  if (d.specialRequirements) {
    const lower = String(d.specialRequirements).toLowerCase()
    if (lower.includes('warehouse')) update.buildingType = 'warehouse'
    else if (lower.includes('car')) update.buildingType = 'car warehouse'
  }
  if (Object.keys(update).length) {
    await Lead.findByIdAndUpdate(leadId, update)
  }
}

/**
 * Mark lead quote-ready, assign sales (round-robin), notify customer + admin.
 * Retries assignment when isQuoteReady is already set but handoff failed earlier.
 */
const handleQuoteReady = async (leadId, customerId, quoteData, options = {}) => {
  const { messages = [], scoreData = {} } = options

  try {
    const existing = await Lead.findById(leadId).select('isQuoteReady isHandedToSales quoteValue').lean()
    if (!existing || existing.isHandedToSales) {
      return null
    }

    const quoteValue = extractCustomerBudget(messages, quoteData, scoreData)

    if (!existing.isQuoteReady) {
      await Lead.findByIdAndUpdate(leadId, {
        isQuoteReady: true,
        quoteValue,
        aiQuoteData: quoteData,
      })

      await syncLeadProjectFields(leadId, quoteData)

      await auditService.log({
        type: 'lead',
        action: AUDIT_ACTIONS.LEAD_QUOTE_READY,
        leadId,
        customerId,
        performedBy: null,
        metadata: { quoteValue, customerBudget: quoteValue },
      })

      if (global.io) {
        global.io.of('/admin').to('admin_room').emit('lead_quote_ready', { leadId, customerId })
      }
      await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'quote_ready', includeScoreRow: true })
    } else if (quoteValue > 0 && !existing.quoteValue) {
      await Lead.findByIdAndUpdate(leadId, { quoteValue, aiQuoteData: quoteData })
      await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'quote_ready', includeScoreRow: true })
    }

    const assignedId = await roundRobinService.assignNextSales(leadId, customerId)

    const updatedLead = await Lead.findById(leadId)
      .populate('customerId')
      .populate('assignedSales')
      .lean()

    if (!updatedLead?.isHandedToSales) {
      console.warn('[LeadQuoteReady] Quote ready but sales handoff pending — no active sales user?', leadId)
      await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'quote_ready', includeScoreRow: true })
      return updatedLead
    }

    const assignedName = updatedLead?.assignedSales?.name || 'a sales representative'

    if (global.io) {
      global.io.of('/chat').to(`lead:${leadId}`).emit('lead_handed_to_sales', {
        assignedSales: assignedName,
      })
    }

    if (assignedId) {
      await auditService.log({
        type: 'lead',
        action: AUDIT_ACTIONS.LEAD_HANDED_TO_SALES,
        leadId,
        customerId,
        performedBy: null,
        metadata: { assignedTo: assignedId },
      })
    }

    return updatedLead
  } catch (err) {
    console.error('[LeadQuoteReady] handleQuoteReady error:', err.message)
    return null
  }
}

module.exports = {
  handleQuoteReady,
  advanceLifecycleIfNeeded,
  buildFallbackQuoteData,
  extractCustomerBudget,
}
