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
const buildSalesSystemPrompt = () => {
  const currentYear = new Date().getFullYear()
  return `You are Alex, a sales executive at a construction company. You help customers explore construction projects and gather the information our sales team needs to prepare a quote.

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

TIMELINE RULES:
- The current calendar year is ${currentYear}.
- If the customer answers with only a month name (e.g. "September", "Sept"), treat it as that month in ${currentYear} — do NOT ask them to repeat the year unless they gave a different year explicitly.
- You may acknowledge naturally (e.g. "Starting in September ${currentYear} — got it.").

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
- If the customer asks you to call them, say you are calling the phone number on file now. Do not say you are unable to place a call.
- Never make up details the customer hasn't provided
- Never recommend competitors or outside vendors
- Never skip the CHAT_INTERNAL line`
}

const isPendingVoiceEmail = (email) =>
  String(email || '').toLowerCase().endsWith('@pending.voice.local')

const buildFirstContactVoicePromptExtra = (customer) => {
  const phone =
    customer?.phone?.number
      ? `${customer.phone.countryCode || ''} ${customer.phone.number}`.trim()
      : 'on this call'
  return `

FIRST-CONTACT PHONE CALL — collect identity before project details:
- This caller has NOT registered on the website yet. Their phone (${phone}) is already known from caller ID.
- You MUST collect, one at a time: (1) their full name, (2) a working email address (spell-check verbally if unclear).
- Do NOT ask for their phone number — we already have it.
- Until you have BOTH a real name and a real email, do NOT dig into building/project quote fields beyond a light "what brings you in today" opener.
- After name + email are confirmed, continue with the normal 10 project items.
- NEVER invent an email or name.

On EVERY reply, also include this internal line (customer never hears it) BEFORE CHAT_INTERNAL:
CONTACT_INTERNAL:{"firstName":"...","lastName":"","email":"...","contactComplete":true|false}
- Put firstName/lastName/email only when the customer clearly stated them (empty string if unknown).
- contactComplete = true only when you have a plausible personal/business email AND a real first name (not "Caller"/"Guest").
- requirementsGathered / isQuoteReady must stay false until contactComplete is true AND the 10 project items are done.
`
}

// ─── CONTACT SNAPSHOT (injected into system prompt) ────────────────────────────
const buildContactBlock = (customer, { needsContactDetails = false } = {}) => {
  if (!customer) return ''
  if (needsContactDetails || isPendingVoiceEmail(customer.email)) {
    return (
      '\n\n--- CALLER ID (PARTIAL) ---\n' +
      `Phone on file: ${customer.phone?.countryCode || ''} ${customer.phone?.number || ''}\n`.replace(/\s+/g, ' ').trim() +
      '\nName/email: NOT YET COLLECTED — ask for them (see FIRST-CONTACT rules).\n' +
      '---\n' +
      buildFirstContactVoicePromptExtra(customer)
    )
  }
  return (
    '\n\n--- ON-FILE CONTACT ---\n' +
    `Name: ${customer.firstName || 'on file'}\n` +
    `Email: ${customer.email || 'on file'}\n` +
    `Phone: ${customer.phone?.number || 'on file'}\n` +
    'Do NOT ask for any of these again.\n' +
    '---\n'
  )
}

