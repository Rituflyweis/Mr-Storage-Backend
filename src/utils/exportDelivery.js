const PDFDocument = require('pdfkit')

const generateDeliveryInfoPdf = (delivery) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' })
    const buffers = []

    doc.on('data', chunk => buffers.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(buffers)))
    doc.on('error', reject)

    const section = (title) => {
      doc.moveDown(0.8)
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#111827').text(title)
      doc.moveTo(40, doc.y + 2).lineTo(555, doc.y + 2).lineWidth(1).strokeColor('#e5e7eb').stroke()
      doc.moveDown(0.4)
    }

    const row = (label, value) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151').text(label, 40, doc.y, { continued: true, width: 200 })
      doc.font('Helvetica').fillColor('#111827').text(`  ${value ?? '—'}`)
    }

    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111827')
      .text(`Delivery ${delivery.deliveryNumber || ''}`, { align: 'left' })
    doc.fontSize(10).font('Helvetica').fillColor('#6b7280')
      .text(`${delivery.project?.projectName || ''} (${delivery.project?.projectId || ''})`)

    section('Delivery Information')
    row('Delivery Date', delivery.deliveryDate ? new Date(delivery.deliveryDate).toLocaleDateString() : '—')
    row('Time Window', delivery.timings || '—')
    row('Status', delivery.status || '—')
    row('Estimated Weight', delivery.estimatedWeight != null ? `${delivery.estimatedWeight} lbs` : '—')
    row('Required Equipment', (delivery.loadingEquipment || []).join(', ') || '—')

    section('Site Contact & Instructions')
    row('Site Contact', delivery.siteContact?.name || '—')
    row('Contact Phone', delivery.siteContact?.phone || '—')
    row('Site Instructions', delivery.siteInstructions || '—')
    row('Special Notes', delivery.specialNotes || '—')

    section('Delivery Company')
    row('Company', delivery.deliveryCompany?.name || '—')
    row('Driver', delivery.deliveryCompany?.driver || '—')
    row('Phone', delivery.deliveryCompany?.phone || '—')
    row('Email', delivery.deliveryCompany?.email || '—')

    section('Load & Bundle Summary')
    row('Load ID', delivery.loadAndBundle?.loadId || '—')
    row('Bundle Count', delivery.loadAndBundle?.bundleCount ?? '—')
    row('Truck Number', delivery.loadAndBundle?.truckNumber || '—')
    row('Total Weight', delivery.loadAndBundle?.totalWeight != null ? `${delivery.loadAndBundle.totalWeight} lbs` : '—')

    doc.end()
  })
}

module.exports = { generateDeliveryInfoPdf }
