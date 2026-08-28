// SMDTCostVersion "SEED-MBS-2025" claims 20 items imported but SMDTItem collection is empty —
// data never persisted. Seeds mock parts so filters/stats endpoints have real data.
require('dotenv').config()
const mongoose = require('mongoose')

async function run() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('Connected to:', mongoose.connection.db.databaseName)

  const SMDTItem = require('../src/models/SMDTItem')
  const SMDTCostVersion = require('../src/models/SMDTCostVersion')
  const User = require('../src/models/User')

  const version = await SMDTCostVersion.findOne({ isActive: true })
  if (!version) { console.log('No active cost version found'); process.exit(1) }
  const admin = await User.findOne({ role: 'admin' })

  const rows = [
    { category: 'Panels', partName: 'PBR Panel 26GA', partColor: 'Galvalume', costUnit: 'FT', mbsCost: 1.15, currentMarketCost: 1.22, isFrameType: false },
    { category: 'Panels', partName: 'PBR Panel 24GA', partColor: 'White', costUnit: 'FT', mbsCost: 1.45, currentMarketCost: 1.5, isFrameType: false },
    { category: 'Panels', partName: 'R-Panel 29GA', partColor: 'Red', costUnit: 'FT', mbsCost: 0.95, currentMarketCost: 0.99, isFrameType: false },
    { category: 'TRIM', partName: 'Eave Trim', partColor: 'White', costUnit: 'EA', mbsCost: 12.5, currentMarketCost: 13.0, isFrameType: false },
    { category: 'TRIM', partName: 'Corner Trim', partColor: 'Galvalume', costUnit: 'EA', mbsCost: 9.75, currentMarketCost: 10.1, isFrameType: false },
    { category: 'TRIM', partName: 'Ridge Cap', partColor: 'Red', costUnit: 'EA', mbsCost: 18.0, currentMarketCost: 18.5, isFrameType: false },
    { category: 'frames', partName: 'Rigid Frame Column 24x8', partColor: null, costUnit: 'LB', mbsCost: 0.62, currentMarketCost: 0.65, isFrameType: true },
    { category: 'frames', partName: 'Rigid Frame Rafter 24x10', partColor: null, costUnit: 'LB', mbsCost: 0.64, currentMarketCost: 0.67, isFrameType: true },
    { category: 'Joist', partName: 'Open Web Joist 24K4', partColor: null, costUnit: 'FT', mbsCost: 4.2, currentMarketCost: 4.35, isFrameType: false },
    { category: 'Joist', partName: 'Bar Joist 20K3', partColor: null, costUnit: 'FT', mbsCost: 3.9, currentMarketCost: 4.0, isFrameType: false },
    { category: 'Screws', partName: 'Self-Drilling Screw #12', partColor: null, costUnit: 'EA', mbsCost: 0.08, currentMarketCost: 0.09, isFrameType: false },
    { category: 'Screws', partName: 'Stitch Screw #14', partColor: null, costUnit: 'EA', mbsCost: 0.06, currentMarketCost: 0.07, isFrameType: false },
    { category: 'ABolts', partName: 'Anchor Bolt 3/4x18', partColor: null, costUnit: 'EA', mbsCost: 3.5, currentMarketCost: 3.75, isFrameType: false },
    { category: 'CLIPS', partName: 'Standing Seam Clip', partColor: null, costUnit: 'EA', mbsCost: 1.1, currentMarketCost: 1.15, isFrameType: false },
    { category: 'Cable', partName: 'Bracing Cable 3/8', partColor: null, costUnit: 'FT', mbsCost: 0.85, currentMarketCost: 0.9, isFrameType: false },
    { category: 'Flange_Brace', partName: 'Flange Brace Angle', partColor: null, costUnit: 'EA', mbsCost: 6.25, currentMarketCost: 6.5, isFrameType: false },
    { category: 'Jambs', partName: 'Door Jamb Standard', partColor: 'White', costUnit: 'EA', mbsCost: 22.0, currentMarketCost: 23.0, isFrameType: false },
    { category: 'EaveStruts', partName: 'Eave Strut 8Z', partColor: null, costUnit: 'FT', mbsCost: 2.1, currentMarketCost: 2.2, isFrameType: false },
    { category: 'ACCESSORIES', partName: 'Roof Vent 12in', partColor: 'Galvalume', costUnit: 'EA', mbsCost: 45.0, currentMarketCost: 47.5, isFrameType: false },
    { category: 'Insulation', partName: 'Vinyl Faced Insulation R-19', partColor: null, costUnit: 'FT', mbsCost: 0.55, currentMarketCost: 0.58, isFrameType: false },
  ]

  let inserted = 0
  for (const r of rows) {
    await SMDTItem.create({
      costVersionId: version._id,
      category: r.category,
      partName: r.partName,
      partNameNormalized: r.partName.toUpperCase(),
      partColor: r.partColor,
      partColorNormalized: r.partColor ? r.partColor.toUpperCase() : null,
      costUnit: r.costUnit,
      mbsCost: r.mbsCost,
      currentMarketCost: r.currentMarketCost,
      isFrameType: r.isFrameType,
      isActive: true,
      description: `${r.partName}${r.partColor ? ' - ' + r.partColor : ''}`,
      addedBy: admin?._id || null,
      lastImportedAt: version.createdAt,
    })
    inserted++
  }
  console.log('Inserted', inserted, 'SMDTItem rows under version', version._id.toString())
  process.exit(0)
}
run().catch(e => { console.error(e); process.exit(1) })