const buildProjectMemoryBlock = (lead) => {
  if (!lead) return ''
  const where = [lead.city, lead.state, lead.location].filter(Boolean).join(', ')
  const lines = []
  if (lead.projectName) lines.push(`Project name: ${lead.projectName}`)
  if (lead.buildingType) lines.push(`Building type: ${lead.buildingType}`)
  if (lead.sqft) lines.push(`Size: ${lead.sqft} sq ft`)
  if (where) lines.push(`Location: ${where}`)
  if (lead.roofStyle) lines.push(`Roof: ${lead.roofStyle}`)
  const requirements = String(lead.leadScoring?.requirements || '').trim()
  const summary = String(lead.aiContextSummary || '').trim()
  if (!lines.length && !requirements && !summary) return ''
  return (
    '\n\n--- PROJECT ALREADY ON FILE ---\n' +
    (lines.length ? `${lines.join('\n')}\n` : '') +
    (requirements ? `Known so far: ${requirements}\n` : '') +
    (summary ? 'A full conversation summary is included with the messages. Use it.\n' : '') +
    'You already have this history. Never say you cannot remember, that nothing is on file, or that this is a fresh start.\n' +
    'Continue this project. Do not re-ask facts listed here. Check how planning is going, then ask only for the next missing detail.\n' +
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
  const summary = String(currentConversationSummary || '').trim()
  if (summary) {
    summaryPrefix = [{
      role: 'user',
      content: `[Earlier in this conversation — summary. These facts are already known. Do not claim you have no memory of them.]\n${summary}`,
    }]
  }
  if (verbatimCount > 0 && liveMessages.length > verbatimCount) {
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

const buildChatRequest = (currentMessages, options = {}) => {
  const {
    customer,
    currentConversationSummary = '',
    needsContactDetails = false,
    voiceMode = false,
    projectLead = null,
  } = options

  const voiceRules =
    '\n\nVOICE CALL MODE: Speak first, in one or two short sentences. Put the answer in the first few words. No markdown, bullets, or lists. The internal marker lines come after the spoken words, never before them. If a project is already on file, continue that project out loud. Never tell the caller you have no previous conversation.\n'
  const stablePrompt = buildSalesSystemPrompt() + (voiceMode ? voiceRules : '')
  const livePrompt =
    buildContactBlock(customer, { needsContactDetails }) +
    buildProjectMemoryBlock(projectLead || { aiContextSummary: currentConversationSummary })

  // Voice: smaller prompt window so the first spoken token arrives quickly.
  // The standing instructions are cached so later turns in the same call start faster.
  const claudeMessages = voiceMode
    ? buildMessages(currentMessages.slice(-6), currentConversationSummary)
    : buildMessages(currentMessages, currentConversationSummary)

  const system = voiceMode
    ? [
        { type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: livePrompt },
      ]
    : stablePrompt + livePrompt

  return {
    model: voiceMode && env.VOICE_ANTHROPIC_MODEL ? env.VOICE_ANTHROPIC_MODEL : env.ANTHROPIC_MODEL,
    max_tokens: voiceMode ? 180 : 1024,
    system,
    messages: claudeMessages,
    needsContactDetails,
  }
}

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

const parseAssistantTurn = (fullText, { needsContactDetails = false } = {}) => {
  let quoteReadyData = null
  let chatMeta = { requirementsGathered: false, isQuoteReady: false }
  let contactUpdate = null
  let cleanText = fullText

  const contactInternal = extractInternalMarker(cleanText, 'CONTACT_INTERNAL:')
  if (contactInternal.parsed) {
    contactUpdate = {
      firstName: String(contactInternal.parsed.firstName || '').trim(),
      lastName: String(contactInternal.parsed.lastName || '').trim(),
      email: String(contactInternal.parsed.email || '').trim().toLowerCase(),
      contactComplete: parseChatBool(contactInternal.parsed.contactComplete),
    }
    cleanText = contactInternal.cleanText
  }

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

  // Block quote handoff until contact is complete on first-contact calls
  if (needsContactDetails && (!contactUpdate || !contactUpdate.contactComplete)) {
    chatMeta = { ...chatMeta, requirementsGathered: false, isQuoteReady: false }
    quoteReadyData = null
  }

  return { text: cleanText, quoteReadyData, chatMeta, contactUpdate }
}

// ─── MAIN CHAT FUNCTION ────────────────────────────────────────────────────────
const chat = async (currentMessages, options = {}) => {
  const request = buildChatRequest(currentMessages, options)
  const response = await client.messages.create({
    model: request.model,
    max_tokens: request.max_tokens,
    system: request.system,
    messages: request.messages,
  })
  const fullText = response.content[0].text
  return parseAssistantTurn(fullText, { needsContactDetails: request.needsContactDetails })
}

/**
 * Stream a voice reply. `onText` receives speakable chunks as Claude generates them.
 * Internal CRM markers are held back and never spoken.
 */
const streamChat = async (currentMessages, options = {}) => {
  const { onText, signal } = options
  const request = buildChatRequest(currentMessages, options)
  const { pullSpeakable } = require('./speechChunker')
  let pending = ''
  let full = ''

  const stream = client.messages.stream(
    {
      model: request.model,
      max_tokens: request.max_tokens,
      system: request.system,
      messages: request.messages,
    },
    signal ? { signal } : undefined,
  )

  for await (const event of stream) {
    const delta = event?.delta?.text
    if (event?.type !== 'content_block_delta' || !delta) continue
    full += delta
    pending += delta
    const pulled = pullSpeakable(pending)
    pending = pulled.rest
    if (pulled.emit && onText) await onText(pulled.emit)
  }

  const flushed = pullSpeakable(pending, { flush: true })
  if (flushed.emit && onText) await onText(flushed.emit)

  return parseAssistantTurn(full, { needsContactDetails: request.needsContactDetails })
}

module.exports = {
  chat,
  streamChat,
  refreshContextSummary,
  mergeContextSummary,
  buildMessages,
  isPendingVoiceEmail,
  parseAssistantTurn,
  buildProjectMemoryBlock,
}
