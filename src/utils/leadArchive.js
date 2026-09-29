/** Mongo filter for the archived-leads list (not soft-deleted). */
const buildArchivedLeadListFilter = () => ({
  isDeleted: { $ne: true },
  isArchived: true,
})

module.exports = {
  buildArchivedLeadListFilter,
}
