const Anthropic = require('@anthropic-ai/sdk')
const Lead = require('../../models/Lead')
const env = require('../../config/env')
const { resolveLeadTemperatureFromScore } = require('../../config/constants')
const leadListSocket = require('../leadListSocket.service')
const { logLeadTemperatureTransition } = require('../leadTemperatureTransition.service')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const SALES_LIFECYCLE_FOR_SCORING = [
  'initial_contact',
  'requirements_gathered',
  'proposal_sent',
  'negotiation',
  'deal_closed',
  'payment_done',
]

const parseCharLimit = (val, fallback) => {
  const n = parseInt(String(val != null ? val : fallback), 10)
  return Number.isNaN(n) ? fallback : n
}

const extractFirstJsonObject = (text) => {
  const input = String(text || '').replace(/```json|```/gi, '').trim()
  const start = input.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < input.length; i += 1) {
    const ch = input[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return input.slice(start, i + 1)
    }
  }
  return null
}

const parseScoreResponse = (raw) => {
  const jsonStr = extractFirstJsonObject(raw)
  if (!jsonStr) return null
  try {
    return JSON.parse(jsonStr)
  } catch (err) {
    console.error('[Scoring] Parse error:', err.message)
    return null
  }
}

const normalizeScoreData = (data) => {
  if (!data || typeof data !== 'object') return null
  const score = Number(data.score)
  if (!Number.isFinite(score)) return null

  const breakdown = data.scoreBreakdown && typeof data.scoreBreakdown === 'object'
    ? data.scoreBreakdown
    : {}

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    scoreBreakdown: breakdown,
    requirements: String(data.requirements || '').trim(),
    requirementsComplete: data.requirementsComplete === true,
    projectLifecycleStage: data.projectLifecycleStage || null,
    projectFields: data.projectFields && typeof data.projectFields === 'object' ? data.projectFields : {},
  }
}

const scoreLead = async (messages, leadName = '') => {
  const maxChars = parseCharLimit(env.CLAUDE_MAX_SCORE_LIVE_CHARS, 18000)
  const currentYear = new Date().getFullYear()

  const transcript = messages
    .filter(m => m.senderType === 'customer' || m.senderType === 'ai')
    .map(m => `${m.senderType === 'customer' ? (leadName || 'Customer') : 'Sam'}: ${m.content}`)
    .join('\n')
    .slice(0, maxChars)

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 512,
    system: 'You are a B2B construction lead scoring engine. Analyse conversations and return ONLY valid JSON — no markdown, no explanation, just the JSON object.',
    messages: [{
      role: 'user',
      content: `Score this construction sales conversation and return ONLY this JSON:
{
  "score": <0-100 integer>,
  "scoreBreakdown": {
    "projectSize":    { "points": <0-25>, "reason": "<brief>" },
    "budgetSignals":  { "points": <0-25>, "reason": "<brief>" },
    "timeline":       { "points": <0-20>, "reason": "<brief>" },
    "decisionMaker":  { "points": <0-15>, "reason": "<brief>" },
    "projectClarity": { "points": <0-15>, "reason": "<brief>" }
  },
  "requirements": "<one sentence project summary>",
  "requirementsComplete": <true ONLY if ALL 10 are explicitly stated by the customer: (1) building type, (2) sqft/size, (3) location, (4) roof type, (5) wall type, (6) insulation, (7) doors/windows count or size, (8) timeline, (9) budget amount or range, (10) decision-maker confirmation OR explicit "no special requirements"; otherwise false>,
  "projectLifecycleStage": "<EXACTLY one of: ${SALES_LIFECYCLE_FOR_SCORING.join(' | ')} | null>",
  "projectFields": {
    "buildingType": "<customer-stated building type e.g. garage, warehouse — empty string if unknown>",
    "location": "<city/region — empty string if unknown>",
    "sqft": "<numeric sqft as string — empty string if unknown>",
    "roofStyle": "<roof type — empty string if unknown>",
    "width": <number or null>,
    "length": <number or null>,
    "height": <number or null>,
    "numDoors": <number or null>,
    "numWindows": <number or null>,
    "numInsulation": <number or null>
  }
}

Scoring guide:
- projectSize (0-25): Large commercial/industrial=25, medium commercial=15, small/residential=8, unclear=0
- budgetSignals (0-25): Budget approved=25, mentioned range=15, asking estimate=8, price shopping=3
- timeline (0-20): Within 1 month=20, 1-3 months=15, 3-6 months=10, just exploring=3
- decisionMaker (0-15): Confirmed=15, influencer=8, unclear=3
- projectClarity (0-15): All 10 required fields explicitly provided=15, most=10, some=5, vague=0

Timeline normalization (current calendar year is ${currentYear}):
- If the customer answered a start/timeline question with only a month name (e.g. "September"), record timeline as that month in ${currentYear} in scoreBreakdown.timeline.reason and requirements summary.
- Do NOT leave timeline incomplete just because the customer omitted the year.

requirementsComplete MUST be false if budget OR financing OR any required field is still missing or only asked by Sam but not answered by the customer.
projectClarity points must be 0-15 (never exceed 15).

TRANSCRIPT:
${transcript}`,
    }],
  })

  const raw = response.content[0]?.text || ''
  const parsed = parseScoreResponse(raw)
  return normalizeScoreData(parsed)
}

