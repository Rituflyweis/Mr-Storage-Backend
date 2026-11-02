const EstimateQuote = require('../models/EstimateQuote')

const SKIP_KEYS = new Set(['_id', '__v', 'createdAt', 'updatedAt'])

/**
 * Persist estimate after recompute/preview saves. Retries on Mongoose VersionError when
 * overlapping compute/autosave requests bump __v between read and save.
 */
const saveEstimateQuoteWithRetry = async (doc, { maxAttempts = 3 } = {}) => {
  if (!doc?._id) {
    await doc.save()
    return doc
  }

  let current = doc
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await current.save()
      return current
    } catch (err) {
      const isVersion =
        err?.name === 'VersionError' ||
        err?.constructor?.name === 'VersionError'
      if (!isVersion || attempt >= maxAttempts) throw err

      const snapshot = current.toObject({ depopulate: true })
      const fresh = await EstimateQuote.findById(current._id)
      if (!fresh) throw err

      for (const [key, value] of Object.entries(snapshot)) {
        if (SKIP_KEYS.has(key)) continue
        fresh.set(key, value)
      }
      current = fresh
    }
  }
  return current
}

module.exports = { saveEstimateQuoteWithRetry }
