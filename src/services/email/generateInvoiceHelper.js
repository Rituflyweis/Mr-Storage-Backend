const PDFDocument = require('pdfkit')
const puppeteer = require('puppeteer')

const PAGE_MARGIN = 48
const HEADER_COLOR = '#1a2e4a'

const stripHtml = (value) =>
  String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()

const generateInvoicePdfWithPuppeteer = async (html) => {
  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  }

  const browser = await puppeteer.launch(launchOptions)

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '24px', right: '24px', bottom: '24px', left: '24px' },
    })
    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}

const drawSectionTitle = (doc, title) => {
  doc.moveDown(0.6)
  doc.font('Helvetica-Bold').fontSize(11).fillColor(HEADER_COLOR).text(title.toUpperCase())
  doc.moveDown(0.3)
}

const drawKeyValueRow = (doc, label, value, { labelWidth = 140 } = {}) => {
  const y = doc.y
  doc.font('Helvetica').fontSize(10).fillColor('#666666').text(label, PAGE_MARGIN, y, { width: labelWidth })
  doc.font('Helvetica-Bold').fillColor(HEADER_COLOR).text(String(value ?? '—'), PAGE_MARGIN + labelWidth, y, {
    width: doc.page.width - PAGE_MARGIN * 2 - labelWidth,
    align: 'right',
  })
  doc.moveDown(0.35)
}

const generateInvoicePdfWithPdfkit = (document) => {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' })
  const buffers = []
  doc.on('data', (chunk) => buffers.push(chunk))

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const contentWidth = doc.page.width - PAGE_MARGIN * 2

    doc.rect(PAGE_MARGIN, doc.y, contentWidth, 72).fill(HEADER_COLOR)
    doc.fillColor('#ffffff')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(`Invoice ${document.invoiceNumber}`, PAGE_MARGIN + 16, doc.y + 14)
    doc.font('Helvetica')
      .fontSize(10)
      .text(`Invoice date: ${document.date}`, PAGE_MARGIN + 16, doc.y + 8)
      .text(`Due date: ${document.dueDate}`, PAGE_MARGIN + 16, doc.y + 2)
    doc.moveDown(4.2)

    doc.fillColor('#333333').font('Helvetica').fontSize(11)
      .text(`Dear ${document.customerName},`, PAGE_MARGIN, doc.y)
    doc.moveDown(0.4)
    doc.fontSize(10).fillColor('#555555')
      .text('Please find your invoice details below. Payment is due per the terms listed.', {
        width: contentWidth,
      })
    doc.moveDown(0.8)

    const totalBoxY = doc.y
    doc.roundedRect(PAGE_MARGIN, totalBoxY, contentWidth, 52, 6).fill(HEADER_COLOR)
    doc.fillColor('#ffffff')
      .font('Helvetica')
      .fontSize(10)
      .text('Total amount due', PAGE_MARGIN + 16, totalBoxY + 10)
    doc.font('Helvetica-Bold')
      .fontSize(22)
      .text(document.totalAmount, PAGE_MARGIN + 16, totalBoxY + 24)
    doc.moveDown(3.2)

    drawKeyValueRow(doc, 'Invoice number', document.invoiceNumber)
    drawKeyValueRow(doc, 'PO number', document.poNumber)
    drawKeyValueRow(doc, 'Invoice date', document.date)
    drawKeyValueRow(doc, 'Due date', document.dueDate)
    drawKeyValueRow(doc, 'Payment terms', document.paymentTerms)
    drawKeyValueRow(doc, 'Days to pay', document.daysToPay)

    const paymentStages = Array.isArray(document.paymentStages) ? document.paymentStages : []
    drawSectionTitle(doc, 'Payment schedule')
    if (!paymentStages.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#888888')
        .text('No payment schedule stages are configured for this project yet.', { width: contentWidth })
    } else {
      paymentStages.forEach((stage) => {
        const stageLabel = stage.isCurrent ? `${stage.stageName} (This invoice)` : stage.stageName
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text(stageLabel, { width: contentWidth })
        doc.font('Helvetica').fontSize(9).fillColor('#666666')
          .text(
            `Amount: ${stage.amount}   Due: ${stage.dueDate}   Status: ${stage.status}`,
            { width: contentWidth }
          )
        doc.moveDown(0.35)
      })
      if (document.scheduleTotal) {
        doc.font('Helvetica').fontSize(10).fillColor('#666666')
          .text(`Schedule total: ${document.scheduleTotal}`)
      }
    }

    drawSectionTitle(doc, 'Line items')

    const lineItems = Array.isArray(document.lineItems) ? document.lineItems : []
    if (!lineItems.length) {
      doc.font('Helvetica').fontSize(10).fillColor('#888888').text('No line items on this invoice')
    } else {
      lineItems.forEach((row) => {
        const description = stripHtml(row.description)
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333')
          .text(`${row.index}. ${description}`, { width: contentWidth })
        doc.font('Helvetica').fontSize(9).fillColor('#666666')
          .text(
            `Rate: ${row.rate}   Qty: ${row.quantity}   Tax: ${row.tax}   Amount: ${row.total}`,
            { width: contentWidth }
          )
        doc.moveDown(0.35)
      })
    }

    drawSectionTitle(doc, 'Summary')
    ;(document.totals || []).forEach((row) => {
      const isGrand = row.label === 'Total due'
      doc.font(isGrand ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(isGrand ? 12 : 10)
        .fillColor(isGrand ? HEADER_COLOR : '#333333')
      drawKeyValueRow(doc, row.label, row.amount)
    })

    doc.moveDown(1)
    doc.font('Helvetica').fontSize(9).fillColor('#888888')
      .text('Please remit payment by the due date above. Contact us if you have any questions about this invoice.', {
        width: contentWidth,
      })

    doc.end()
  })
}

const generateInvoicePdf = async (html, document) => {
  if (process.env.INVOICE_PDF_ENGINE === 'pdfkit') {
    return generateInvoicePdfWithPdfkit(document)
  }

  try {
    return await generateInvoicePdfWithPuppeteer(html)
  } catch (err) {
    console.warn('[generateInvoicePdf] Puppeteer unavailable, using PDFKit fallback:', err.message)
    return generateInvoicePdfWithPdfkit(document)
  }
}

module.exports = {
  generateInvoicePdf,
  generateInvoicePdfWithPdfkit,
  generateInvoicePdfWithPuppeteer,
}
