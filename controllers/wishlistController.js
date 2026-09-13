const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const PRODUCT_SELECT =
  "name price discountPercentage finalPrice images stock isActive category seller ratingsAverage ratingsQuantity";

const getOrCreateWishlist = async (userId) => {
  let wishlist = await Wishlist.findOne({ user: userId });

  if (!wishlist) {
    wishlist = await Wishlist.create({ user: userId, products: [] });
  }

  return wishlist;
};

// @desc    Get the current user's wishlist (populated with product details)
// @route   GET /api/wishlist
// @access  Private
const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user._id);

  await wishlist.populate({ path: "products", select: PRODUCT_SELECT });

  res.status(200).json({ success: true, data: wishlist });
});

// @desc    Add a product to the current user's wishlist
// @route   POST /api/wishlist/items
// @access  Private
const addProduct = asyncHandler(async (req, res) => {
  const { productId } = req.body;

  if (!productId) {
    throw new ApiError(400, "productId is required");
  }

  const product = await Product.findById(productId);

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const wishlist = await getOrCreateWishlist(req.user._id);

  const alreadyIn = wishlist.products.some(
    (p) => p.toString() === productId,
  );

  if (!alreadyIn) {
    wishlist.products.push(productId);
    await wishlist.save();
  }

  await wishlist.populate({ path: "products", select: PRODUCT_SELECT });

  res.status(200).json({ success: true, data: wishlist });
});

// @desc    Remove a product from the current user's wishlist
// @route   DELETE /api/wishlist/items/:productId
// @access  Private
const removeProduct = asyncHandler(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user._id);

  wishlist.products = wishlist.products.filter(
    (p) => p.toString() !== req.params.productId,
  );

  await wishlist.save();

  await wishlist.populate({ path: "products", select: PRODUCT_SELECT });

  res.status(200).json({ success: true, data: wishlist });
});

// @desc    Clear the current user's entire wishlist
// @route   DELETE /api/wishlist
// @access  Private
const clearWishlist = asyncHandler(async (req, res) => {
  const wishlist = await getOrCreateWishlist(req.user._id);

  wishlist.products = [];

  await wishlist.save();

  res.status(200).json({ success: true, data: wishlist });
});

// @desc    Check whether a product is in the current user's wishlist
// @route   GET /api/wishlist/check/:productId
// @access  Private
const checkProduct = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id }).select(
    "products",
  );

  const inWishlist = !!wishlist?.products.some(
    (p) => p.toString() === req.params.productId,
  );

  res.status(200).json({ success: true, data: { inWishlist } });
});

module.exports = {
  getWishlist,
  addProduct,
  removeProduct,
  clearWishlist,
  checkProduct,
};
