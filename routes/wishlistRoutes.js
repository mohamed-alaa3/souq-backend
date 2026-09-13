const express = require("express");

const {
  getWishlist,
  addProduct,
  removeProduct,
  clearWishlist,
  checkProduct,
} = require("../controllers/wishlistController");

const protect = require("../middlewares/protect");

const router = express.Router();

// Every wishlist route belongs to the authenticated user only - there is no
// way to pass another user's id in, so IDOR access to someone else's
// wishlist is not possible.
router.use(protect);

router.get("/", getWishlist);
router.post("/items", addProduct);
router.delete("/items/:productId", removeProduct);
router.delete("/", clearWishlist);
router.get("/check/:productId", checkProduct);

module.exports = router;
