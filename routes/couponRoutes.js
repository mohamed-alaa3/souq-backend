const express = require("express");

const {
  createCoupon,
  getCoupons,
  getCoupon,
  updateCoupon,
  toggleCouponActive,
  deleteCoupon,
  validateCoupon,
} = require("../controllers/couponController");

const protect = require("../middlewares/protect");
const authorize = require("../middlewares/authorize");

const router = express.Router();

router.use(protect);

// Any authenticated customer can check a code against their cart at checkout.
router.post("/validate", validateCoupon);

// Everything else is admin-only coupon management.
router.get("/", authorize("admin"), getCoupons);
router.post("/", authorize("admin"), createCoupon);
router.get("/:id", authorize("admin"), getCoupon);
router.put("/:id", authorize("admin"), updateCoupon);
router.patch("/:id/toggle", authorize("admin"), toggleCouponActive);
router.delete("/:id", authorize("admin"), deleteCoupon);

module.exports = router;
