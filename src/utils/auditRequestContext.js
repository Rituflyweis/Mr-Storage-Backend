const { AsyncLocalStorage } = require('async_hooks')

const storage = new AsyncLocalStorage()

/** Attach current Express req/res for the lifetime of the request (incl. async continuations). */
const runWithAuditContext = (req, res, next) => {
  storage.run({ req, res }, next)
}

const getAuditRequest = () => storage.getStore()?.req ?? null

module.exports = { runWithAuditContext, getAuditRequest }
