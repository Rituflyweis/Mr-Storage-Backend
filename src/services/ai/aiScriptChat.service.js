const Anthropic = require('@anthropic-ai/sdk')
const AIScriptSession = require('../../models/AIScriptSession')
const Lead = require('../../models/Lead')
const env = require('../../config/env')

const MODEL = env.ANTHROPIC_MODEL
const MAX_TOKENS = 1024

const buildLeadContext = async (leadId) => {
  if (!leadId) return ''
  const lead = await Lead.findById(leadId).populate('customerId').lean()
  if (!lead) return ''
  return `\nLead context:\n- Project: ${lead.projectName || 'N/A'}\n- Building type: ${lead.buildingType || 'N/A'}\n- Location: ${lead.location || 'N/A'}\n- Customer: ${lead.customerId?.firstName || 'N/A'}\n- Lifecycle: ${lead.lifecycleStatus}\n- Quote value: ${lead.quoteValue || 0}\n- AI score: ${lead.leadScoring?.score || 0}`
}

const buildSystemPrompt = (leadContext) =>
  `You are an expert sales script assistant for a construction/storage building company. Help the salesperson craft effective communication scripts, talking points, and responses.${leadContext}\n\nProvide concise, actionable scripts and tips tailored to the context.`

const loadOrCreateSession = async ({ userId, leadId, sessionId }) => {
  if (sessionId) {
    const existing = await AIScriptSession.findById(sessionId)
    if (existing && String(existing.salesEmployeeId) === String(userId)) return existing
  }
  return AIScriptSession.create({
    salesEmployeeId: userId,
    leadId: leadId || null,
    createdBy: userId,
    messages: [],
  })
}

const persistTurn = async (session, userContent, assistantContent) => {
  session.messages.push(
    { role: 'user', content: userContent, timestamp: new Date() },
    { role: 'assistant', content: assistantContent, timestamp: new Date() }
  )
  await session.save()
  return session
}

const callAnthropic = async ({ messages, systemPrompt }) => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const anthropicMessages = messages.map(m => ({ role: m.role, content: m.content }))
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: anthropicMessages,
  })
  return response.content[0]?.text || ''
}

const streamAnthropic = async ({ messages, systemPrompt, onChunk }) => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const anthropicMessages = messages.map(m => ({ role: m.role, content: m.content }))
  let full = ''
  const stream = await client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: anthropicMessages,
  })
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const delta = event.delta.text || ''
      full += delta
      if (onChunk) onChunk(delta)
    }
  }
  return full
}

const runOneShot = async ({ userId, leadId, messages }) => {
  const leadContext = await buildLeadContext(leadId)
  const systemPrompt = buildSystemPrompt(leadContext)
  const reply = await callAnthropic({ messages, systemPrompt })

  const session = await loadOrCreateSession({ userId, leadId })
  const userMessage = messages[messages.length - 1]
  await persistTurn(session, userMessage.content, reply)
  return { reply, sessionId: session._id }
}

const runStreamed = async ({ userId, leadId, sessionId, content, onChunk }) => {
  const session = await loadOrCreateSession({ userId, leadId, sessionId })
  const effectiveLeadId = session.leadId || leadId
  const leadContext = await buildLeadContext(effectiveLeadId)
  const systemPrompt = buildSystemPrompt(leadContext)

  const history = session.messages.map(m => ({ role: m.role, content: m.content }))
  const messages = [...history, { role: 'user', content }]

  const reply = await streamAnthropic({ messages, systemPrompt, onChunk })
  await persistTurn(session, content, reply)
  return { reply, sessionId: session._id }
}

const listSessions = async (userId) =>
  AIScriptSession.find({ salesEmployeeId: userId })
    .populate({ path: 'leadId', select: 'projectName' })
    .sort({ createdAt: -1 })
    .lean()

const getSession = async ({ userId, sessionId }) => {
  const session = await AIScriptSession.findById(sessionId)
    .populate({ path: 'leadId', select: 'projectName' })
    .lean()
  if (!session) return null
  if (String(session.salesEmployeeId) !== String(userId)) return null
  return session
}

module.exports = {
  runOneShot,
  runStreamed,
  loadOrCreateSession,
  listSessions,
  getSession,
}
