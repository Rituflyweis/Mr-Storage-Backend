#!/usr/bin/env node
/**
 * Local smoke test for scoring JSON extraction (no Anthropic call).
 * Usage: node scripts/test-scoring-parse.js
 */
const assert = require('assert')
const { parseScoreResponse, normalizeScoreData } = require('../src/services/ai/scoring.service')

const cases = [
  {
    name: 'trailing prose after JSON',
    raw: `{"score":42,"scoreBreakdown":{"projectSize":{"points":8,"reason":"x"}},"requirements":"workshop","requirementsComplete":false,"projectLifecycleStage":null,"projectFields":{}}\nHope that helps!`,
    expectScore: 42,
  },
  {
    name: 'markdown fenced JSON',
    raw: '```json\n{"score": 55, "scoreBreakdown": {}, "requirements": "garage", "requirementsComplete": false}\n```\nDone.',
    expectScore: 55,
  },
  {
    name: 'nested braces in string values',
    raw: '{"score":30,"scoreBreakdown":{"timeline":{"points":5,"reason":"start in {September}"}},"requirements":"","requirementsComplete":false}',
    expectScore: 30,
  },
  {
    name: 'garbage only',
    raw: 'Sorry, I cannot score this.',
    expectScore: null,
  },
  {
    name: 'old broken full-string parse (valid JSON + junk)',
    raw: `${'{"score":77,"scoreBreakdown":{},"requirements":"barn","requirementsComplete":false,"projectLifecycleStage":null,"projectFields":{}}'} extra text that broke JSON.parse`,
    expectScore: 77,
  },
]

let failed = 0
for (const c of cases) {
  const parsed = parseScoreResponse(c.raw)
  const norm = normalizeScoreData(parsed)
  const score = norm?.score ?? null
  try {
    assert.strictEqual(score, c.expectScore, `expected score ${c.expectScore}, got ${score}`)
    console.log(`OK  ${c.name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL ${c.name}:`, err.message)
  }
}

// applyScoreToLead must not wipe on null
const Lead = require('../src/models/Lead')
const { applyScoreToLead } = require('../src/services/ai/scoring.service')
const fakeLead = {
  leadScoring: { score: 65, scoreBreakdown: { projectSize: { points: 10 } }, requirements: 'keep me' },
}
applyScoreToLead(fakeLead, null)
assert.strictEqual(fakeLead.leadScoring.score, 65)
console.log('OK  applyScoreToLead skips null scoreData')

if (failed) {
  console.error(`\n${failed} case(s) failed`)
  process.exit(1)
}
console.log('\nAll scoring parse tests passed.')