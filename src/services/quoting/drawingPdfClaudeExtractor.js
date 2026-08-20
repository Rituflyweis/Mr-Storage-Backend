const Anthropic = require('@anthropic-ai/sdk')
const env = require('../../config/env')

const PRELIM_FIELD_KEYS = [
  'customer',
  'project',
  'jobnumber',
  'location',
  'date',
  'width',
  'length',
  'eave',
  'sqft',
  'bay',
  'slope',
  'dead',
  'collateral',
  'live',
  'roofsnow',
  'snow',
  'wind',
  'exposure',
  'snowexp',
  'ipc',
  'risk',
  'siteclass',
  'seismiccat',
  'seismiczone',
  'seismic',
  'sd1',
  's1',
  'thermal',
  'code',
  'windif',
  'snowif',
  'shearlong',
  'sheartrans',
  'deflcol',
  'frame',
  'roofpanel',
  'wall',
  'notes',
]

let anthropicClient = null

const getAnthropicClient = () => {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured for PDF extraction')
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

const safeJsonParseFromText = (raw) => {
  const text = String(raw || '')
    .replace(/```json|```/g, '')
    .trim()
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Claude extraction returned no JSON object')
  return JSON.parse(match[0])
}

const cleanFieldValue = (value) => {
  if (value == null) return ''
  const str = String(value).trim()
  if (!str || str.toLowerCase() === 'null' || str.toLowerCase() === 'n/a') return ''
  return str
}

const normalizeExtractedFields = (raw = {}) => {
  const out = {}
  PRELIM_FIELD_KEYS.forEach((key) => {
    const val = cleanFieldValue(raw[key])
    if (val) out[key] = val
  })

  if (out.width && !out.width.includes("'")) {
    const n = out.width.replace(/[^\d.]/g, '')
    if (n) out.width = `${n}'`
  }
  if (out.length && !out.length.includes("'")) {
    const n = out.length.replace(/[^\d.]/g, '')
    if (n) out.length = `${n}'`
  }
  if (out.eave && !out.eave.includes("'")) {
    const n = out.eave.replace(/[^\d.]/g, '')
    if (n) out.eave = `${n}'`
  }

  if (!out.sqft && out.width && out.length) {
    const wn = parseInt(out.width, 10)
    const ln = parseInt(out.length, 10)
    if (wn && ln) out.sqft = String(wn * ln)
  }

  if (out.exposure && !/^Exposure\s/i.test(out.exposure) && /^[A-D]$/i.test(out.exposure)) {
    out.exposure = `Exposure ${out.exposure.toUpperCase()}`
  }

  if (out.seismic && !/^Sds=/i.test(out.seismic) && /^\d/.test(out.seismic)) {
    out.seismic = `Sds=${out.seismic}`
  }

  ;['dead', 'collateral', 'live', 'roofsnow', 'snow'].forEach((key) => {
    if (!out[key]) return
    if (!/\bpsf\b/i.test(out[key]) && /^\d/.test(out[key])) out[key] = `${out[key]} psf`
  })

  if (out.wind && !/\bmph\b/i.test(out.wind) && /^\d/.test(out.wind)) {
    out.wind = `${out.wind} mph`
  }

  ;['shearlong', 'sheartrans'].forEach((key) => {
    if (!out[key]) return
    if (!/\bkips\b/i.test(out[key]) && /^\d/.test(out[key])) out[key] = `${out[key]} kips`
  })

  if (out.risk && !/^Category\s/i.test(out.risk) && /^I{1,3}V?$/i.test(out.risk)) {
    out.risk = `Category ${out.risk.toUpperCase()}`
  }

  return out
}

const buildExtractionPrompt = ({ layoutText, fileName }) => {
  const schema = PRELIM_FIELD_KEYS.reduce((acc, key) => {
    acc[key] = ''
    return acc
  }, {})

  const textHint = layoutText
    ? `\n\nOptional OCR/layout text extracted from page 1 (may be incomplete):\n${layoutText.slice(0, 12000)}`
    : ''

  return `Extract building specification fields from this PEMB prelim engineering drawing (page 1).

Return STRICT JSON only. No markdown. No commentary.

Use this exact schema (omit keys or use empty string when not found):
${JSON.stringify(schema, null, 2)}

Formatting rules:
- width, length, eave: include feet mark, e.g. "90'", "225'", "20.5'"
- sqft: numeric string only, compute width × length when both known
- dead, collateral, live, roofsnow, snow: include " psf" suffix
- wind: include " mph" suffix
- exposure: "Exposure C" format
- risk: "Category II" format when occupancy category found
- seismic: "Sds=0.33" format for Sds value
- shearlong, sheartrans: include " kips" suffix
- slope: "1:12" format
- code: e.g. "IBC 2018" or "IBC 18" as shown
- roofpanel / wall: panel type and color text as shown
- notes: any important spec notes not captured elsewhere
- Do NOT invent values. Use only what is visible in the PDF.

File name: ${fileName || 'prelim.pdf'}${textHint}`
}

const extractPrelimWithClaude = async (buffer, { layoutText = '', fileName = '' } = {}) => {
  const client = getAnthropicClient()
  const pdfBase64 = Buffer.from(buffer).toString('base64')

  const response = await client.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 4096,
    temperature: 0,
    system:
      'You extract PEMB prelim drawing specifications into strict JSON. You never invent values — only extract what is visible in the document.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: buildExtractionPrompt({ layoutText, fileName }),
          },
        ],
      },
    ],
  })

  const raw = response.content?.find((block) => block.type === 'text')?.text || ''
  const parsed = safeJsonParseFromText(raw)
  const extracted = normalizeExtractedFields(parsed.fields || parsed.extracted || parsed)

  return {
    extracted,
    filledCount: Object.keys(extracted).length,
    extractionMethod: 'claude',
  }
}

const mergeExtractedFields = (primary = {}, secondary = {}) => {
  const merged = { ...primary }
  Object.entries(secondary).forEach(([key, value]) => {
    if (!cleanFieldValue(value)) return
    if (!cleanFieldValue(merged[key])) merged[key] = value
  })
  return merged
}

module.exports = {
  PRELIM_FIELD_KEYS,
  extractPrelimWithClaude,
  mergeExtractedFields,
  normalizeExtractedFields,
}
