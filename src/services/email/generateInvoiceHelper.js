const PDFDocument = require('pdfkit')

const generateInvoicePdf = async (html) => {
  // Simple PDF — HTML render nahi hoga but reliable hai
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument()
    const buffers = []
    doc.on('data', chunk => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)
    doc.fontSize(12).text('Invoice', { align: 'center' })
    doc.end()
  })
}

module.exports = { generateInvoicePdf }