const MARKERS = [
  'CONTACT_INTERNAL:',
  'CHAT_INTERNAL:',
  'QUOTE_READY_INTERNAL:',
  'QUOTE_DATA:',
]

/** Index where an internal marker (or a partial prefix of one) begins. */
const earliestMarkerCut = (buffer) => {
  let cut = buffer.length
  for (const marker of MARKERS) {
    const idx = buffer.indexOf(marker)
    if (idx !== -1) cut = Math.min(cut, idx)
    const max = Math.min(marker.length - 1, buffer.length)
    for (let len = max; len >= 1; len -= 1) {
      if (buffer.endsWith(marker.slice(0, len))) {
        cut = Math.min(cut, buffer.length - len)
        break
      }
    }
  }
  return cut
}

/**
 * Split a growing model buffer into text that is safe to speak now
 * and text that must wait (incomplete sentence or internal marker).
 */
const pullSpeakable = (buffer, { flush = false } = {}) => {
  const source = String(buffer || '')
  if (!source) return { emit: '', rest: '' }

  const cut = earliestMarkerCut(source)
  const visible = source.slice(0, cut)
  const held = source.slice(cut)

  if (!visible) return { emit: '', rest: held }
  if (flush) return { emit: visible, rest: held }

  // Speak as soon as a clause is ready. Waiting for the full reply is the pause the caller hears.
  const clause = visible.match(/^[\s\S]{6,}?[,;:](?:\s+|$)/)
  if (clause) {
    const end = clause[0].length
    return { emit: visible.slice(0, end), rest: visible.slice(end) + held }
  }

  const sentence = visible.match(/^[\s\S]{6,}?(?:(?<![0-9])[.!?]["']?)(?:\s+|$)/)
  if (sentence) {
    const end = sentence[0].length
    return { emit: visible.slice(0, end), rest: visible.slice(end) + held }
  }

  if (visible.length >= 70) {
    const space = visible.lastIndexOf(' ')
    if (space > 24) {
      return {
        emit: visible.slice(0, space + 1),
        rest: visible.slice(space + 1) + held,
      }
    }
  }

  return { emit: '', rest: source }
}

module.exports = { pullSpeakable, earliestMarkerCut }
