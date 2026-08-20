#!/usr/bin/env node
/**
 * Tests extract-drawing handler path locally (no auth required).
 * Usage: node scripts/test-extract-drawing-api.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { extractDrawingPdfBuffer } = require('../src/services/quoting/drawingPdfExtractor')

const PDF = path.join(__dirname, '..', 'pdf_quote_example.pdf')

const decodeBase64File = (fileBase64) => {
  const raw = String(fileBase64).replace(/^data:[^;]+;base64,/, '')
  return Buffer.from(raw, 'base64')
}

async function main() {
  const pdfBuf = fs.readFileSync(PDF)
  const fileBase64 = pdfBuf.toString('base64')
  const buffer = decodeBase64File(fileBase64)

  console.log('Simulating POST /api/admin/estimates/extract-drawing handler...')
  const data = await extractDrawingPdfBuffer(buffer, { fileName: 'pdf_quote_example.pdf' })

  console.log('filledCount:', data.filledCount)
  console.log('sample fields:', {
    width: data.extracted?.width,
    length: data.extracted?.length,
    wind: data.extracted?.wind,
    roofpanel: data.extracted?.roofpanel,
    wall: data.extracted?.wall,
  })
  console.log('total extracted keys:', Object.keys(data.extracted || {}).length)

  if (!data.filledCount || data.filledCount < 5) {
    console.error('FAIL: expected at least 5 extracted fields')
    process.exit(1)
  }

  console.log('✓ extract-drawing handler test passed')
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
