const escapeXml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** Strip markdown / internal markers so TTS sounds natural. */
const sanitizeForSpeech = (text) => {
  let s = String(text || '')
  s = s.replace(/CHAT_INTERNAL:\{[\s\S]*$/g, '')
  s = s.replace(/QUOTE_DATA:\{[\s\S]*$/g, '')
  s = s.replace(/QUOTE_READY_INTERNAL:\{[\s\S]*$/g, '')
  s = s.replace(/[*_`#~>]+/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  // Keep TTS turns reasonably short
  if (s.length > 900) s = `${s.slice(0, 880)}...`
  return s || 'Sorry, I did not catch that.'
}

const sayGather = ({ message, gatherActionUrl, voice = 'Polly.Joanna' }) => {
  const say = escapeXml(sanitizeForSpeech(message))
  const action = escapeXml(gatherActionUrl)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeXml(voice)}">${say}</Say>` +
    `<Gather input="speech" action="${action}" method="POST" speechTimeout="auto" timeout="6" />` +
    `<Say voice="${escapeXml(voice)}">I did not hear anything. Goodbye.</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

const sayHangup = ({ message, voice = 'Polly.Joanna' }) => {
  const say = escapeXml(sanitizeForSpeech(message))
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeXml(voice)}">${say}</Say>` +
    `<Hangup/>` +
    `</Response>`
  )
}

module.exports = {
  escapeXml,
  sanitizeForSpeech,
  sayGather,
  sayHangup,
}
