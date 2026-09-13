const Cart = require("../models/Cart");
const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });

  if (!cart) {
    cart = await Cart.create({
      user: userId,
      items: [],
    });
  }

  return cart;
};

const getVariant = (product, variantId) => {
  if (!variantId) {
    return null;
  }

  return product.variants?.id(variantId) || null;
};

const getAvailableStock = (product, variantId) => {
  if (variantId) {
    const variant = getVariant(product, variantId);

    if (!variant) {
      throw new ApiError(400, "Selected variant not found");
    }

    return variant.stock;
  }

  if (product.variants && product.variants.length > 0) {
    throw new ApiError(400, "Please select a product variant");
  }

  return product.stock;
};

const populateCart = async (cart) => {
  await cart.populate({
    path: "items.product",
    select: "name price discountPercentage images stock variants isActive",
  });

  return cart;
};

const getVariantResponse = (product, variantId) => {
  if (!variantId || !product?.variants) {
    return null;
  }

  const variant = product.variants.id(variantId);

  if (!variant) {
    return null;
  }

  return {
    _id: variant._id,
    size: variant.size,
    color: variant.color,
    sku: variant.sku,
    stock: variant.stock,
  };
};

const buildCartResponse = (cart) => {
  const data = cart.toObject();

  data.items = data.items.map((item) => {
    const product = item.product;

    if (product && item.variant) {
      const variant = product.variants?.find(
        (v) => v._id.toString() === item.variant.toString(),
      );

      return {
        ...item,
        variant: variant
          ? {
              _id: variant._id,
              size: variant.size,
              color: variant.color,
              sku: variant.sku,
              stock: variant.stock,
            }
          : item.variant,
      };
    }

    return item;
  });

  return data;
};

// @desc    Get current user's cart
// @route   GET /api/cart
// @access  Private
const getCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);

  await populateCart(cart);

  res.status(200).json({
    success: true,
    data: buildCartResponse(cart),
  });
});

// @desc    Add an item to the cart
// @route   POST /api/cart/items
// @access  Private
const addItem = asyncHandler(async (req, res) => {
  const { productId, variantId, quantity = 1 } = req.body;

  if (!productId) {
    throw new ApiError(400, "productId is required");
  }

  const parsedQuantity = Number(quantity);

  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
    throw new ApiError(400, "Quantity must be at least 1");
  }

  const product = await Product.findById(productId);

  if (!product || !product.isActive) {
    throw new ApiError(404, "Product not found");
  }

  const availableStock = getAvailableStock(product, variantId);

  if (availableStock < parsedQuantity) {
    throw new ApiError(
      400,
      `Only ${availableStock} unit(s) of "${product.name}" are in stock`,
    );
  }

  const cart = await getOrCreateCart(req.user._id);

  const existingItem = cart.items.find((item) => {
    const sameProduct = item.product.toString() === productId;

    const existingVariantId = item.variant ? item.variant.toString() : null;

    const selectedVariantId = variantId ? variantId.toString() : null;

    return sameProduct && existingVariantId === selectedVariantId;
  });

  if (existingItem) {
    const newQuantity = existingItem.quantity + parsedQuantity;

    if (newQuantity > availableStock) {
      throw new ApiError(
        400,
        `Only ${availableStock} unit(s) of "${product.name}" are in stock`,
      );
    }

    existingItem.quantity = newQuantity;
  } else {
    cart.items.push({
      product: productId,
      variant: variantId || undefined,
      quantity: parsedQuantity,
    });
  }

  await cart.save();

  await populateCart(cart);

  res.status(200).json({
    success: true,
    data: buildCartResponse(cart),
  });
});

// @desc    Update quantity of an item already in the cart
// @route   PUT /api/cart/items/:itemId
// @access  Private
const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;

  const parsedQuantity = Number(quantity);

  if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
    throw new ApiError(400, "Quantity must be at least 1");
  }

  const cart = await getOrCreateCart(req.user._id);

  const item = cart.items.id(req.params.itemId);

  if (!item) {
    throw new ApiError(404, "Cart item not found");
  }

  const product = await Product.findById(item.product);

  if (!product) {
    throw new ApiError(404, "Product for this cart item no longer exists");
  }

  const variantId = item.variant ? item.variant.toString() : null;

  const availableStock = getAvailableStock(product, variantId);

  if (availableStock < parsedQuantity) {
    throw new ApiError(
      400,
      `Only ${availableStock} unit(s) of "${product.name}" are in stock`,
    );
  }

  item.quantity = parsedQuantity;

  await cart.save();

  await populateCart(cart);

  res.status(200).json({
    success: true,
    data: buildCartResponse(cart),
  });
});

// @desc    Remove one item from the cart
// @route   DELETE /api/cart/items/:itemId
// @access  Private
const removeItem = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);

  const item = cart.items.id(req.params.itemId);

  if (!item) {
    throw new ApiError(404, "Cart item not found");
  }

  item.deleteOne();

  await cart.save();

  await populateCart(cart);

  res.status(200).json({
    success: true,
    data: buildCartResponse(cart),
  });
});

// @desc    Clear the entire cart
// @route   DELETE /api/cart
// @access  Private
const clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user._id);

  cart.items = [];

  await cart.save();

  res.status(200).json({
    success: true,
    data: cart,
  });
});

module.exports = {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  getOrCreateCart,
};
