#!/usr/bin/env node
const assert = require('assert')
const { parseLeadgenWebhook } = require('../src/services/facebook/leadAds.service')

const sample = {
  object: 'page',
  entry: [{
    id: '894052360447700',
    changes: [{
      field: 'leadgen',
      value: {
        leadgen_id: '444444444',
        form_id: '123',
        ad_id: '456',
        created_time: 1730000000,
        page_id: '894052360447700',
      },
    }],
  }],
}

const rows = parseLeadgenWebhook(sample)
assert.strictEqual(rows.length, 1)
assert.strictEqual(rows[0].leadgenId, '444444444')
assert.strictEqual(rows[0].formId, '123')
assert.strictEqual(parseLeadgenWebhook({ object: 'page', entry: [{ messaging: [] }] }).length, 0)
console.log('OK  parseLeadgenWebhook')
console.log('\nMeta Lead Ads parse test passed.')