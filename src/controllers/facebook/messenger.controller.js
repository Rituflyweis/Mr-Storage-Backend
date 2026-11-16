const env = require('../../config/env')
const messenger = require('../../services/facebook/messenger.service')

exports.verify = (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (!env.FACEBOOK_VERIFY_TOKEN) {
    return res.status(503).send('Facebook verify token is not configured')
  }
  if (mode === 'subscribe' && token === env.FACEBOOK_VERIFY_TOKEN && challenge) {
    return res.status(200).send(challenge)
  }
  return res.sendStatus(403)
}

exports.webhook = (req, res) => {
  if (!env.FACEBOOK_PAGE_ACCESS_TOKEN) {
    return res.status(503).send('Facebook page token is not configured')
  }
  if (!messenger.signaturesMatch(req.rawBody || Buffer.from(''), req.get('x-hub-signature-256'))) {
    return res.sendStatus(403)
  }
  res.sendStatus(200)
  messenger.handleWebhookBody(req.body).catch((err) => {
    console.error('[Messenger] webhook failed:', err.message)
  })
}
