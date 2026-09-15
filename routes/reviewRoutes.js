const express = require("express");

const {
  createReview,
  getReviewById,
  updateReview,
  deleteReview,
} = require("../controllers/reviewController");

const protect = require("../middlewares/protect");
const authorize = require("../middlewares/authorize");
const { moderateLimiter } = require("../middlewares/rateLimiters");

const router = express.Router();

// All review write actions require authentication.
router.use(protect);

// Only customers create reviews (sellers/admins don't purchase through Souq).
router.post("/", authorize("customer"), moderateLimiter, createReview);

// Ownership (or admin/product-seller, for get & delete) is enforced inside
// the controller.
router.get("/:id", getReviewById);
router.patch("/:id", updateReview);
router.delete("/:id", deleteReview);

module.exports = router;
