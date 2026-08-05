const success = (res, data = {}, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data })
}

const created = (res, data = {}, message = 'Created') => {
  return success(res, data, message, 201)
}

const error = (res, message = 'Something went wrong', statusCode = 500, errors = null) => {
  const body = { success: false, message }
  if (errors) body.errors = errors
  return res.status(statusCode).json(body)
}

const notFound = (res, message = 'Not found') => {
  return error(res, message, 404)
}

const unauthorized = (res, message = 'Unauthorized') => {
  return error(res, message, 401)
}

const forbidden = (res, message = 'Forbidden') => {
  return error(res, message, 403)
}

const badRequest = (res, message = 'Bad request', errors = null) => {
  return error(res, message, 400, errors)
}

module.exports = { success, created, error, notFound, unauthorized, forbidden, badRequest }
