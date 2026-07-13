/**
 * Marks the request as admin plant scope so plant controllers
 * resolve data across all approved PO orders (no assignedTo filter).
 */
module.exports = (req, _res, next) => {
  req.plantAccessScope = 'admin'
  next()
}
