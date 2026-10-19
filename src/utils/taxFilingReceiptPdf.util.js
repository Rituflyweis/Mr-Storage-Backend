const PDFDocument = require('pdfkit')
const { getInvoiceCompany } = require('../config/invoiceCompany')

const PAGE_MARGIN = 48

const formatMoney = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n || 0))

const formatDateTime = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const buildTaxFilingReceiptPdfBuffer = (tax = {}) => {
  const company = getInvoiceCompany()
  const doc = new PDFDocument({ margin: PAGE_MARGIN, size: 'A4' })
  const buffers = []
  doc.on('data', (chunk) => buffers.push(chunk))

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const w = doc.page.width - PAGE_MARGIN * 2
    doc.font('Helvetica-Bold').fontSize(16).text(company.name || 'Steel Building Depot', PAGE_MARGIN)
    doc.moveDown(0.3)
    doc.font('Helvetica').fontSize(11).fillColor('#444').text('Tax payment receipt', PAGE_MARGIN)
    doc.moveDown(1.2)

    const rows = [
      ['Confirmation number', tax.confirmationNumber || '—'],
      ['State / region', tax.state || '—'],
      ['Amount paid', formatMoney(tax.paidFiled ?? tax.amount)],
      ['Payment method', tax.paymentMethod || tax.providerMethod || '—'],
      ['Paid at', formatDateTime(tax.paidAt)],
      ['Status', tax.paymentStatus || 'completed'],
    ]
    rows.forEach(([label, value]) => {
      doc.font('Helvetica').fontSize(10).fillColor('#666').text(label, PAGE_MARGIN, doc.y, { continued: false })
      doc.font('Helvetica-Bold').fillColor('#111').text(String(value), PAGE_MARGIN + 160, doc.y - 12, {
        width: w - 160,
        align: 'right',
      })
      doc.moveDown(0.6)
    })

    doc.moveDown(1)
    doc.font('Helvetica').fontSize(8).fillColor('#888').text(
      'This receipt confirms payment recorded in Mr Storage. Retain for your records.',
      PAGE_MARGIN,
      doc.y,
      { width: w }
    )
    doc.end()
  })
}

module.exports = { buildTaxFilingReceiptPdfBuffer }
