/**
 * Debounce rapid PUT /estimates/:id (storage add-on autosave fires many requests).
 * One flush per window; all waiters get the same result; latest request body wins.
 */

const DEFAULT_DEBOUNCE_MS = parseInt(
  process.env.ESTIMATE_UPDATE_DEBOUNCE_MS || '250',
  10,
)

const slots = new Map()

const debounceCoalescedEstimateWrite = (key, createRun) =>
  new Promise((resolve, reject) => {
    let slot = slots.get(key)
    if (!slot) {
      slot = { waiters: [], timer: null, latestRun: null }
      slots.set(key, slot)
    }

    slot.latestRun = createRun
    slot.waiters.push({ resolve, reject })

    clearTimeout(slot.timer)
    slot.timer = setTimeout(() => {
      flushCoalescedEstimateWrite(key).catch(() => {})
    }, DEFAULT_DEBOUNCE_MS)
  })

async function flushCoalescedEstimateWrite(key) {
  const slot = slots.get(key)
  if (!slot) return
  slots.delete(key)
  clearTimeout(slot.timer)

  const { waiters, latestRun } = slot
  if (!latestRun || !waiters.length) return

  try {
    const result = await latestRun()
    waiters.forEach((w) => w.resolve(result))
  } catch (err) {
    waiters.forEach((w) => w.reject(err))
  }
}

const estimateWriteCoalesceKey = (userId, estimateId) =>
  `${String(userId)}:${String(estimateId)}`

module.exports = {
  debounceCoalescedEstimateWrite,
  estimateWriteCoalesceKey,
}
