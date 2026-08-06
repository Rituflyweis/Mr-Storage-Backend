const Lead = require('../models/Lead')
const roundRobinService = require('./roundRobin.service')
const auditService = require('./audit.service')
const leadListSocket = require('./leadListSocket.service')
const { extractPlannedStartFromMessages } = require('../utils/parsePlannedStart')
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

const getPrecedingAiMessage = (messages, customerIndex) => {
  for (let j = customerIndex - 1; j >= 0; j -= 1) {
    if (messages[j]?.senderType === 'ai') return messages[j]
  }
  return null
}

/** Alex asked about budget/price/cost — bare numeric replies may be budget. */
const aiAskedAboutBudget = (text = '') => {
  const t = String(text).toLowerCase()
  return (
    /\bbudget\b/.test(t) ||
    /\bprice\s*range\b/.test(t) ||
    /what(?:'s| is) your (?:budget|price)/.test(t) ||
    /how much (?:are you|do you|would you)/.test(t) ||
    (/\bcost\b/.test(t) && /\b(your|project|looking|expect|have in mind)\b/.test(t)) ||
    /\ballocated\b/.test(t) ||
    /(?:what|how much).*\bspend\b/.test(t) ||
    /\bafford\b/.test(t)
  )
}

const customerMessageHasExplicitBudget = (text = '') => {
  const t = String(text).toLowerCase()
  return (
    /\$/.test(t) ||
    /\d+\s*k\b/.test(t) ||
    /\b(dollars?|usd|bucks)\b/.test(t) ||
    /\bbudget\b/.test(t) ||
    /\b(thousand|million)\b/.test(t)
  )
}

const textMentionsBudgetContext = (text = '') => {
  const t = String(text).toLowerCase()
  return customerMessageHasExplicitBudget(t) || aiAskedAboutBudget(t)
}

/** Amounts that are clearly calendar years, not dollars. */
const looksLikeYearAnswer = (amount, precedingAiText = '') => {
  if (!Number.isFinite(amount) || amount !== Math.floor(amount)) return false
  if (amount < 2020 || amount > 2035) return false
  const ai = String(precedingAiText).toLowerCase()
  return (
    /\byear\b/.test(ai) ||
    /\bwhen\b/.test(ai) ||
    /\btimeline\b/.test(ai) ||
    /\bstart\b/.test(ai)
  )
}

/** Parse when the customer used $, k, dollars, budget, etc. */
const parseExplicitBudgetFromText = (text) => {
  const t = String(text || '').toLowerCase().replace(/,/g, '').trim()
  if (!t) return 0

  const kMatch = t.match(/(?:\$?\s*)(\d+(?:\.\d+)?)\s*k\b/)
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000)

  if (/\$/.test(t)) {
    const dollarMatch = t.match(/\$\s*(\d+(?:\.\d+)?)/)
    if (dollarMatch) {
      const n = parseFloat(dollarMatch[1])
      if (n > 0) return Math.round(n)
    }
  }

  const currencyWordMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:dollars?|usd|bucks)\b/)
  if (currencyWordMatch) {
    const n = parseFloat(currencyWordMatch[1])
    if (n > 0) return Math.round(n)
  }

  const thousandMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:thousand|million)\b/)
  if (thousandMatch) {
    const n = parseFloat(thousandMatch[1])
    const mult = /\bmillion\b/.test(t) ? 1_000_000 : 1_000
    if (n > 0) return Math.round(n * mult)
  }

  const budgetMatch = t.match(/\bbudget\b[^0-9$]*\$?\s*(\d+(?:\.\d+)?)\s*k?\b/)
  if (budgetMatch) {
    let n = parseFloat(budgetMatch[1])
    if (/\d+\s*k\b/.test(budgetMatch[0])) n *= 1000
    if (n > 0) return Math.round(n)
  }

  return 0
}

/** Whole-message numeric reply — only valid when Alex just asked about budget. */
const parseBareNumberBudget = (text, precedingAiText = '') => {
  const trimmed = String(text || '').replace(/,/g, '').trim()
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return 0

  const n = parseFloat(trimmed)
  if (n <= 0) return 0
  if (looksLikeYearAnswer(n, precedingAiText)) return 0

  return Math.round(n)
}

