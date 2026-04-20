const Anthropic = require('@anthropic-ai/sdk')
const Message = require('../../models/Message')
const Lead = require('../../models/Lead')
const env = require('../../config/env')

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })

// ─── CONTEXT SIZE HELPERS (ported from reference claude.js) ────────────────────
const parseCharLimit = (val, fallback) => {
  const n = parseInt(String(val != null && val !== '' ? val : fallback), 10)
  return Number.isNaN(n) ? fallback : n
}

const resolveContextLimits = () => ({
  maxPriorChars: parseCharLimit(env.CLAUDE_MAX_PRIOR_CONTEXT_CHARS, 45000),
  maxLiveChars:  parseCharLimit(env.CLAUDE_MAX_LIVE_CONTEXT_CHARS, 28000),
})

const resolveSummaryMaxChars = () =>
  parseCharLimit(env.CLAUDE_CONTEXT_SUMMARY_MAX_CHARS, 2200)

const resolveLiveVerbatimCount = () =>
  parseCharLimit(env.CLAUDE_LIVE_VERBATIM_TURNS, 12)

const capSummaryText = (text, maxChars) => {
  const s = String(text || '').trim()
  if (!s || maxChars <= 0) return s
  if (s.length <= maxChars) return s
  return `${s.slice(0, maxChars - 20)}\n…(trimmed)…`
}

// ─── SYSTEM PROMPT ──────────────────────────────────────────────────────────────
// TODO: Replace company details, pricing bands, and project fields with your own.
const SALES_SYSTEM_PROMPT = `You are Alex, a sales executive at a construction company. You help customers explore construction projects and gather the information needed to generate a price estimate.

REGISTER — sound human, not like a bot:
- Competent sales professional: respectful, clear, warm but not casual
- Avoid "What's up", "Hey!", buddy slang, or overly stiff corporate language
- Short, natural sentences. Vary your openers — don't repeat the same acknowledgment
- One question at a time. Reference what they said.
- No emojis unless the customer uses one first

YOUR GOAL:
Gather enough information to generate a price range estimate. You need to collect:
1. Building type (warehouse, office, retail, industrial, residential, etc.)
2. Approximate size / square footage
3. Location / region
4. Roof type and wall type
5. Insulation requirements
6. Number and type of doors/windows
7. Timeline — when they want to start
8. Budget range or signals
9. Whether they are the decision maker
10. Any special requirements

IMPORTANT — ON-FILE CONTACT:
The customer's name, email, and phone are already on file (shown below). Do NOT ask for them again.
You may reference their name naturally. Focus only on gathering project details.

CONVERSATION FLOW:
- Start naturally — they've already given their contact info
- Ask about their project
- Gather the 10 items above through natural conversation
- Once you have enough project info, confirm: "I have enough to give you a price range — shall I go ahead?"
- Only generate a quote after they confirm

QUOTE GENERATION:
When you have enough information AND the customer confirms they want a quote, include this on its own line:
QUOTE_DATA:{"priceMin":NUMBER,"priceMax":NUMBER,"complexity":NUMBER,"basis":"BRIEF_REASON","details":{"sqft":"VALUE","roofType":"VALUE","wallPanels":"VALUE","insulation":"VALUE","doors":"VALUE","region":"VALUE","specialRequirements":"VALUE"}}

Pricing guidelines (rough per sqft):
- Simple metal/basic structure: $8–$12/sqft
- Standard commercial (office/retail): $15–$25/sqft
- Complex build (special materials, high insulation): $25–$40/sqft
- Premium / specialised: $40–$60/sqft

Complexity scale 1–5:
1 = Simple shed/basic structure
2 = Standard warehouse/storage
3 = Commercial office/retail
4 = Complex multi-use or heavy insulation
5 = Premium/highly specialised

Regional pricing note: Southeast = base, Midwest +5%, Northeast +12%, West Coast +18%, Mountain/Northwest +8%

RULES:
- Never make up details the customer hasn't provided
- These are estimates — be transparent that final pricing needs a site visit
- Never recommend competitors or outside vendors`

// ─── CONTACT SNAPSHOT (injected into system prompt) ────────────────────────────
const buildContactBlock = (customer) => {
  if (!customer) return ''
  return (
    '\n\n--- ON-FILE CONTACT ---\n' +
    `Name: ${customer.firstName || 'on file'}\n` +
    `Email: ${customer.email || 'on file'}\n` +
    `Phone: ${customer.phone?.number || 'on file'}\n` +
    'Do NOT ask for any of these again.\n' +
    '---\n'
  )
}

// ─── MESSAGE ALTERNATION (Anthropic requires user/assistant alternation) ────────
const ensureAlternation = (messages) => {
  const out = []
  for (const m of messages || []) {
    if (!m || !m.content || (m.role !== 'user' && m.role !== 'assistant')) continue
    const msg = { role: m.role, content: String(m.content).trim() }
    if (!msg.content) continue
    if (out.length === 0) {
      if (msg.role === 'assistant') {
        out.push({ role: 'user', content: '(Customer joined.)' })
      }
      out.push(msg)
      continue
    }
    const last = out[out.length - 1]
    if (last.role === msg.role) {
      last.content = `${last.content}\n\n${msg.content}`
    } else {
      out.push(msg)
    }
  }
  return out
}

