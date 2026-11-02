const EstimateQuote = require('../models/EstimateQuote')

const SKIP_KEYS = new Set(['_id', '__v', 'createdAt', 'updatedAt'])

/** Mixed / nested blobs — markModified after merge so save persists on retry. */
const MIXED_PATHS = new Set([
  'storageData',
  'storagePricingResult',
  'fullQuoteResult',
  'pricingResult',
  'quoteControls',
  'parsedCategories',
  'weightByCategory',
  'concreteAddon',
  'insulationAddon',
  'salesTax',
  'pembAddOns',
  'milestoneSchedule',
  'depositTerms',
  'multiStory',
  'cogsOverride',
  'marginOverride',
  'contractDetails',
  'drawingAttachments',
  'tabSummary',
  'breakdownRows',
])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isVersionError = (err) =>
  err?.name === 'VersionError' || err?.constructor?.name === 'VersionError'

const markMixedPathsModified = (doc, snapshot = {}) => {
  for (const path of MIXED_PATHS) {
    if (snapshot[path] !== undefined || doc.get(path) != null) {
      doc.markModified(path)
    }
  }
}

/** Serialize saves per estimate on this process (rapid FE autosave / add-on edits). */
const estimateSaveQueues = new Map()

const enqueueEstimateSave = (id, fn) => {
  const key = String(id)
  const prior = estimateSaveQueues.get(key) || Promise.resolve()
  const chained = prior.catch(() => {}).then(fn)
  estimateSaveQueues.set(
    key,
    chained.finally(() => {
      if (estimateSaveQueues.get(key) === chained) estimateSaveQueues.delete(key)
    }),
  )
  return chained
}

/**
 * Persist estimate after recompute/preview saves. Retries on Mongoose VersionError when
 * overlapping compute/autosave requests bump __v between read and save.
 */
const saveEstimateQuoteWithRetryInner = async (doc, { maxAttempts = 15 } = {}) => {
  if (!doc?._id) {
    await doc.save()
    return doc
  }

  const snapshot = doc.toObject({ depopulate: true })
  const id = doc._id

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let current = attempt === 1 ? doc : await EstimateQuote.findById(id)
    if (!current) {
      const err = new Error('Estimate not found')
      err.statusCode = 404
      throw err
    }

    if (attempt > 1) {
      for (const [key, value] of Object.entries(snapshot)) {
        if (SKIP_KEYS.has(key)) continue
        current.set(key, value)
      }
      markMixedPathsModified(current, snapshot)
    } else {
      markMixedPathsModified(doc, snapshot)
    }

    try {
      await current.save()
      return current
    } catch (err) {
      if (!isVersionError(err) || attempt >= maxAttempts) throw err
      const delayMs =
        Math.min(500, 30 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 50)
      await sleep(delayMs)
    }
  }

  return current
}

const saveEstimateQuoteWithRetry = async (doc, options = {}) => {
  if (!doc?._id) return saveEstimateQuoteWithRetryInner(doc, options)
  return enqueueEstimateSave(doc._id, () => saveEstimateQuoteWithRetryInner(doc, options))
}

module.exports = { saveEstimateQuoteWithRetry }
