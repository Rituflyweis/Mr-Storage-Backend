#!/usr/bin/env node
/**
 * Local smoke test for Facebook Messenger typing indicators (mocked Graph API).
 * Usage: node scripts/test-messenger-typing.js
 */
const assert = require('assert')

const originalFetch = global.fetch
const calls = []

process.env.FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || 'test-page-token'
process.env.FACEBOOK_GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || 'v21.0'

global.fetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body), method: opts.method })
  return {
    ok: true,
    text: async () => '{"recipient_id":"123"}',
  }
}

const servicePath = require.resolve('../src/services/facebook/messenger.service')
delete require.cache[servicePath]
const messenger = require('../src/services/facebook/messenger.service')

const senderActions = () =>
  calls.filter((c) => c.body && c.body.sender_action).map((c) => c.body.sender_action)

const run = async () => {
  calls.length = 0
  await messenger.sendTypingOn('29680586934885264')
  assert.strictEqual(senderActions().slice(-1)[0], 'typing_on')
  assert.strictEqual(calls[0].body.recipient.id, '29680586934885264')
  console.log('OK  sendTypingOn payload')

  calls.length = 0
  await messenger.sendTypingOff('29680586934885264')
  assert.strictEqual(senderActions().slice(-1)[0], 'typing_off')
  console.log('OK  sendTypingOff payload')

  calls.length = 0
  const result = await messenger.withMessengerTyping('29680586934885264', async () => {
    await new Promise((r) => setTimeout(r, 30))
    return 'done'
  })
  assert.strictEqual(result, 'done')
  const actions = senderActions()
  assert.ok(actions.includes('typing_on'), 'expected typing_on during work')
  assert.strictEqual(actions[actions.length - 1], 'typing_off', 'expected typing_off in finally')
  console.log('OK  withMessengerTyping wraps work and clears typing')

  console.log('\nAll Messenger typing tests passed.')
}

run()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => {
    global.fetch = originalFetch
  })