// ─── CHARACTER-BUDGET TRIMMER ───────────────────────────────────────────────────
const keepWithinBudget = (messages, maxChars) => {
  if (!messages || messages.length === 0) return []
  if (maxChars <= 0) return messages
  const kept = []
  let total = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const c = String(m.content || '')
    if (c.length > maxChars && kept.length === 0) {
      return [{ role: m.role, content: `…(truncated)…\n${c.slice(-(maxChars - 16))}` }]
    }
    if (total + c.length > maxChars) break
    kept.push({ role: m.role, content: c })
    total += c.length
  }
  kept.reverse()
  if (kept.length > 0 && kept.length < messages.length) {
    kept[0] = {
      role: kept[0].role,
      content: '[Older messages omitted.]\n\n' + kept[0].content,
    }
  }
  return kept
}

// ─── BUILD CLAUDE MESSAGES ARRAY ───────────────────────────────────────────────
const buildMessages = (currentMessages, currentConversationSummary = '') => {
  const { maxLiveChars } = resolveContextLimits()
  const verbatimCount = resolveLiveVerbatimCount()

  let liveMessages = (currentMessages || []).map(m => ({
    role: m.senderType === 'customer' ? 'user' : 'assistant',
    content: String(m.content),
  }))

  let summaryPrefix = []
  if (verbatimCount > 0 && liveMessages.length > verbatimCount) {
    if (currentConversationSummary) {
      summaryPrefix = [{
        role: 'user',
        content: `[Earlier in this conversation — summary]\n${currentConversationSummary}`,
      }]
    }
    liveMessages = liveMessages.slice(-verbatimCount)
  }

  const combined = [...summaryPrefix, ...liveMessages]
  const trimmed = keepWithinBudget(combined, maxLiveChars)
  return ensureAlternation(trimmed)
}

// ─── ROLLING CONTEXT SUMMARY ───────────────────────────────────────────────────
const mergeContextSummary = async ({ previousSummary = '', newUserContent = '', newAssistantContent = '' }) => {
  const maxOut = resolveSummaryMaxChars()
  const prev = String(previousSummary || '').trim()
  const u = String(newUserContent || '').trim()
  const a = String(newAssistantContent || '').trim()
  if (!u && !a) return prev

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 768,
      system: `You maintain a compact MEMORY SUMMARY for a construction sales CRM. Output plain text only — short labeled lines or bullets. No markdown headings. Preserve EVERY concrete fact from the previous summary (names, numbers, sqft, locations, quotes, materials, timeline). Merge in the new exchange; do not drop prior facts unless the customer explicitly corrected them. Max length: about ${Math.floor(maxOut / 5)} words. Be dense.`,
      messages: [{
        role: 'user',
        content: `PREVIOUS SUMMARY:\n${prev || '(none)'}\n\nNEW — Customer:\n${u}\n\nNEW — Alex:\n${a}\n\nReply with the updated summary only.`,
      }],
    })
    const out = response.content[0]?.text?.trim() || ''
    if (!out) return prev
    return capSummaryText(out, maxOut)
  } catch (err) {
    console.error('[Claude] mergeContextSummary:', err.message)
    return prev
  }
}

// ─── FIRE-AND-FORGET: UPDATE ROLLING SUMMARY AFTER EACH TURN ──────────────────
const refreshContextSummary = async (leadId) => {
  try {
    // Get the last 2 messages: expect [latest=ai, prev=customer]
    const messages = await Message.find({ leadId })
      .sort({ createdAt: -1 })
      .limit(2)
      .lean()

    if (messages.length < 2) return
    const latest = messages[0]
    const prev = messages[1]
    if (latest.senderType !== 'ai' || prev.senderType !== 'customer') return

    const lead = await Lead.findById(leadId).select('aiContextSummary').lean()
    if (!lead) return

    const merged = await mergeContextSummary({
      previousSummary: lead.aiContextSummary || '',
      newUserContent: prev.content,
      newAssistantContent: latest.content,
    })

    await Lead.findByIdAndUpdate(leadId, {
      aiContextSummary: merged,
      aiContextSummaryUpdatedAt: new Date(),
    })
  } catch (err) {
    console.error('[Claude] refreshContextSummary:', err.message)
  }
}

// ─── MAIN CHAT FUNCTION ────────────────────────────────────────────────────────
const chat = async (currentMessages, options = {}) => {
  const { customer, currentConversationSummary = '' } = options

  const systemPrompt = SALES_SYSTEM_PROMPT + buildContactBlock(customer)
  const claudeMessages = buildMessages(currentMessages, currentConversationSummary)

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: claudeMessages,
  })

  const fullText = response.content[0].text

  // Extract QUOTE_DATA if present (brace-matching to handle nested JSON)
  let quoteData = null
  let cleanText = fullText
  const quoteMarker = 'QUOTE_DATA:'
  const startIdx = fullText.indexOf(quoteMarker)

  if (startIdx !== -1) {
    const jsonStart = startIdx + quoteMarker.length
    if (fullText[jsonStart] === '{') {
      let depth = 0, endIdx = jsonStart
      for (let i = jsonStart; i < fullText.length; i++) {
        if (fullText[i] === '{') depth++
        else if (fullText[i] === '}') {
          depth--
          if (depth === 0) { endIdx = i + 1; break }
        }
      }
      const jsonStr = fullText.substring(jsonStart, endIdx)
      try {
        quoteData = JSON.parse(jsonStr)
        cleanText = (fullText.substring(0, startIdx) + fullText.substring(endIdx))
          .replace(/\n{2,}/g, '\n\n').trim()
      } catch (e) {
        console.error('[Claude] Failed to parse QUOTE_DATA:', e.message)
      }
    }
  }

  return { text: cleanText, quoteData }
}

module.exports = {
  chat,
  refreshContextSummary,
  mergeContextSummary,
  buildMessages,
}
