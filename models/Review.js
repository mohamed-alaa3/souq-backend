const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },

    comment: {
      type: String,
      required: [true, "Review comment is required"],
      trim: true,
      maxlength: 1000,
    },
  },
  { timestamps: true },
);

// A user may only have one review per product (edits go through updateReview).
reviewSchema.index({ user: 1, product: 1 }, { unique: true });

// Recalculates and persists the average rating / review count on the
// related Product. Called explicitly by the controller after any
// create/update/delete so the behaviour stays easy to reason about and test
// (rather than relying on Mongoose query middleware timing).
reviewSchema.statics.calcAverageRatings = async function calcAverageRatings(
  productId,
) {
  // Required lazily to avoid a circular require with Product.js
  const Product = require("./Product");

  const stats = await this.aggregate([
    { $match: { product: productId } },
    {
      $group: {
        _id: "$product",
        numReviews: { $sum: 1 },
        avgRating: { $avg: "$rating" },
      },
    },
  ]);

  const ratingsAverage = stats.length ? Math.round(stats[0].avgRating * 10) / 10 : 0;
  const ratingsQuantity = stats.length ? stats[0].numReviews : 0;

  await Product.findByIdAndUpdate(productId, {
    ratingsAverage,
    ratingsQuantity,
  });

  return { ratingsAverage, ratingsQuantity };
};

module.exports = mongoose.model("Review", reviewSchema);