const parseBudgetFromCustomerMessage = (content, precedingAiText = '') => {
  if (customerMessageHasExplicitBudget(content)) {
    return parseExplicitBudgetFromText(content)
  }
  if (aiAskedAboutBudget(precedingAiText)) {
    return parseBareNumberBudget(content, precedingAiText)
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
    const precedingAi = getPrecedingAiMessage(messages, i)
    const amount = parseBudgetFromCustomerMessage(m.content, precedingAi?.content || '')
    if (amount > 0) return amount
  }

  const budgetReason = scoreData.scoreBreakdown?.budgetSignals?.reason || ''
  if (textMentionsBudgetContext(budgetReason)) {
    const fromReason = parseExplicitBudgetFromText(budgetReason)
    if (fromReason > 0) return fromReason
  }

  const requirements = scoreData.requirements || ''
  if (textMentionsBudgetContext(requirements)) {
    const fromRequirements = parseExplicitBudgetFromText(requirements)
    if (fromRequirements > 0) return fromRequirements
  }

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

const toTrimmedString = (value) => {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

/** Merge project field updates — only non-empty extracted values are applied. */
const buildProjectFieldsUpdate = (fields = {}) => {
  const update = {}
  const buildingType = toTrimmedString(fields.buildingType)
  const location = toTrimmedString(fields.location)
  const sqft = toTrimmedString(fields.sqft)
  const roofStyle = toTrimmedString(fields.roofStyle)

  if (buildingType) update.buildingType = buildingType
  if (location) update.location = location
  if (sqft) update.sqft = sqft
  if (roofStyle) update.roofStyle = roofStyle

  const width = toNumberOrNull(fields.width)
  const length = toNumberOrNull(fields.length)
  const height = toNumberOrNull(fields.height)
  const numDoors = toNumberOrNull(fields.numDoors)
  const numWindows = toNumberOrNull(fields.numWindows)
  const numInsulation = toNumberOrNull(fields.numInsulation)

  if (width != null) update.width = width
  if (length != null) update.length = length
  if (height != null) update.height = height
  if (numDoors != null) update.numDoors = numDoors
  if (numWindows != null) update.numWindows = numWindows
  if (numInsulation != null) update.numInsulation = numInsulation

  return update
}

/** Fallback parsing when structured fields are missing from the scorer. */
const inferProjectFieldsFromRequirements = (requirements = '') => {
  const text = toTrimmedString(requirements)
  if (!text) return {}

  const inferred = {}
  const sqftMatch = text.match(/(\d[\d,]*)\s*sq\s*ft/i)
  if (sqftMatch) inferred.sqft = sqftMatch[1].replace(/,/g, '')

  const locMatch = text.match(/\b(?:in|at)\s+([A-Za-z][A-Za-z\s.-]{1,40}?)(?:\s+with|\s+area|,|$)/i)
  if (locMatch) inferred.location = locMatch[1].trim()

  const typeMatch = text.match(
    /\b(\d[\d,]*\s*sq\s*ft\s+)?([a-z][a-z\s-]{2,30}?)(?=\s+in\s+|\s+with\s+|,|$)/i
  )
  if (typeMatch?.[2]) {
    const candidate = typeMatch[2].trim()
    if (!/^\d/.test(candidate)) inferred.buildingType = candidate
  }

  const roofMatch = text.match(/\bwith\s+([a-z][a-z\s-]{2,30}?)\s+roofing/i)
  if (roofMatch) inferred.roofStyle = roofMatch[1].trim()

  return inferred
}

const syncLeadProjectFields = async (leadId, quoteData, extraFields = {}) => {
  const d = quoteData?.details || {}
  const fromQuote = {
    sqft: d.sqft,
    location: d.region,
    roofStyle: d.roofType,
    buildingType: d.buildingType,
    width: d.width,
    length: d.length,
    height: d.height,
    numDoors: d.doors,
    numWindows: d.windows,
    numInsulation: d.insulation,
  }

  if (d.specialRequirements) {
    const lower = String(d.specialRequirements).toLowerCase()
    if (!fromQuote.buildingType) {
      if (lower.includes('warehouse')) fromQuote.buildingType = 'warehouse'
      else if (lower.includes('garage')) fromQuote.buildingType = 'garage'
      else if (lower.includes('car')) fromQuote.buildingType = 'car warehouse'
    }
  }

  const update = buildProjectFieldsUpdate({ ...fromQuote, ...extraFields })
  if (Object.keys(update).length) {
    await Lead.findByIdAndUpdate(leadId, { $set: update })
  }
}

/** Persist planned start when customer answers Alex's timeline question. */
const syncPlannedStartFromMessages = async (leadId, messages = []) => {
  const plannedStartDate = extractPlannedStartFromMessages(messages)
  if (!plannedStartDate) return

  await Lead.findByIdAndUpdate(leadId, { $set: { plannedStartDate } })
}

/** Persist buildingType, location, etc. from AI scoring after each chat turn. */
const syncLeadProjectFieldsFromScore = async (leadId, scoreData = {}) => {
  const structured = scoreData.projectFields && typeof scoreData.projectFields === 'object'
    ? scoreData.projectFields
    : {}
  const inferred = inferProjectFieldsFromRequirements(scoreData.requirements || '')
  const update = buildProjectFieldsUpdate({ ...inferred, ...structured })
  if (Object.keys(update).length) {
    await Lead.findByIdAndUpdate(leadId, { $set: update })
  }
}

const loadLeadForHandoff = (leadId) =>
  Lead.findById(leadId).populate('customerId').populate('assignedSales').lean()

/**
 * Round-robin assign sales when AI completes handoff.
 * Skipped when admin/sales already intervened or lead is already assigned.
 */
const attemptSalesHandoff = async (leadId, customerId) => {
  const state = await Lead.findById(leadId)
    .select('isStaffChatActive isHandedToSales assignedSales')
    .lean()

  if (!state) return null

  if (state.isHandedToSales) {
    return loadLeadForHandoff(leadId)
  }

  if (state.isStaffChatActive) {
    console.info('[LeadQuoteReady] Staff chat active — skipping auto-assign for lead', leadId)
    return loadLeadForHandoff(leadId)
  }

  if (state.assignedSales) {
    await Lead.findByIdAndUpdate(leadId, { isHandedToSales: true })
    return loadLeadForHandoff(leadId)
  }

  const assignedId = await roundRobinService.assignNextSales(leadId, customerId)
  const updatedLead = await loadLeadForHandoff(leadId)

  if (!updatedLead?.isHandedToSales) {
    console.warn('[LeadQuoteReady] Quote ready but sales handoff pending — no active sales user?', leadId)
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
}

/**
 * Mark lead quote-ready, notify admin, and auto-assign sales via round-robin
 * unless staff already intervened in chat.
 */
const handleQuoteReady = async (leadId, customerId, quoteData, options = {}) => {
  const { messages = [], scoreData = {} } = options

  try {
    const existing = await Lead.findById(leadId)
      .select('isQuoteReady isHandedToSales quoteValue isStaffChatActive assignedSales')
      .lean()
    if (!existing) return null

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

    return attemptSalesHandoff(leadId, customerId)
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
  syncLeadProjectFieldsFromScore,
  syncPlannedStartFromMessages,
}
