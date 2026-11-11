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
  s = s.replace(/CONTACT_INTERNAL:\{[\s\S]*$/g, '')
  s = s.replace(/[*_`#~>]+/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length > 700) s = `${s.slice(0, 680)}...`
  return s || 'Sorry, I did not catch that.'
}

/**
 * Say + Gather speech.
 * - timeout: seconds to WAIT FOR caller to START speaking (keep generous for phone delay)
 * - speechTimeout: end-of-utterance silence
 * - actionOnEmptyResult: POST to action even when nothing heard so we can re-prompt
 */
const sayGather = ({
  message,
  gatherActionUrl,
  voice = 'Polly.Joanna',
  language = 'en-IN',
  hints = 'name, email, gmail, warehouse, building, steel, garage, yes, no',
}) => {
  const say = escapeXml(sanitizeForSpeech(message))
  const action = escapeXml(gatherActionUrl)
  const hintAttr = hints ? ` hints="${escapeXml(hints)}"` : ''
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Say voice="${escapeXml(voice)}">${say}</Say>` +
    `<Gather input="speech" language="${escapeXml(language)}" action="${action}" method="POST" ` +
    `speechTimeout="auto" timeout="10" actionOnEmptyResult="true"${hintAttr} />` +
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
