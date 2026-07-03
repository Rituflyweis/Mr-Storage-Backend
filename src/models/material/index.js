const mongoose = require('mongoose')
const mongooseAggregatePaginate = require('mongoose-aggregate-paginate')
const mongoosePaginate = require('mongoose-paginate-v2')

const getModel = (name, schema) => mongoose.models[name] || mongoose.model(name, schema)

const contactDetailsSchema = new mongoose.Schema({
  image: String,
  name: String,
  instagram: String,
  google: String,
  youtube: String,
  apple: String,
  fb: String,
  address: String,
  email: String,
  compliancePhone: String,
  onboardingPhone: String,
  customerCarePhone: String,
  generalEnquiryPhone: String,
  phone: String,
  telePhone: String,
  linkedIn: String,
  twitter: String,
  map: String,
  mapLink: String,
  copyRight: String,
}, { timestamps: true })

const contentSectionSchema = new mongoose.Schema({
  title: String,
  description: String,
  image: String,
  status: {
    type: String,
    enum: ['Active', 'InActive'],
    default: 'Active',
  },
}, { timestamps: true })

const buildingTypeDataSchema = new mongoose.Schema({
  title: String,
  description: String,
  heading1: String,
  headingDescription: String,
  heading2: String,
  heading2Description: String,
  data: [{
    title: String,
    image: String,
  }],
  image: String,
  status: {
    type: String,
    enum: ['Active', 'InActive'],
    default: 'Active',
  },
}, { timestamps: true })

const whyUsDataSchema = new mongoose.Schema({
  title: String,
  description: String,
  heading1: String,
  heading2: String,
  image: String,
  featureData: [{
    feature: String,
    steelBuilding: String,
    wordConcerte: String,
  }],
  status: {
    type: String,
    enum: ['Active', 'InActive'],
    default: 'Active',
  },
}, { timestamps: true })

const clientReviewSchema = new mongoose.Schema({
  userName: String,
  title: String,
  description: String,
  image: String,
  rating: {
    type: Number,
    default: 0,
  },
  isShowOnWebsite: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true })

const newsLetterSchema = new mongoose.Schema({
  email: String,
}, { timestamps: true })

const quotesSchema = new mongoose.Schema({
  buildingTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'buildingType',
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null,
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    default: null,
  },
  width: String,
  length: String,
  height: String,
  roofPitch: String,
  zipCode: String,
  firstName: String,
  lastName: String,
  email: String,
  phoneNumber: String,
  company: String,
  siteAddress: String,
  city: String,
  state: String,
  country: String,
  zip: String,
  notes: String,
  intendedUse: String,
}, { timestamps: true })

const inquireSchema = new mongoose.Schema({
  name: String,
  lastName: String,
  email: String,
  phone: String,
  message: String,
  image: String,
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null,
  },
  leadId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    default: null,
  },
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending',
  },
}, { timestamps: true })
inquireSchema.plugin(mongoosePaginate)
inquireSchema.plugin(mongooseAggregatePaginate)

module.exports = {
  ContactDetails: getModel('contactDetails', contactDetailsSchema),
  BuildingType: getModel('buildingType', contentSectionSchema),
  BuildingTypeData: getModel('buildingTypeData', buildingTypeDataSchema),
  Project: getModel('project', contentSectionSchema),
  WhyUs: getModel('whyUs', contentSectionSchema),
  WhyUsData: getModel('whyUsData', whyUsDataSchema),
  ClientReview: getModel('clientReview', clientReviewSchema),
  NewsLetter: getModel('newsLetter', newsLetterSchema),
  Quotes: getModel('quotes', quotesSchema),
  Inquire: getModel('inquire', inquireSchema),
}
