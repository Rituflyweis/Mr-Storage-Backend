const aiScriptChat = require('../ai/aiScriptChat.service')

const ROLES_ALLOWED = ['sales', 'admin']

const aiScriptHandler = (socket) => {
  if (!ROLES_ALLOWED.includes(socket.user.role)) return

  // ── ai_script:list — return user's past sessions ──────────────────────────
  socket.on('ai_script:list', async () => {
    try {
      const sessions = await aiScriptChat.listSessions(socket.user._id)
      socket.emit('ai_script:sessions', { sessions })
    } catch (err) {
      console.error('[AIScript] list error:', err.message)
      socket.emit('ai_script:error', { message: 'Failed to load sessions' })
    }
  })

  // ── ai_script:start — open/create session, join room, send history ────────
  socket.on('ai_script:start', async ({ leadId = null, sessionId = null } = {}) => {
    try {
      const session = await aiScriptChat.loadOrCreateSession({
        userId: socket.user._id,
        leadId,
        sessionId,
      })
      const room = `ai_script:${session._id}`
      socket.join(room)
      socket.data.aiScriptSessionId = String(session._id)
      socket.emit('ai_script:session', {
        sessionId: session._id,
        leadId: session.leadId,
        messages: session.messages,
      })
    } catch (err) {
      console.error('[AIScript] start error:', err.message)
      socket.emit('ai_script:error', { message: 'Failed to start session' })
    }
  })

  // ── ai_script:message — user turn, streams reply back ─────────────────────
  socket.on('ai_script:message', async ({ sessionId, content, leadId = null } = {}) => {
    if (!content || !content.trim()) {
      socket.emit('ai_script:error', { sessionId, message: 'content is required' })
      return
    }

    try {
      // Ensure session exists & ownership; create if not provided
      const session = await aiScriptChat.loadOrCreateSession({
        userId: socket.user._id,
        leadId,
        sessionId,
      })
      const sid = String(session._id)
      const room = `ai_script:${sid}`
      socket.join(room)

      socket.emit('ai_script:typing', { sessionId: sid })

      const { reply } = await aiScriptChat.runStreamed({
        userId: socket.user._id,
        leadId: session.leadId || leadId,
        sessionId: sid,
        content: content.trim(),
        onChunk: (delta) => {
          socket.emit('ai_script:chunk', { sessionId: sid, delta })
        },
      })

      socket.emit('ai_script:done', { sessionId: sid, reply })
    } catch (err) {
      console.error('[AIScript] message error:', err.message)
      socket.emit('ai_script:error', { sessionId, message: 'Failed to generate reply' })
    }
  })

  // ── ai_script:end — leave room ────────────────────────────────────────────
  socket.on('ai_script:end', ({ sessionId } = {}) => {
    if (!sessionId) return
    socket.leave(`ai_script:${sessionId}`)
    if (socket.data.aiScriptSessionId === String(sessionId)) {
      socket.data.aiScriptSessionId = null
    }
  })
}

module.exports = aiScriptHandler
