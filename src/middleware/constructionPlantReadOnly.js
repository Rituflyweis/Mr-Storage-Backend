const { forbidden } = require('../utils/apiResponse')

/** Construction mirrors of plant APIs are read-only (GET/HEAD). */
module.exports = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return forbidden(res, 'This endpoint is read-only for construction')
  }
  next()
}
