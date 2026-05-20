# AI Follow-Up Script — Socket Integration

Real-time chatbot interface for the sales AI Script Generator. Coexists with REST endpoint `POST /api/sales/followups/ai-script` (kept as fallback / one-shot).

## Connection

- **Namespace**: `/admin`
- **URL**: `wss://<host>/admin`
- **Auth**: JWT in handshake — `io('/admin', { auth: { token: '<access_token>' } })`
- **Allowed roles**: `sales`, `admin`

Same connection used for lead chat (`sales_message` etc.). AI script events are namespaced with `ai_script:` prefix.

## Session model

Sessions persist as `AIScriptSession` documents — one per `(salesEmployeeId, leadId)` pair by default. Resume by passing `sessionId`.

## Events

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `ai_script:list` | `{}` | Fetch user's past sessions |
| `ai_script:start` | `{ leadId?, sessionId? }` | Open / create session. Joins room `ai_script:<sessionId>`. Emits `ai_script:session` back |
| `ai_script:message` | `{ sessionId?, leadId?, content }` | Send user turn. Server streams reply chunks then emits `ai_script:done` |
| `ai_script:end` | `{ sessionId }` | Leave session room |

If `sessionId` omitted in `ai_script:message`, server falls back to latest session for `{user, leadId}` or creates a new one.

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `ai_script:sessions` | `{ sessions: [...] }` | Response to `ai_script:list` |
| `ai_script:session` | `{ sessionId, leadId, messages: [{role, content, timestamp}] }` | Response to `ai_script:start`, includes full history |
| `ai_script:typing` | `{ sessionId }` | Assistant started generating |
| `ai_script:chunk` | `{ sessionId, delta }` | Streamed text fragment — append to assistant bubble |
| `ai_script:done` | `{ sessionId, reply }` | Final full reply, turn persisted to DB |
| `ai_script:error` | `{ sessionId?, message }` | Error condition |

## Frontend example

```js
import { io } from 'socket.io-client'

const socket = io('/admin', { auth: { token: accessToken } })

// Open session for a lead
socket.emit('ai_script:start', { leadId })

socket.on('ai_script:session', ({ sessionId, messages }) => {
  currentSessionId = sessionId
  renderHistory(messages)
})

// Send a user message
function send(content) {
  let buffer = ''
  socket.emit('ai_script:message', { sessionId: currentSessionId, content })

  socket.on('ai_script:typing', () => showTypingIndicator())
  socket.on('ai_script:chunk', ({ delta }) => {
    buffer += delta
    updateAssistantBubble(buffer)
  })
  socket.on('ai_script:done', ({ reply }) => hideTypingIndicator())
  socket.on('ai_script:error', ({ message }) => showError(message))
}
```

## REST fallback (unchanged)

- `POST /api/sales/followups/ai-script` — body `{ messages: [...], leadId? }` → returns `{ reply, sessionId }`
- `GET  /api/sales/followups/ai-script` — list sessions

Both REST and socket paths share `src/services/ai/aiScriptChat.service.js` and write to the same `AIScriptSession` collection.

## Notes

- Streaming uses Anthropic SDK `messages.stream()` with `claude-sonnet-4-20250514`.
- Lead context (project, building type, location, customer, lifecycle, quote value, AI score) auto-injected into system prompt when `leadId` set on session.
- Turn is persisted only after streaming completes successfully. Mid-stream failures emit `ai_script:error` and discard the partial reply.
- Multi-tab UX: all sockets of the same user joining `ai_script:<sessionId>` would receive chunks. Currently only the emitting socket receives, since chunks are emitted via `socket.emit` not room broadcast. Switch to `adminNS.to(room).emit(...)` if multi-tab sync is needed.
