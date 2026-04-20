const Anthropic = require('@anthropic-ai/sdk')
const Lead = require('../../models/Lead')
const env = require('../../config/env')
const { LIFECYCLE_STAGES } = require('../../config/constants')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

const parseCharLimit = (val, fallback) => {
  const n = parseInt(String(val != null ? val : fallback), 10)
  return Number.isNaN(n) ? fallback : n
}

// ─── SCORE A LEAD FROM ITS MESSAGES ────────────────────────────────────────────
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
  "projectLifecycleStage": "<EXACTLY one of: ${LIFECYCLE_STAGES.join(' | ')} | null>"
}

Scoring guide:
- projectSize (0-25): Large commercial/industrial=25, medium commercial=15, small/residential=8, unclear=0
- budgetSignals (0-25): Budget approved=25, mentioned range=15, asking estimate=8, price shopping=3
- timeline (0-20): Within 1 month=20, 1-3 months=15, 3-6 months=10, just exploring=3
- decisionMaker (0-15): Confirmed=15, influencer=8, unclear=3
- projectClarity (0-15): All details=15, most=10, some=5, vague=0

Lifecycle: initial_contact=first touch; requirements_collected=scope discussed; proposal_sent=quote shared; negotiation=revising terms; deal_closed=committed; payment_done=deposit confirmed; delivered=handoff done

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
      projectLifecycleStage: null,
    }
  }
}

// ─── APPLY SCORE DATA TO LEAD DOCUMENT ────────────────────────────────────────
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

  // Only advance lifecycle — never regress a stage the sales team has already reached
  if (scoreData.projectLifecycleStage && LIFECYCLE_STAGES.includes(scoreData.projectLifecycleStage)) {
    const newIdx     = LIFECYCLE_STAGES.indexOf(scoreData.projectLifecycleStage)
    const currentIdx = LIFECYCLE_STAGES.indexOf(lead.lifecycleStatus)
    if (newIdx > currentIdx) {
      lead.lifecycleStatus = scoreData.projectLifecycleStage
    }
  }
}

// ─── FIRE-AND-FORGET WRAPPER ───────────────────────────────────────────────────
const updateLeadScore = async (leadId, messages, leadName = '') => {
  try {
    const scoreData = await scoreLead(messages, leadName)
    const lead = await Lead.findById(leadId)
    if (!lead) return

    applyScoreToLead(lead, scoreData)
    await lead.save()

    // Emit to admin panel
    if (global.io) {
      global.io.of('/admin').to('admin_room').emit('lead_score_updated', {
        leadId,
        score: scoreData.score,
        breakdown: scoreData.scoreBreakdown,
        requirements: scoreData.requirements,
      })
    }
  } catch (err) {
    console.error('[Scoring] updateLeadScore failed:', err.message)
    // Fail silently — not on critical path
  }
}

module.exports = { scoreLead, applyScoreToLead, updateLeadScore }
