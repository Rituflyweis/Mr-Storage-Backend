const { WebSocketServer } = require('ws')
const voiceCall = require('./voiceCall.service')
const env = require('../../config/env')

const RELAY_PATH = '/api/twilio/voice/relay'

const STILL_THERE = [
  'Are you still there?',
  'Hello, are you still with me?',
  'I still cannot hear you. Are you there?',
]

const SILENCE_GOODBYE = 'I have not heard a response, so I will end the call now. Goodbye.'

const silenceMs = () => {
  const n = Number(env.VOICE_SILENCE_MS)
  return Number.isFinite(n) && n >= 3000 ? n : 8000
}

const silenceChecks = () => {
  const n = Number(env.VOICE_SILENCE_CHECKS)
  return Number.isFinite(n) && n >= 1 ? Math.min(5, n) : 3
}

const speakingFlag = (msg) => {
  const flag = msg.value ?? msg.speaking ?? msg.status ?? msg.state
  if (flag === true || flag === 'true' || flag === 'on' || flag === 'speaking' || flag === 'start') return true
  if (flag === false || flag === 'false' || flag === 'off' || flag === 'finished' || flag === 'stop') return false
  return null
}

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
      silenceTimer: null,
      fallbackTimer: null,
      silenceChecks: 0,
      agentSpeaking: false,
      endAfterSpeech: false,
      ended: false,
      heardSpeaker: false,
      speakGen: 0,
    }

    const clearSilence = () => {
      if (state.silenceTimer) clearTimeout(state.silenceTimer)
      state.silenceTimer = null
    }

    const clearFallback = () => {
      if (state.fallbackTimer) clearTimeout(state.fallbackTimer)
      state.fallbackTimer = null
    }

    const stopSpeaking = () => {
      state.speakGen += 1
      state.abort?.abort()
    }

    const sendText = (token, last = true) => {
      const gen = state.speakGen
      if (ws.readyState !== 1 || state.ended) return
      if (gen !== state.speakGen) return
      const safe = String(token || '')
      if (!safe.trim() && !last) return
      ws.send(JSON.stringify({
        type: 'text',
        token: safe,
        last: Boolean(last),
        interruptible: true,
        preemptible: true,
      }))
    }

    const endCall = () => {
      if (state.ended || ws.readyState !== 1) return
      state.ended = true
      clearSilence()
      clearFallback()
      ws.send(JSON.stringify({ type: 'end' }))
    }

    const armSilence = () => {
      clearSilence()
      if (state.ended || state.busy || state.agentSpeaking || state.endAfterSpeech) return
      state.silenceTimer = setTimeout(() => {
        state.silenceTimer = null
        onSilence().catch((err) => console.error('[VoiceRelay] silence:', err.message))
      }, silenceMs())
    }

    const onSilence = async () => {
      if (state.ended || state.busy || state.agentSpeaking || state.endAfterSpeech) return
      const maxChecks = silenceChecks()
      if (state.silenceChecks >= maxChecks) {
        state.endAfterSpeech = true
        sendText(SILENCE_GOODBYE, true)
        recordSafe(state.callSid, SILENCE_GOODBYE)
        // Play the goodbye, then hang up. Speaker events close it sooner.
        state.silenceTimer = setTimeout(endCall, 7000)
        return
      }
      const line = STILL_THERE[Math.min(state.silenceChecks, STILL_THERE.length - 1)]
      state.silenceChecks += 1
      console.log(`[VoiceRelay] silence check ${state.silenceChecks}/${maxChecks} callSid=${state.callSid}`)
      sendText(line, true)
      recordSafe(state.callSid, line)
      if (!state.heardSpeaker) armSilence()
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
        // If Twilio never sends speaker events, start the silence check after the greeting.
        clearFallback()
        state.fallbackTimer = setTimeout(() => {
          state.fallbackTimer = null
          if (!state.heardSpeaker && !state.ended && !state.busy) armSilence()
        }, 20000)
        return
      }

      if (msg.type === 'agentSpeaking' || msg.name === 'agentSpeaking') {
        const active = speakingFlag(msg)
        if (active === null) return
        state.heardSpeaker = true
        clearFallback()
        state.agentSpeaking = active
        if (active) {
          clearSilence()
          return
        }
        if (state.endAfterSpeech) {
          endCall()
          return
        }
        armSilence()
        return
      }

      if (msg.type === 'clientSpeaking' || msg.name === 'clientSpeaking') {
        const active = speakingFlag(msg)
        if (active === null) return
        state.heardSpeaker = true
        clearFallback()
        if (active) {
          clearSilence()
          state.silenceChecks = 0
          if (state.agentSpeaking || state.busy) stopSpeaking()
        }
        return
      }

      if (msg.type === 'interrupt') {
        console.log(`[VoiceRelay] interrupt callSid=${state.callSid}`)
        stopSpeaking()
        clearSilence()
        if (state.busy && !state.savedAi) {
          recordSafe(state.callSid, msg.utteranceUntilInterrupt || '')
        }
        return
      }

      if (msg.type === 'prompt') {
        if (msg.last === false) {
          clearSilence()
          return
        }
        const speech = String(msg.voicePrompt || '').trim()
        if (!state.callSid || state.ended) return
        clearSilence()
        state.silenceChecks = 0
        if (state.busy) stopSpeaking()
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
          if (result?.aborted && !state.savedAi) return
          state.savedAi = !result?.aborted
          if (result?.endCall) {
            state.endAfterSpeech = true
            state.silenceTimer = setTimeout(endCall, 8000)
            return
          }
          if (!state.heardSpeaker) armSilence()
        } catch (err) {
          console.error('[VoiceRelay] prompt error:', err.message)
          sendText('Sorry, I had a brief glitch. Could you please repeat that?', true)
          if (!state.heardSpeaker) armSilence()
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
      state.ended = true
      clearSilence()
      clearFallback()
      state.abort?.abort()
    })
  })

  console.log(`[VoiceRelay] websocket ready at ${RELAY_PATH}`)
  return wss
}

const recordSafe = (callSid, transcript) => {
  voiceCall.recordInterruptedReply(callSid, transcript).catch((err) => {
    console.warn('[VoiceRelay] line save failed:', err.message)
  })
}

module.exports = { attachConversationRelay, RELAY_PATH }
