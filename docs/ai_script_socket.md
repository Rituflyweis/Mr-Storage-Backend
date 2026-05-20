# AI Follow-Up Script — Socket.IO API

Real-time, streaming chatbot for the **AI Follow-Up Script Generator** screen.

The customer flow you're already familiar with (`/chat` namespace, `sales_message`, etc.) is unrelated. This is a new feature on the existing `/admin` namespace, scoped to a logged-in sales user.

A REST fallback exists at `POST /api/sales/followups/ai-script` (one-shot, no streaming) — use this only if sockets are unavailable.

---

## 1. Connection

```js
import { io } from 'socket.io-client'

const socket = io(`${API_BASE_URL}/admin`, {
  auth: { token: accessToken },        // JWT from POST /api/auth/login
  transports: ['websocket', 'polling'],
})
```

| Item | Value |
|---|---|
| URL | `<API_BASE_URL>/admin` |
| Namespace | `/admin` (required — without it, no events fire) |
| Socket.IO version | **v4** |
| Auth | `socket.handshake.auth.token` = JWT access token |
| Allowed roles | `sales`, `admin` |

Standard Socket.IO lifecycle events apply: `connect`, `disconnect`, `connect_error`.

---

## 2. Session model

Every chat exchange persists to an `AIScriptSession` document. One session = one ongoing conversation, scoped to `(salesEmployeeId, leadId)`.

- Pass `leadId` to attach lead context (project name, building type, location, lifecycle status, quote value, AI score) into the system prompt automatically.
- Omit `leadId` for generic scripts (no lead context).
- Sessions are resumable via `sessionId`.

---

## 3. Events

### 3.1 Client → Server

#### `ai_script:list`
List all past sessions for the connected user.

Payload: `{}` (no fields)

#### `ai_script:start`
Open / resume / create a session and load its message history.

```ts
{
  leadId?: string | null,      // attach lead context
  sessionId?: string | null    // resume specific session (overrides leadId-based lookup)
}
```

Behavior:
- If `sessionId` provided and owned by the user → **resumes** that session.
- Otherwise → **always creates a new** session (so the user can have multiple parallel conversations per lead).

To resume a previous session, the FE must call `ai_script:list` first, let the user pick one, then call `ai_script:start` with that `sessionId`.

Server emits `ai_script:session` in response.

#### `ai_script:message`
Send a user turn. Server streams the assistant reply.

```ts
{
  sessionId?: string | null,   // strongly recommended — omit to start a brand new session
  leadId?: string | null,      // only used if creating a fresh session (sessionId omitted)
  content: string              // required, non-empty
}
```

> ⚠️ If `sessionId` is omitted, a **new** session is created for this message. To continue an existing conversation, always pass the `sessionId` returned by `ai_script:session`.

Sequence emitted by server (in order):
1. `ai_script:typing` — assistant started
2. `ai_script:chunk` × N — streamed text fragments
3. `ai_script:done` — finished, turn persisted

#### `ai_script:end`
Leave the session room (cleanup; not strictly required).

```ts
{ sessionId: string }
```

---

### 3.2 Server → Client

#### `ai_script:sessions`
Response to `ai_script:list`.

```ts
{
  sessions: Array<{
    _id: string,
    salesEmployeeId: string,
    leadId: { _id: string, projectName: string } | null,
    messages: Array<{ role: 'user' | 'assistant', content: string, timestamp: string }>,
    createdAt: string,
    updatedAt: string,
  }>
}
```

#### `ai_script:session`
Response to `ai_script:start`. Full state of the opened session.

```ts
{
  sessionId: string,
  leadId: string | null,
  messages: Array<{ role: 'user' | 'assistant', content: string, timestamp: string }>
}
```

#### `ai_script:typing`
Assistant started generating. Show a typing indicator and create an empty assistant bubble for streaming.

```ts
{ sessionId: string }
```

#### `ai_script:chunk`
A streamed text delta. Append to the current assistant bubble.

```ts
{
  sessionId: string,
  delta: string            // text fragment, append directly (do not split words)
}
```

#### `ai_script:done`
Assistant finished. Turn (user + assistant) has been persisted to DB.

```ts
{
  sessionId: string,
  reply: string            // full assistant message (concatenation of all chunks)
}
```

Use `reply` to verify your accumulated chunk buffer matches.

#### `ai_script:error`
Something failed. Discard the partial assistant bubble if mid-stream.

```ts
{
  sessionId?: string,
  message: string
}
```

Common causes: invalid token (handshake), empty `content`, Anthropic API failure, unauthorized session access.

---

## 4. Reference implementation

```js
import { io } from 'socket.io-client'

const socket = io(`${API_BASE_URL}/admin`, { auth: { token } })

let currentSessionId = null
let assistantBuffer = ''

socket.on('connect', () => {
  socket.emit('ai_script:start', { leadId })
})

socket.on('ai_script:session', ({ sessionId, messages }) => {
  currentSessionId = sessionId
  renderHistory(messages)
})

socket.on('ai_script:typing', () => {
  assistantBuffer = ''
  showTypingIndicator()
  appendBubble('assistant', '')         // empty bubble to fill in
})

socket.on('ai_script:chunk', ({ delta }) => {
  assistantBuffer += delta
  updateLastBubble(assistantBuffer)
})

socket.on('ai_script:done', ({ reply }) => {
  hideTypingIndicator()
  updateLastBubble(reply)               // final snap to canonical full text
})

socket.on('ai_script:error', ({ message }) => {
  hideTypingIndicator()
  removeLastBubbleIfEmpty()
  showError(message)
})

function send(content) {
  appendBubble('user', content)
  socket.emit('ai_script:message', { sessionId: currentSessionId, content })
}
```

---

## 5. Edge cases & notes

- **Multi-tab**: chunks are emitted to the sending socket only, not broadcast. Open the same session in two tabs and only the tab that sent gets the stream.
- **Cancellation**: not implemented. Once `ai_script:message` is emitted, the stream completes server-side (~few seconds).
- **Partial failures**: if Anthropic errors mid-stream, only `ai_script:error` is emitted and the turn is **not** persisted.
- **Empty content**: rejected with `ai_script:error`.
- **Unauthorized session**: passing a `sessionId` belonging to another user is silently ignored — server falls back to default lookup.
- **Connection drop mid-stream**: chunks already received are lost; reconnect and call `ai_script:start` with the `sessionId` to reload persisted history (which won't include the unfinished turn).
- **Lead context**: snapshot at message time. If the lead's stage/score changes, only future turns reflect it.

---

## 6. Testing

A browser test client is available at `tests/ai_script_socket_test.html`. Open in any browser, paste the JWT, click Connect.

Postman: requires manually creating a Socket.IO request — see the **"AI Script — Socket.IO (manual setup)"** entry in the shared Postman collection for step-by-step instructions.

---

## 7. Quick reference — Event cheat sheet

```
CLIENT EMITS              →   SERVER RESPONDS WITH
─────────────────────────────────────────────────────────
ai_script:list            →   ai_script:sessions
ai_script:start           →   ai_script:session
ai_script:message         →   ai_script:typing
                              ai_script:chunk (×N)
                              ai_script:done
ai_script:end             →   (no response)

ANY                       →   ai_script:error (on failure)
```
