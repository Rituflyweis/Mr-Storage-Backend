const mongoose = require('mongoose')

const ROLE_COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'pink', 'black']

const PermissionSchema = new mongoose.Schema(
  {
    view:   { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit:   { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
  },
  { _id: false }
)

const RoleSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '', trim: true },
    color:       { type: String, default: 'blue', trim: true },
    isSystem:    { type: Boolean, default: false },
    permissions: {
      deliveries:       { type: PermissionSchema, default: () => ({}) },
      leads:            { type: PermissionSchema, default: () => ({}) },
      customers:        { type: PermissionSchema, default: () => ({}) },
      employees:        { type: PermissionSchema, default: () => ({}) },
      financials:       { type: PermissionSchema, default: () => ({}) },
      products:         { type: PermissionSchema, default: () => ({}) },
      invoices:         { type: PermissionSchema, default: () => ({}) },
      reports:          { type: PermissionSchema, default: () => ({}) },
      plant:            { type: PermissionSchema, default: () => ({}) },
      construction:     { type: PermissionSchema, default: () => ({}) },
      settings:         { type: PermissionSchema, default: () => ({}) },
      communication:    { type: PermissionSchema, default: () => ({}) },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Role', RoleSchema)
module.exports.ROLE_COLORS = ROLE_COLORS