const applyScoreToLead = (lead, scoreData) => {
  if (!scoreData || typeof scoreData !== 'object') return

  if (typeof scoreData.score === 'number') {
    lead.leadScoring.score = scoreData.score
  }
  if (scoreData.scoreBreakdown) {
    lead.leadScoring.scoreBreakdown = scoreData.scoreBreakdown
  }
  if (scoreData.requirements) {
    lead.leadScoring.requirements = scoreData.requirements
  }
  lead.leadScoring.lastScoredAt = new Date()
  lead.leadScoring.temperatureManual = false
  lead.leadScoring.temperature = resolveLeadTemperatureFromScore(lead.leadScoring.score)
}

const updateLeadScore = async (leadId, messages, leadName = '') => {
  try {
    const scoreData = await scoreLead(messages, leadName)
    if (!scoreData) {
      console.warn('[Scoring] Skipped lead update — model output was not valid JSON')
      return null
    }
    const lead = await Lead.findById(leadId)
    if (!lead) return

    const previousTemperature = lead.leadScoring?.temperature || 'cold'
    const previousScore = Number(lead.leadScoring?.score || 0)
    applyScoreToLead(lead, scoreData)
    await lead.save()

    await logLeadTemperatureTransition({
      leadId: lead._id,
      customerId: lead.customerId,
      fromTemperature: previousTemperature,
      toTemperature: lead.leadScoring?.temperature || 'cold',
      source: 'ai_scoring',
      changedBy: null,
      metadata: {
        scoreBefore: previousScore,
        scoreAfter: Number(lead.leadScoring?.score || 0),
        reason: 'ai_scoring_update',
      },
    })

    if (global.io) {
      global.io.of('/admin').to('admin_room').emit('lead_score_updated', {
        leadId,
        score: scoreData.score,
        temperature: lead.leadScoring.temperature,
        breakdown: scoreData.scoreBreakdown,
        requirements: scoreData.requirements,
        lifecycleStatus: lead.lifecycleStatus,
      })
    }
    await leadListSocket.emitLeadListUpdated(leadId, { trigger: 'ai_scoring', includeScoreRow: true })
    return { scoreData, lead }
  } catch (err) {
    console.error('[Scoring] updateLeadScore failed:', err.message)
    return null
  }
}

module.exports = {
  scoreLead,
  applyScoreToLead,
  updateLeadScore,
  parseScoreResponse,
  normalizeScoreData,
}
