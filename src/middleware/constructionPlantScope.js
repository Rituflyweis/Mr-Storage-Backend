/**
 * Construction panel: plant BOM / freight / packing data scoped to
 * projects in plant/construction lifecycle stages (not PO assignment).
 */
module.exports = (req, _res, next) => {
  req.plantAccessScope = 'construction'
  next()
}
