// src/utils/exportInvoices.js
const ExcelJS = require('exceljs')
const PDFDocument = require('pdfkit')

// ─── EXCEL ───────────────────────────────────────────
const generateInvoiceListExcel = async (rows) => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Invoices')

  sheet.columns = [
    { header: 'Invoice #',   key: 'invoiceNumber', width: 15 },
    { header: 'Project',     key: 'projectName',   width: 25 },
    { header: 'Customer',    key: 'customer',      width: 25 },
    { header: 'Amount',      key: 'totalAmount',   width: 15 },
    { header: 'Status',      key: 'status',        width: 12 },
    { header: 'Due Date',    key: 'dueDate',       width: 15 },
    { header: 'Created At',  key: 'createdAt',     width: 18 },
  ]

  for (const inv of rows) {
    sheet.addRow({
      invoiceNumber: inv.invoiceNumber || '—',
      projectName:   inv.projectName   || '—',
      customer:      inv.customerId ? `${inv.customerId.firstName} ${inv.customerId.lastName}` : '—',
      totalAmount:   inv.totalAmount   || 0,
      status:        inv.status        || '—',
      dueDate:       inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—',
      createdAt:     inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—',
    })
  }

  // Header row bold
  sheet.getRow(1).font = { bold: true }

  return await workbook.xlsx.writeBuffer()
}

// ─── PDF ─────────────────────────────────────────────
const generateInvoiceListPdf = (rows) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' })
    const buffers = []

    doc.on('data', chunk => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const cols = [
      { label: 'Invoice #',  x: 40,  width: 70  },
      { label: 'Project',    x: 110, width: 130 },
      { label: 'Customer',   x: 240, width: 120 },
      { label: 'Amount',     x: 360, width: 80  },
      { label: 'Status',     x: 440, width: 70  },
      { label: 'Due Date',   x: 510, width: 90  },
      { label: 'Created At', x: 600, width: 90  },
    ]

    const ROW_HEIGHT = 20
    const PAGE_BOTTOM = 540

    const drawHeader = () => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
      cols.forEach(col => {
        doc.text(col.label, col.x, doc.y, { width: col.width, ellipsis: true })
      })
      doc.moveDown(0.3)
      doc.moveTo(40, doc.y).lineTo(800, doc.y).lineWidth(1).stroke()
      doc.moveDown(0.3)
    }

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text('Invoice List', { align: 'center' })
    doc.moveDown(0.5)

    drawHeader()

    doc.fontSize(8).font('Helvetica').fillColor('#333333')

    for (const inv of rows) {
      // Page break check
      if (doc.y + ROW_HEIGHT > PAGE_BOTTOM) {
        doc.addPage()
        drawHeader()
        doc.fontSize(8).font('Helvetica').fillColor('#333333')
      }

      const rowY = doc.y
      const customer = inv.customerId
        ? `${inv.customerId.firstName || ''} ${inv.customerId.lastName || ''}`.trim()
        : '—'

      const values = [
        inv.invoiceNumber || '—',
        inv.projectName   || '—',
        customer,
        inv.totalAmount != null ? `$${inv.totalAmount}` : '—',
        inv.status        || '—',
        inv.dueDate   ? new Date(inv.dueDate).toLocaleDateString()   : '—',
        inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '—',
      ]

      // Har column same rowY pe render karo
      cols.forEach((col, i) => {
        doc.text(values[i], col.x, rowY, {
          width: col.width,
          ellipsis: true,   // ← overflow text cut hoga, wrap nahi hoga
          lineBreak: false, // ← single line force
        })
      })

      doc.y = rowY + ROW_HEIGHT  // ← fixed row height maintain karo

      // Alternate row background
      if (rows.indexOf(inv) % 2 === 0) {
        doc.rect(40, rowY - 2, 760, ROW_HEIGHT)
          .fillOpacity(0.05)
          .fill('#000000')
          .fillOpacity(1)
      }
    }

    doc.end()
  })
}

module.exports = { generateInvoiceListExcel, generateInvoiceListPdf }