const PDFDocument = require('pdfkit')

const renderPdf = (buildFn) => {
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

    const heading = (delivery) => {
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#111827')
        .text(`Delivery ${delivery.deliveryNumber || ''}`, { align: 'left' })
      doc.fontSize(10).font('Helvetica').fillColor('#6b7280')
        .text(`${delivery.project?.projectName || ''} (${delivery.project?.projectId || ''})`)
    }

    buildFn(doc, { section, row, heading })
    doc.end()
  })
}

const generateDeliveryInfoPdf = (delivery) => renderPdf((doc, { section, row, heading }) => {
  heading(delivery)

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
})

const generatePackingListPdf = (delivery, bundles = [], packingLists = []) => renderPdf((doc, { section, row, heading }) => {
  heading(delivery)

  section('Packing List Summary')
  row('Total Parts', delivery.packingListSummary?.totalParts ?? '—')
  row('Bundle Types', delivery.packingListSummary?.bundleTypes ?? '—')
  row('Material', delivery.packingListSummary?.material || '—')

  section('Trucks')
  if (!packingLists.length) {
    doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('No truck/packing list data available yet.')
  }
  for (const pl of packingLists) {
    row(pl.packingListNo || 'Truck', `${pl.truckLabel || pl.truckNo || ''} — ${pl.totalBundles ?? 0} bundle(s), ${pl.totalWeight ?? '—'} lbs`)
  }

  section('Bundles')
  if (!bundles.length) {
    doc.fontSize(10).font('Helvetica').fillColor('#6b7280').text('No bundle data available yet.')
  }
  for (const b of bundles) {
    row(b.bundleNo || 'Bundle', `${b.bundleType || ''} — ${b.title || 'Untitled'}, qty ${b.totalQty ?? '—'}, ${b.totalWeight ?? '—'} lbs`)
  }
})

const generateInstructionsPdf = (delivery) => renderPdf((doc, { section, row, heading }) => {
  heading(delivery)

  section('Delivery Details')
  row('Delivery Date', delivery.deliveryDate ? new Date(delivery.deliveryDate).toLocaleDateString() : '—')
  row('Time Window', delivery.timings || '—')
  row('Estimated Weight', delivery.estimatedWeight != null ? `${delivery.estimatedWeight} lbs` : '—')

  section('Instructions')
  row('Site Instructions', delivery.siteInstructions || '—')
  row('Required Equipment', (delivery.loadingEquipment || []).join(', ') || '—')
  row('Special Notes', delivery.specialNotes || '—')

  section('Contacts')
  row('Receiving POC', `${delivery.receivingPoc?.name || '—'} (${delivery.receivingPoc?.phone || '—'})`)
  row('Delivery Team', `${delivery.deliveryTeam?.company || '—'} — ${delivery.deliveryTeam?.driver || '—'} (${delivery.deliveryTeam?.phone || '—'})`)
})

module.exports = { generateDeliveryInfoPdf, generatePackingListPdf, generateInstructionsPdf }
