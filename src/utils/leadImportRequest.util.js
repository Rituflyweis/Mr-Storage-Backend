const isXlsxBuffer = (buf) =>
  Buffer.isBuffer(buf) && buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b

/** Multipart `file` / `csv` file, or JSON base64 (`fileBase64`, `file`, or xlsx in `csv`). */
const resolveLeadImportExcelBuffer = (req) => {
  const fromFile = req.file?.buffer
  if (fromFile && isXlsxBuffer(fromFile)) return fromFile

  const files = req.files || {}
  for (const key of ['file', 'csv', 'excel', 'document']) {
    const part = files[key]?.[0]
    if (part?.buffer && isXlsxBuffer(part.buffer)) return part.buffer
  }

  for (const key of ['fileBase64', 'file', 'excelBase64']) {
    const raw = req.body?.[key]
    if (typeof raw === 'string' && raw.length > 80) {
      try {
        const buf = Buffer.from(raw.replace(/^data:[^;]+;base64,/, ''), 'base64')
        if (isXlsxBuffer(buf)) return buf
      } catch {
        /* not base64 */
      }
    }
  }

  const csvField = req.body?.csv
  if (typeof csvField === 'string' && csvField.length > 80 && !csvField.includes('\n')) {
    try {
      const buf = Buffer.from(csvField.replace(/^data:[^;]+;base64,/, ''), 'base64')
      if (isXlsxBuffer(buf)) return buf
    } catch {
      /* treat as CSV text below */
    }
  }

  return null
}

module.exports = { isXlsxBuffer, resolveLeadImportExcelBuffer }
