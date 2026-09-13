const express = require("express");

const {
  getProducts,
  getProduct,
  getRelatedProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const {
  getProductReviews,
  getMyReviewForProduct,
} = require("../controllers/reviewController");

const protect = require("../middlewares/protect");
const authorize = require("../middlewares/authorize");
const upload = require("../middlewares/upload");

const router = express.Router();

router.get("/", getProducts);

// Reviews are nested under their product. "/me" must be declared before the
// generic "/:id" product route below so it isn't swallowed by it.
router.get("/:productId/reviews", getProductReviews);
router.get("/:productId/reviews/me", protect, getMyReviewForProduct);

// Must be declared before "/:id" so it isn't swallowed by it.
router.get("/:id/related", getRelatedProducts);

router.get("/:id", getProduct);

router.post(
  "/",
  protect,
  authorize("seller", "admin"),
  upload.array("images", 5),
  createProduct,
);

router.put(
  "/:id",
  protect,
  authorize("seller", "admin"),
  upload.array('images', 5),
  updateProduct,
);

router.delete("/:id", protect, authorize("seller", "admin"), deleteProduct);

module.exports = router;
