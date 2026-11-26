const env = require('../../config/env')
const messenger = require('../../services/facebook/messenger.service')
const leadAds = require('../../services/facebook/leadAds.service')

const summarizePageWebhook = (body) => {
  const entries = Array.isArray(body?.entry) ? body.entry : []
  const changeFields = []
  let messagingEvents = 0
  for (const entry of entries) {
    messagingEvents += Array.isArray(entry?.messaging) ? entry.messaging.length : 0
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (change?.field) changeFields.push(String(change.field))
    }
  }
  return {
    object: body?.object || null,
    entryCount: entries.length,
    changeFields,
    messagingEvents,
    leadgenEvents: leadAds.parseLeadgenWebhook(body).length,
  }
}

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
    console.warn('[FacebookWebhook] rejected: FACEBOOK_PAGE_ACCESS_TOKEN not set')
    return res.status(503).send('Facebook page token is not configured')
  }
  const signatureOk = messenger.signaturesMatch(
    req.rawBody || Buffer.from(''),
    req.get('x-hub-signature-256')
  )
  if (!signatureOk) {
    console.warn('[FacebookWebhook] rejected: invalid X-Hub-Signature-256')
    return res.sendStatus(403)
  }
  console.info('[FacebookWebhook] received', summarizePageWebhook(req.body))
  res.sendStatus(200)
  leadAds.handleWebhookBody(req.body).catch((err) => {
    console.error('[MetaLeadAds] webhook failed:', err.message)
  })
  messenger.handleWebhookBody(req.body).catch((err) => {
    console.error('[Messenger] webhook failed:', err.message)
  })
}
