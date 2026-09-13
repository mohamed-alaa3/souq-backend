const express = require("express");

const {
  getSellerAnalytics,
  getAdminAnalytics,
} = require("../controllers/analyticsController");

const protect = require("../middlewares/protect");
const authorize = require("../middlewares/authorize");

const router = express.Router();

router.use(protect);

router.get("/seller", authorize("seller"), getSellerAnalytics);
router.get("/admin", authorize("admin"), getAdminAnalytics);

module.exports = router;
