const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema(
  {
    size: {
      type: String,
      trim: true,
      maxlength: 20,
    },

    color: {
      type: String,
      trim: true,
      maxlength: 50,
    },

    sku: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 50,
    },

    stock: {
      type: Number,
      required: true,
      min: [0, "Variant stock cannot be negative"],
      default: 0,
    },
  },
  { _id: true },
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      maxlength: 120,
    },

    description: {
      type: String,
      required: [true, "Product description is required"],
    },

    price: {
      type: Number,
      required: [true, "Product price is required"],
      min: [0, "Price cannot be negative"],
    },

    discountPercentage: {
      type: Number,
      min: [0, "Discount percentage cannot be negative"],
      max: [100, "Discount percentage cannot exceed 100"],
      default: 0,
    },

    // Kept for backward compatibility with existing products.
    // Products without variants continue using this stock value.
    stock: {
      type: Number,
      required: true,
      min: [0, "Stock cannot be negative"],
      default: 0,
    },

    variants: {
      type: [variantSchema],
      default: [],
    },

    images: {
      type: [String],
      default: [],
    },

    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },

    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    // Denormalized review stats, kept in sync by Review.calcAverageRatings().
    ratingsAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    ratingsQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

productSchema.index({ name: "text", description: "text" });

// Calculate the final price after discount
productSchema.virtual("finalPrice").get(function () {
  return this.price * (1 - this.discountPercentage / 100);
});

// Calculate total stock from variants when variants exist.
// Existing products without variants continue using product.stock.
productSchema.virtual("totalVariantStock").get(function () {
  if (!this.variants || this.variants.length === 0) {
    return this.stock;
  }

  return this.variants.reduce((total, variant) => total + variant.stock, 0);
});

// Whether this product actually uses variants
productSchema.virtual("hasVariants").get(function () {
  return this.variants && this.variants.length > 0;
});

// Include virtual fields in API responses
productSchema.set("toJSON", {
  virtuals: true,
});

productSchema.set("toObject", {
  virtuals: true,
});

module.exports = mongoose.model("Product", productSchema);
