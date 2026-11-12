const { WebSocketServer } = require('ws')
const voiceCall = require('./voiceCall.service')

const RELAY_PATH = '/api/twilio/voice/relay'

const attachConversationRelay = (server) => {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0]
    if (path !== RELAY_PATH) return
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', (ws) => {
    const state = {
      callSid: '',
      abort: null,
      busy: false,
      savedAi: false,
    }

    const sendText = (token, last = true) => {
      if (ws.readyState !== 1) return
      const safe = String(token || '')
      if (!safe.trim()) return
      ws.send(JSON.stringify({
        type: 'text',
        token: safe,
        last: Boolean(last),
        interruptible: true,
      }))
    }

    const endCall = () => {
      if (ws.readyState !== 1) return
      ws.send(JSON.stringify({ type: 'end' }))
    }

    ws.on('message', async (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch (err) {
        console.warn('[VoiceRelay] bad json:', err.message)
        return
      }

      if (msg.type === 'setup') {
        state.callSid = msg.callSid || ''
        console.log(`[VoiceRelay] setup callSid=${state.callSid} from=${msg.from || ''}`)
        return
      }

      if (msg.type === 'interrupt') {
        state.abort?.abort()
        if (state.busy && !state.savedAi) {
          recordSafe(state.callSid, msg.utteranceUntilInterrupt || '')
        }
        return
      }

      if (msg.type === 'prompt') {
        // Ignore partial prompts; wait for the finalized utterance.
        if (msg.last === false) return
        const speech = String(msg.voicePrompt || '').trim()
        if (!state.callSid) return
        if (state.busy) state.abort?.abort()
        state.busy = true
        state.savedAi = false
        const controller = new AbortController()
        state.abort = controller
        try {
          const result = await voiceCall.handleRelayPrompt({
            callSid: state.callSid,
            speech,
            signal: controller.signal,
            sendText,
          })
          if (result?.aborted && !state.savedAi) {
            return
          }
          state.savedAi = !result?.aborted
          if (result?.endCall) endCall()
        } catch (err) {
          console.error('[VoiceRelay] prompt error:', err.message)
          sendText('Sorry, I had a brief glitch. Could you please repeat that?', true)
        } finally {
          state.busy = false
        }
        return
      }

      if (msg.type === 'error') {
        console.error('[VoiceRelay] twilio error:', msg.description || msg)
      }
    })

    ws.on('close', () => {
      state.abort?.abort()
    })
  })

  console.log(`[VoiceRelay] websocket ready at ${RELAY_PATH}`)
  return wss
}

const recordSafe = (callSid, transcript) => {
  voiceCall.recordInterruptedReply(callSid, transcript).catch((err) => {
    console.warn('[VoiceRelay] interrupt save failed:', err.message)
  })
}

module.exports = { attachConversationRelay, RELAY_PATH }
