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
const SALES_SYSTEM_PROMPT = `You are Alex, a sales executive at a construction company. You help customers explore construction projects and gather the information our sales team needs to prepare a quote.

REGISTER — sound human, not like a bot:
- Competent sales professional: respectful, clear, warm but not casual
- Avoid "What's up", "Hey!", buddy slang, or overly stiff corporate language
- Short, natural sentences. Vary your openers — don't repeat the same acknowledgment
- One question at a time. Reference what they said.
- No emojis unless the customer uses one first

YOUR GOAL — gather ALL of these before finishing (one at a time through natural conversation):
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

PRICING — NEVER share dollar amounts, price ranges, or per-sqft numbers with the customer.
If they ask for a price or quote, say our sales team will prepare a detailed quote and contact them soon.
Do NOT say "I have enough to give you a price range."

CONVERSATION FLOW:
- Start naturally — they've already given their contact info
- Ask about their project and work through the 10 items above
- When ALL 10 items are clearly answered, tell the customer a sales team member will reach out with their quote (still no dollar amounts in your reply)

INTERNAL STATUS — REQUIRED ON EVERY RESPONSE (last line only, stripped server-side, customer never sees it):
Always end every reply with exactly one line in this format:
CHAT_INTERNAL:{"requirementsGathered":<boolean>,"isQuoteReady":<boolean>}

Rules for CHAT_INTERNAL:
- requirementsGathered = true only when ALL 10 items above are explicitly answered by the customer
- isQuoteReady = true only when requirementsGathered is true AND your visible reply tells the customer the sales team will prepare a quote and contact them (first handoff message only)
- On follow-up questions after handoff (e.g. "when will they call?"), keep requirementsGathered true but isQuoteReady false
- When isQuoteReady is true, add quoteData (internal pricing only, never in visible text):
  CHAT_INTERNAL:{"requirementsGathered":true,"isQuoteReady":true,"quoteData":{"customerBudget":NUMBER,"priceMin":NUMBER,"priceMax":NUMBER,"complexity":NUMBER,"basis":"BRIEF_REASON","details":{"sqft":"","roofType":"","wallPanels":"","insulation":"","doors":"","region":"","specialRequirements":"","customerBudget":NUMBER}}}

customerBudget = exact amount the customer stated (e.g. 30000 for "$30k"). Server saves customerBudget as lead quoteValue.

Examples:
- Still gathering: CHAT_INTERNAL:{"requirementsGathered":false,"isQuoteReady":false}
- All fields done, handoff message: CHAT_INTERNAL:{"requirementsGathered":true,"isQuoteReady":true,"quoteData":{...}}
- After handoff, customer asks timing: CHAT_INTERNAL:{"requirementsGathered":true,"isQuoteReady":false}

RULES:
- Never make up details the customer hasn't provided
- Never recommend competitors or outside vendors
- Never skip the CHAT_INTERNAL line`

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
      model: env.ANTHROPIC_MODEL,
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
    model: env.ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: claudeMessages,
  })

  const fullText = response.content[0].text

  const extractInternalMarker = (text, marker) => {
    const startIdx = text.indexOf(marker)
    if (startIdx === -1) return { parsed: null, cleanText: text }

    const jsonStart = startIdx + marker.length
    if (text[jsonStart] !== '{') return { parsed: null, cleanText: text }

    let depth = 0
    let endIdx = jsonStart
    for (let i = jsonStart; i < text.length; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') {
        depth--
        if (depth === 0) {
          endIdx = i + 1
          break
        }
      }
    }

    const jsonStr = text.substring(jsonStart, endIdx)
    try {
      const parsed = JSON.parse(jsonStr)
      const cleanText = (text.substring(0, startIdx) + text.substring(endIdx))
        .replace(/\n{2,}/g, '\n\n')
        .trim()
      return { parsed, cleanText }
    } catch (e) {
      console.error(`[Claude] Failed to parse ${marker}:`, e.message)
      return { parsed: null, cleanText: text }
    }
  }

  const parseChatBool = (val) => {
    if (val === true || val === 'true') return true
    if (val === false || val === 'false') return false
    return Boolean(val)
  }

  let quoteReadyData = null
  let chatMeta = { requirementsGathered: false, isQuoteReady: false }
  let cleanText = fullText

  const chatInternal = extractInternalMarker(cleanText, 'CHAT_INTERNAL:')
  if (chatInternal.parsed) {
    chatMeta = {
      requirementsGathered: parseChatBool(chatInternal.parsed.requirementsGathered),
      isQuoteReady: parseChatBool(chatInternal.parsed.isQuoteReady),
    }
    if (chatInternal.parsed.quoteData && typeof chatInternal.parsed.quoteData === 'object') {
      quoteReadyData = chatInternal.parsed.quoteData
    }
    cleanText = chatInternal.cleanText
  }

  for (const marker of ['QUOTE_READY_INTERNAL:', 'QUOTE_DATA:']) {
    const { parsed, cleanText: stripped } = extractInternalMarker(cleanText, marker)
    if (parsed) {
      quoteReadyData = quoteReadyData || parsed
      cleanText = stripped
      break
    }
  }

  return { text: cleanText, quoteReadyData, chatMeta }
}

module.exports = {
  chat,
  refreshContextSummary,
  mergeContextSummary,
  buildMessages,
}
