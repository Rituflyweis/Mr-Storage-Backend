const router = require('express').Router()
const multer = require('multer')
const ctrl = require('../../controllers/material/admin.controller')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 10 },
})

router.post('/static/addContactDetails', ctrl.addContactDetails)
router.get('/static/viewContactDetails', ctrl.viewContactDetails)

router.post('/static/createBuildingType', upload.single('image'), ctrl.createBuildingType)
router.get('/static/BuildingType/:id', ctrl.getBuildingTypeById)
router.delete('/static/BuildingType/:id', ctrl.deleteBuildingType)
router.get('/static/getBuildingType', ctrl.getAllBuildingType)
router.put('/static/updateBuildingType/:id', upload.single('image'), ctrl.updateBuildingType)

router.post('/static/createBuildingTypeData', upload.single('image'), ctrl.createBuildingTypeData)
router.get('/static/BuildingTypeData/:id', ctrl.getBuildingTypeDataById)
router.delete('/static/BuildingTypeData/:id', ctrl.deleteBuildingTypeData)
router.get('/static/getBuildingTypeData', ctrl.getAllBuildingTypeData)
router.post('/static/addDatainBuildingTypeData', upload.single('image'), ctrl.addDatainBuildingTypeData)
router.put('/static/updateDatainBuildingTypeData', upload.single('image'), ctrl.updateDatainBuildingTypeData)
router.delete('/static/deleteDatainBuildingTypeData/:id', ctrl.deleteDatainBuildingTypeData)

router.post('/static/createProject', upload.single('image'), ctrl.createProject)
router.get('/static/Project/:id', ctrl.getProjectById)
router.delete('/static/Project/:id', ctrl.deleteProject)
router.get('/static/getProject', ctrl.getAllProject)
router.put('/static/updateProject/:id', upload.single('image'), ctrl.updateProject)

router.post('/static/createwhyUs', upload.single('image'), ctrl.createwhyUs)
router.get('/static/whyUs/:id', ctrl.getwhyUsById)
router.delete('/static/whyUs/:id', ctrl.deletewhyUs)
router.get('/static/getwhyUs', ctrl.getAllwhyUs)
router.put('/static/updatewhyUs/:id', upload.single('image'), ctrl.updatewhyUs)

router.post('/static/createwhyUsData', upload.single('image'), ctrl.createwhyUsData)
router.get('/static/whyUsData/:id', ctrl.getwhyUsDataById)
router.delete('/static/whyUsData/:id', ctrl.deletewhyUsData)
router.get('/static/getwhyUsData', ctrl.getAllwhyUsData)
router.post('/static/addFeatureDatainwhyUsData', ctrl.addFeatureDatainwhyUsData)
router.put('/static/updateFeatureDataInwhyUsData', ctrl.updateFeatureDataInwhyUsData)
router.delete('/static/deleteFeatureDataInwhyUsData/:id', ctrl.deleteFeatureDataInwhyUsData)

router.post('/clientReview/addclientReview', upload.single('image'), ctrl.createClientReview)
router.put('/clientReview/put/:id', upload.single('image'), ctrl.updateClientReview)
router.get('/clientReview', ctrl.getAllClientReviews)
router.delete('/clientReview/:id', ctrl.removeClientReview)
router.get('/clientReview/get/:id', ctrl.getClientReviewById)
router.get('/clientReview/ForAdmin', ctrl.getAllClientReviewsForAdmin)

module.exports = router
