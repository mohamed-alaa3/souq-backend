const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

// @desc    Get products with search/filter/sort/pagination
// @route   GET /api/products?category=&search=&minPrice=&maxPrice=&sort=&page=&limit=
// @access  Public

const getProducts = asyncHandler(async (req, res) => {
  const {
    category,
    search,
    minPrice,
    maxPrice,
    discount,
    inStock,
    minRating,
    sort,
    page = 1,
    limit = 12,
  } = req.query;

  const query = { isActive: true };

  if (category) {
    query.category = category;
  }

  if (minPrice || maxPrice) {
    query.price = {};

    if (minPrice) {
      query.price.$gte = Number(minPrice);
    }

    if (maxPrice) {
      query.price.$lte = Number(maxPrice);
    }
  }

  // Only show products that currently have an active discount.
  if (discount === "true") {
    query.discountPercentage = { $gt: 0 };
  }

  // Stock availability: "true" -> only in-stock items, "false" -> only
  // out-of-stock items. Omitted entirely shows both (default behaviour
  // is unchanged for anyone not using this filter).
  if (inStock === "true") {
    query.stock = { $gt: 0 };
  } else if (inStock === "false") {
    query.stock = 0;
  }

  // Only meaningful once products have reviews - safe no-op otherwise
  // since ratingsAverage defaults to 0 on every product.
  if (minRating) {
    query.ratingsAverage = { $gte: Number(minRating) };
  }

  if (search) {
    query.$text = { $search: search };
  }

  const sortMap = {
    price_asc: "price",
    price_desc: "-price",
    newest: "-createdAt",
    rating: "-ratingsAverage",
    // No page-view tracking exists in this project, so "popularity" is
    // approximated from real data we do have: how many customers left a
    // review, tie-broken by rating.
    popularity: "-ratingsQuantity -ratingsAverage",
  };

  const sortBy = sortMap[sort] || "-createdAt";

  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.min(Math.max(Number(limit) || 12, 1), 100);

  const skip = (pageNum - 1) * limitNum;

  const [products, total] = await Promise.all([
    Product.find(query)
      .populate("category", "name slug")
      .populate("seller", "name")
      .sort(sortBy)
      .skip(skip)
      .limit(limitNum),

    Product.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: products,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    },
  });
});

// @desc    Get single product by id
// @route   GET /api/products/:id
// @access  Public

const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id)
    .populate("category", "name slug")
    .populate("seller", "name");

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  res.status(200).json({
    success: true,
    data: product,
  });
});

// @desc    Get related products (same category, active, excludes current)
// @route   GET /api/products/:id/related
// @access  Public

const getRelatedProducts = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).select("category");

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  // Note: intentionally not "Number(req.query.limit) || 8" — that would
  // treat an explicit limit=0 as falsy and silently fall back to 8
  // instead of clamping it to the minimum of 1. Only an absent/non-numeric
  // limit (Number(...) -> NaN) should fall back to the default of 8.
  const rawLimit = Number(req.query.limit);
  const limitNum = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 20)
    : 8;

  const relatedProducts = await Product.find({
    _id: { $ne: product._id },
    category: product.category,
    isActive: true,
  })
    .select(
      "name price discountPercentage stock images category ratingsAverage ratingsQuantity isActive",
    )
    .populate("category", "name slug")
    .sort("-ratingsQuantity -ratingsAverage -createdAt")
    .limit(limitNum);

  res.status(200).json({
    success: true,
    data: relatedProducts,
  });
});

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Seller,Admin

const createProduct = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    price,
    discountPercentage,
    stock,
    variants,
    category,
    images,
  } = req.body;

  if (!name || !description || price === undefined || !category) {
    throw new ApiError(
      400,
      "name, description, price and category are required",
    );
  }

  // Normalize variants.
  let normalizedVariants = [];

  if (Array.isArray(variants)) {
    normalizedVariants = variants.map((variant) => ({
      size: variant.size ? String(variant.size).trim() : undefined,
      color: variant.color ? String(variant.color).trim() : undefined,
      sku: variant.sku ? String(variant.sku).trim().toUpperCase() : undefined,
      stock:
        variant.stock === undefined || variant.stock === ""
          ? 0
          : Number(variant.stock),
    }));
  }

  // Images uploaded as files through Cloudinary
  const uploadedImages = req.files
    ? req.files.map((file) => file.path)
    : [];

  // Image URLs sent directly from frontend
  let imageUrls = [];

  if (Array.isArray(images)) {
    imageUrls = images.map((url) => String(url).trim()).filter(Boolean);
  } else if (typeof images === "string" && images.trim()) {
    imageUrls = [images.trim()];
  }

  // Combine uploaded images and image URLs
  const allImages = [...uploadedImages, ...imageUrls];

  const product = await Product.create({
    name,
    description,
    price,
    discountPercentage:
      discountPercentage === undefined || discountPercentage === ""
        ? 0
        : Number(discountPercentage),
    stock: stock === undefined || stock === "" ? 0 : Number(stock),
    variants: normalizedVariants,
    images: allImages,
    category,
    seller: req.user._id,
  });

  res.status(201).json({
    success: true,
    data: product,
  });
});

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Seller(owner),Admin

const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const isOwner =
    product.seller.toString() === req.user._id.toString();

  if (!isOwner && req.user.role !== "admin") {
    throw new ApiError(403, "You can only update your own products");
  }

  const {
    name,
    description,
    price,
    discountPercentage,
    stock,
    variants,
    category,
    isActive,
    images,
  } = req.body;

  if (name !== undefined) {
    product.name = name;
  }

  if (description !== undefined) {
    product.description = description;
  }

  if (price !== undefined) {
    product.price = price;
  }

  if (discountPercentage !== undefined && discountPercentage !== "") {
    product.discountPercentage = Number(discountPercentage);
  }

  if (stock !== undefined) {
    product.stock = Number(stock);
  }

  if (category !== undefined) {
    product.category = category;
  }

  if (isActive !== undefined) {
    product.isActive = isActive;
  }

  // Update variants when provided.
  if (Array.isArray(variants)) {
    product.variants = variants.map((variant) => ({
      size: variant.size ? String(variant.size).trim() : undefined,
      color: variant.color ? String(variant.color).trim() : undefined,
      sku: variant.sku
        ? String(variant.sku).trim().toUpperCase()
        : undefined,
      stock:
        variant.stock === undefined || variant.stock === ""
          ? 0
          : Number(variant.stock),
    }));
  }

  // Uploaded images through Cloudinary
  const uploadedImages = req.files
    ? req.files.map((file) => file.path)
    : [];

  // Image URLs sent from frontend
  let imageUrls = [];

  if (Array.isArray(images)) {
    imageUrls = images.map((url) => String(url).trim()).filter(Boolean);
  } else if (typeof images === "string" && images.trim()) {
    imageUrls = [images.trim()];
  }

  // If new images were provided, replace old images
  if (uploadedImages.length > 0 || imageUrls.length > 0) {
    product.images = [...uploadedImages, ...imageUrls];
  }

  await product.save();

  res.status(200).json({
    success: true,
    data: product,
  });
});

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Seller(owner),Admin

const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  const isOwner = product.seller.toString() === req.user._id.toString();

  if (!isOwner && req.user.role !== "admin") {
    throw new ApiError(403, "You can only delete your own products");
  }

  await product.deleteOne();

  res.status(200).json({
    success: true,
    data: {},
  });
});

module.exports = {
  getProducts,
  getProduct,
  getRelatedProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};
