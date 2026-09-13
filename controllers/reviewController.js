const Review = require("../models/Review");
const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const { createNotification, createNotifications } = require("../utils/notificationService");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// A customer may only review a product they have actually ordered
// (any order that hasn't been cancelled counts as a purchase).
const hasPurchasedProduct = async (userId, productId) => {
  const order = await Order.findOne({
    user: userId,
    status: { $ne: "cancelled" },
    "items.product": productId,
  }).select("_id");

  return !!order;
};

const validateRating = (rating) => {
  const numericRating = Number(rating);
  return !Number.isNaN(numericRating) && numericRating >= 1 && numericRating <= 5
    ? numericRating
    : null;
};

// @desc    Create a review for a product the user has purchased
// @route   POST /api/reviews
// @access  Private/Customer
const createReview = asyncHandler(async (req, res) => {
  const { product: productId, rating, comment } = req.body;

  if (!productId || rating === undefined || !comment) {
    throw new ApiError(400, "product, rating and comment are required");
  }

  const numericRating = validateRating(rating);
  if (numericRating === null) {
    throw new ApiError(400, "Rating must be a number between 1 and 5");
  }

  if (!comment.trim()) {
    throw new ApiError(400, "Comment cannot be empty");
  }

  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const purchased = await hasPurchasedProduct(req.user._id, productId);
  if (!purchased) {
    throw new ApiError(
      403,
      "You can only review products you have purchased",
    );
  }

  const existing = await Review.findOne({
    user: req.user._id,
    product: productId,
  });

  if (existing) {
    throw new ApiError(
      400,
      "You have already reviewed this product. Edit your existing review instead.",
    );
  }

  const review = await Review.create({
    user: req.user._id,
    product: productId,
    rating: numericRating,
    comment: comment.trim(),
  });

  await Review.calcAverageRatings(productId);
  await review.populate("user", "name");

  // Notify the seller and all admins so a review - especially a bad,
  // inappropriate, or otherwise problematic one - can be moderated
  // immediately. Both relatedProduct and relatedReview are set so the
  // frontend can deep-link straight to this exact review (not just the
  // product) for one-click inspection/deletion.
  try {
    const reviewerName = review.user?.name || "A customer";
    const reviewMessage = `${reviewerName} left a ${numericRating}-star review on "${product.name}".`;

    const admins = await User.find({ role: "admin" }).select("_id");

    await createNotifications([
      {
        user: product.seller,
        type: "product_review",
        title: "New product review",
        message: reviewMessage,
        relatedProduct: product._id,
        relatedReview: review._id,
      },
      ...admins.map((admin) => ({
        user: admin._id,
        type: "product_review",
        title: "New product review",
        message: reviewMessage,
        relatedProduct: product._id,
        relatedReview: review._id,
      })),
    ]);
  } catch (err) {
    // Notification delivery failing must not fail review creation.
  }

  res.status(201).json({ success: true, data: review });
});

// @desc    Get paginated reviews for a product
// @route   GET /api/products/:productId/reviews
// @access  Public
const getProductReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = (pageNum - 1) * limitNum;

  const [reviews, total, product] = await Promise.all([
    Review.find({ product: productId })
      .populate("user", "name")
      .sort("-createdAt")
      .skip(skip)
      .limit(limitNum),
    Review.countDocuments({ product: productId }),
    Product.findById(productId).select("ratingsAverage ratingsQuantity"),
  ]);

  res.status(200).json({
    success: true,
    data: reviews,
    stats: {
      ratingsAverage: product?.ratingsAverage ?? 0,
      ratingsQuantity: product?.ratingsQuantity ?? 0,
    },
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// @desc    Get the current user's own review for a product, if any
//          (used by the frontend to prefill the edit form)
// @route   GET /api/products/:productId/reviews/me
// @access  Private
const getMyReviewForProduct = asyncHandler(async (req, res) => {
  const review = await Review.findOne({
    product: req.params.productId,
    user: req.user._id,
  });

  res.status(200).json({ success: true, data: review });
});

// @desc    Get a single review with its product populated - used to deep-link
//          from a notification straight to the exact review for moderation
// @route   GET /api/reviews/:id
// @access  Private/Owner, Admin, or the product's seller
const getReviewById = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id)
    .populate("user", "name")
    .populate("product", "name images seller");

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const isOwner = review.user?._id?.toString() === req.user._id.toString();

  const isProductSeller =
    req.user.role === "seller" &&
    review.product?.seller?.toString() === req.user._id.toString();

  if (!isOwner && req.user.role !== "admin" && !isProductSeller) {
    throw new ApiError(403, "You are not allowed to view this review");
  }

  res.status(200).json({ success: true, data: review });
});

// @desc    Update the logged-in user's own review
// @route   PATCH /api/reviews/:id
// @access  Private/Owner
const updateReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const isOwner = review.user.toString() === req.user._id.toString();

  if (!isOwner) {
    throw new ApiError(403, "You can only edit your own review");
  }

  const { rating, comment } = req.body;

  if (rating !== undefined) {
    const numericRating = validateRating(rating);
    if (numericRating === null) {
      throw new ApiError(400, "Rating must be a number between 1 and 5");
    }
    review.rating = numericRating;
  }

  if (comment !== undefined) {
    if (!comment.trim()) {
      throw new ApiError(400, "Comment cannot be empty");
    }
    review.comment = comment.trim();
  }

  await review.save();
  await Review.calcAverageRatings(review.product);
  await review.populate("user", "name");

  res.status(200).json({ success: true, data: review });
});

// @desc    Delete a review (the review's own author, an admin, or the
//          product's seller, all moderating)
// @route   DELETE /api/reviews/:id
// @access  Private/Owner, Admin, or the product's seller
const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);

  if (!review) {
    throw new ApiError(404, "Review not found");
  }

  const isOwner = review.user.toString() === req.user._id.toString();

  let isProductSeller = false;

  if (!isOwner && req.user.role === "seller") {
    const product = await Product.findById(review.product).select("seller");
    isProductSeller =
      !!product && product.seller.toString() === req.user._id.toString();
  }

  if (!isOwner && req.user.role !== "admin" && !isProductSeller) {
    throw new ApiError(403, "You are not allowed to delete this review");
  }

  const productId = review.product;

  await review.deleteOne();
  await Review.calcAverageRatings(productId);

  res.status(200).json({ success: true, data: {} });
});

module.exports = {
  createReview,
  getProductReviews,
  getMyReviewForProduct,
  getReviewById,
  updateReview,
  deleteReview,
};
