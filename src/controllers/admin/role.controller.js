const Role = require('../../models/Role')
const User = require('../../models/User')
const asyncHandler = require('../../utils/asyncHandler')
const { success, created, notFound, badRequest } = require('../../utils/apiResponse')

exports.listRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find().sort({ createdAt: -1 }).lean()

  const rolesWithCount = await Promise.all(
    roles.map(async (role) => {
      const userCount = await User.countDocuments({ 'roleRef': role._id })
      const totalPermissions = 12
      const granted = Object.values(role.permissions || {}).reduce((acc, perm) => {
        return acc + Object.values(perm).filter(Boolean).length
      }, 0)
      return { ...role, userCount, grantedPermissions: granted, totalPermissions }
    })
  )

  return success(res, { roles: rolesWithCount })
})

exports.createRole = asyncHandler(async (req, res) => {
  const { name, description, color, permissions, template } = req.body

  const exists = await Role.findOne({ name: name.trim() })
  if (exists) return badRequest(res, 'Role name already exists')

  let perms = permissions || {}

  if (template === 'view_only') {
    const modules = ['deliveries','leads','customers','employees','financials','products','invoices','reports','plant','construction','settings','communication']
    perms = {}
    modules.forEach(m => { perms[m] = { view: true, create: false, edit: false, delete: false } })
  } else if (template === 'full_access') {
    const modules = ['deliveries','leads','customers','employees','financials','products','invoices','reports','plant','construction','settings','communication']
    perms = {}
    modules.forEach(m => { perms[m] = { view: true, create: true, edit: true, delete: true } })
  }

  const role = await Role.create({
    name: name.trim(),
    description: description || '',
    color: color || 'blue',
    permissions: perms,
    createdBy: req.user._id,
  })

  return created(res, { role })
})

exports.getRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.roleId).lean()
  if (!role) return notFound(res, 'Role not found')

  const users = await User.find({ 'roleRef': role._id })
    .select('name email role isActive')
    .lean()

  return success(res, { role, users, userCount: users.length })
})

exports.updateRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.roleId)
  if (!role) return notFound(res, 'Role not found')
  if (role.isSystem) return badRequest(res, 'System roles cannot be modified')

  const { name, description, color, permissions } = req.body

  if (name !== undefined) role.name = name.trim()
  if (description !== undefined) role.description = description
  if (color !== undefined) role.color = color
  if (permissions !== undefined) role.permissions = permissions

  await role.save()
  return success(res, { role })
})

exports.deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.roleId)
  if (!role) return notFound(res, 'Role not found')
  if (role.isSystem) return badRequest(res, 'System roles cannot be deleted')

  await Role.deleteOne({ _id: role._id })
  return success(res, {}, 'Role deleted')
})

exports.getPermissionModules = asyncHandler(async (req, res) => {
  const modules = [
    { key: 'deliveries',    label: 'Delivery Management',    description: 'Manage deliveries and schedules' },
    { key: 'leads',         label: 'Lead Management',        description: 'Manage leads and projects' },
    { key: 'customers',     label: 'Customer Management',    description: 'View and manage customers' },
    { key: 'employees',     label: 'Employee Management',    description: 'Manage team members' },
    { key: 'financials',    label: 'Financials',             description: 'Access financial reports and data' },
    { key: 'products',      label: 'Product Library',        description: 'Manage product catalog' },
    { key: 'invoices',      label: 'Invoice Management',     description: 'Create and manage invoices' },
    { key: 'reports',       label: 'Reports & Analytics',    description: 'View system reports' },
    { key: 'plant',         label: 'Plant Operations',       description: 'Manage plant and shipping operations' },
    { key: 'construction',  label: 'Construction',           description: 'Construction project management' },
    { key: 'settings',      label: 'Settings',               description: 'Access system settings' },
    { key: 'communication', label: 'Communication',          description: 'Internal chat and messaging' },
  ]
  const actions = ['view', 'create', 'edit', 'delete']
  return success(res, { modules, actions })
})
