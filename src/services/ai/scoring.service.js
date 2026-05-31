const Anthropic = require('@anthropic-ai/sdk')
const Lead = require('../../models/Lead')
const env = require('../../config/env')
const { resolveLeadTemperatureFromScore } = require('../../config/constants')

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

const scoreLead = async (messages, leadName = '') => {
  const maxChars = parseCharLimit(env.CLAUDE_MAX_SCORE_LIVE_CHARS, 18000)

  const transcript = messages
    .filter(m => m.senderType === 'customer' || m.senderType === 'ai')
    .map(m => `${m.senderType === 'customer' ? (leadName || 'Customer') : 'Alex'}: ${m.content}`)
    .join('\n')
    .slice(0, maxChars)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
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
  "projectLifecycleStage": "<EXACTLY one of: ${SALES_LIFECYCLE_FOR_SCORING.join(' | ')} | null>"
}

Scoring guide:
- projectSize (0-25): Large commercial/industrial=25, medium commercial=15, small/residential=8, unclear=0
- budgetSignals (0-25): Budget approved=25, mentioned range=15, asking estimate=8, price shopping=3
- timeline (0-20): Within 1 month=20, 1-3 months=15, 3-6 months=10, just exploring=3
- decisionMaker (0-15): Confirmed=15, influencer=8, unclear=3
- projectClarity (0-15): All 10 required fields explicitly provided=15, most=10, some=5, vague=0

requirementsComplete MUST be false if budget OR decision-maker OR any of the 10 fields is still missing or only asked by Alex but not answered by the customer.
projectClarity points must be 0-15 (never exceed 15).

TRANSCRIPT:
${transcript}`,
    }],
  })

  try {
    const raw = response.content[0].text.trim()
    const clean = raw.replace(/```json|```/g, '').trim()
    return JSON.parse(clean)
  } catch (err) {
    console.error('[Scoring] Parse error:', err.message)
    return {
      score: 0,
      scoreBreakdown: {},
      requirements: '',
      requirementsComplete: false,
      projectLifecycleStage: null,
    }
  }
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
    const lead = await Lead.findById(leadId)
    if (!lead) return

    applyScoreToLead(lead, scoreData)
    await lead.save()

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
  } catch (err) {
    console.error('[Scoring] updateLeadScore failed:', err.message)
  }
}

module.exports = { scoreLead, applyScoreToLead, updateLeadScore }
