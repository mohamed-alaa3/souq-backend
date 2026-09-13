const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");

// Kept as a local constant for now - Feature 12 (Low Stock Alerts) will make
// this configurable. Matches the threshold already used elsewhere in the
// admin/seller dashboards.
const LOW_STOCK_THRESHOLD = 5;

const SALES_OVER_TIME_DAYS = 30;

const startOfDaysAgo = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  date.setHours(0, 0, 0, 0);
  return date;
};

// ==================== SELLER ====================

// @desc    Analytics for the authenticated seller only
// @route   GET /api/analytics/seller
// @access  Private/Seller
const getSellerAnalytics = asyncHandler(async (req, res) => {
  // The seller is taken from the authenticated JWT user - never from the
  // request body/query - so a seller can only ever see their own data.
  const sellerId = req.user._id;

  const sellerProducts = await Product.find({ seller: sellerId }).select(
    "name stock isActive images",
  );

  const sellerProductIds = sellerProducts.map((p) => p._id);

  const totalProducts = sellerProducts.length;
  const activeProducts = sellerProducts.filter((p) => p.isActive).length;
  const inactiveProducts = totalProducts - activeProducts;

  const lowStockProducts = sellerProducts
    .filter((p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD)
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 5);

  const outOfStockProducts = sellerProducts.filter((p) => p.stock === 0);

  // Nothing to aggregate yet if this seller has no products.
  if (sellerProductIds.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        totalProducts: 0,
        activeProducts: 0,
        inactiveProducts: 0,
        totalOrders: 0,
        totalUnitsSold: 0,
        revenue: 0,
        salesOverTime: [],
        bestSellingProducts: [],
        lowStockProducts: [],
        outOfStockProducts: [],
        recentOrders: [],
        categoryPerformance: [],
      },
    });
  }

  // Any order (regardless of status) that contains at least one of this
  // seller's products.
  const totalOrders = await Order.countDocuments({
    "items.product": { $in: sellerProductIds },
  });

  // Revenue/units are calculated from the historical price snapshot stored
  // on each order item (never the product's current price), and exclude
  // cancelled orders so cancelled sales are never counted as completed
  // revenue.
  const fulfilledMatch = {
    "items.product": { $in: sellerProductIds },
    status: { $ne: "cancelled" },
  };

  const [totalsAgg] = await Order.aggregate([
    { $match: fulfilledMatch },
    { $unwind: "$items" },
    { $match: { "items.product": { $in: sellerProductIds } } },
    {
      $group: {
        _id: null,
        totalUnitsSold: { $sum: "$items.quantity" },
        revenue: {
          $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] },
        },
      },
    },
  ]);

  const totalUnitsSold = totalsAgg?.totalUnitsSold || 0;
  const revenue = totalsAgg?.revenue || 0;

  const since = startOfDaysAgo(SALES_OVER_TIME_DAYS);

  const salesOverTimeAgg = await Order.aggregate([
    { $match: { ...fulfilledMatch, createdAt: { $gte: since } } },
    { $unwind: "$items" },
    { $match: { "items.product": { $in: sellerProductIds } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        revenue: {
          $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] },
        },
        unitsSold: { $sum: "$items.quantity" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const salesOverTime = salesOverTimeAgg.map((entry) => ({
    date: entry._id,
    revenue: entry.revenue,
    unitsSold: entry.unitsSold,
  }));

  const bestSellingAgg = await Order.aggregate([
    { $match: fulfilledMatch },
    { $unwind: "$items" },
    { $match: { "items.product": { $in: sellerProductIds } } },
    {
      $group: {
        _id: "$items.product",
        name: { $first: "$items.name" },
        unitsSold: { $sum: "$items.quantity" },
        revenue: {
          $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] },
        },
      },
    },
    { $sort: { unitsSold: -1 } },
    { $limit: 5 },
  ]);

  const bestSellingProducts = bestSellingAgg.map((p) => ({
    productId: p._id,
    name: p.name,
    unitsSold: p.unitsSold,
    revenue: p.revenue,
  }));

  const categoryAgg = await Order.aggregate([
    { $match: fulfilledMatch },
    { $unwind: "$items" },
    { $match: { "items.product": { $in: sellerProductIds } } },
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        as: "productDoc",
      },
    },
    { $unwind: "$productDoc" },
    {
      $group: {
        _id: "$productDoc.category",
        revenue: {
          $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] },
        },
        unitsSold: { $sum: "$items.quantity" },
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "categoryDoc",
      },
    },
    { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
    { $sort: { revenue: -1 } },
  ]);

  const categoryPerformance = categoryAgg.map((entry) => ({
    category: entry.categoryDoc?.name || "Uncategorized",
    revenue: entry.revenue,
    unitsSold: entry.unitsSold,
  }));

  // Recent orders touching this seller - only their own line items and
  // their share of the total are exposed, never the full order or other
  // sellers' items within it.
  const sellerProductIdSet = new Set(
    sellerProductIds.map((id) => id.toString()),
  );

  const recentOrderDocs = await Order.find({
    "items.product": { $in: sellerProductIds },
  })
    .populate("user", "name")
    .sort("-createdAt")
    .limit(5);

  const recentOrders = recentOrderDocs.map((order) => {
    const sellerItems = order.items.filter((item) =>
      sellerProductIdSet.has(item.product.toString()),
    );

    const sellerTotal = sellerItems.reduce(
      (sum, item) => sum + item.finalPrice * item.quantity,
      0,
    );

    return {
      _id: order._id,
      user: order.user,
      items: sellerItems,
      sellerTotal,
      status: order.status,
      createdAt: order.createdAt,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      totalProducts,
      activeProducts,
      inactiveProducts,
      totalOrders,
      totalUnitsSold,
      revenue,
      salesOverTime,
      bestSellingProducts,
      lowStockProducts,
      outOfStockProducts,
      recentOrders,
      categoryPerformance,
    },
  });
});

// ==================== ADMIN ====================

// @desc    Platform-wide analytics
// @route   GET /api/analytics/admin
// @access  Private/Admin
const getAdminAnalytics = asyncHandler(async (req, res) => {
  const [totalUsers, totalCustomers, totalSellers, totalProducts, activeProducts] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "customer" }),
      User.countDocuments({ role: "seller" }),
      Product.countDocuments(),
      Product.countDocuments({ isActive: true }),
    ]);

  const totalOrders = await Order.countDocuments();

  const statusCountsAgg = await Order.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const ordersByStatus = {
    pending: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };

  statusCountsAgg.forEach((entry) => {
    if (entry._id in ordersByStatus) {
      ordersByStatus[entry._id] = entry.count;
    }
  });

  const fulfilledMatch = { status: { $ne: "cancelled" } };

  const [revenueAgg] = await Order.aggregate([
    { $match: fulfilledMatch },
    { $group: { _id: null, totalRevenue: { $sum: "$totalPrice" } } },
  ]);

  const totalRevenue = revenueAgg?.totalRevenue || 0;

  const since = startOfDaysAgo(SALES_OVER_TIME_DAYS);

  const salesOverTimeAgg = await Order.aggregate([
    { $match: { ...fulfilledMatch, createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
        revenue: { $sum: "$totalPrice" },
        orders: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const salesOverTime = salesOverTimeAgg.map((entry) => ({
    date: entry._id,
    revenue: entry.revenue,
    orders: entry.orders,
  }));

  const topSellingAgg = await Order.aggregate([
    { $match: fulfilledMatch },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product",
        name: { $first: "$items.name" },
        unitsSold: { $sum: "$items.quantity" },
        revenue: {
          $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] },
        },
      },
    },
    { $sort: { unitsSold: -1 } },
    { $limit: 5 },
  ]);

  const topSellingProducts = topSellingAgg.map((p) => ({
    productId: p._id,
    name: p.name,
    unitsSold: p.unitsSold,
    revenue: p.revenue,
  }));

  const topCategoriesAgg = await Order.aggregate([
    { $match: fulfilledMatch },
    { $unwind: "$items" },
    {
      $lookup: {
        from: "products",
        localField: "items.product",
        foreignField: "_id",
        as: "productDoc",
      },
    },
    { $unwind: "$productDoc" },
    {
      $group: {
        _id: "$productDoc.category",
        revenue: {
          $sum: { $multiply: ["$items.finalPrice", "$items.quantity"] },
        },
        unitsSold: { $sum: "$items.quantity" },
      },
    },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "categoryDoc",
      },
    },
    { $unwind: { path: "$categoryDoc", preserveNullAndEmptyArrays: true } },
    { $sort: { revenue: -1 } },
    { $limit: 5 },
  ]);

  const topCategories = topCategoriesAgg.map((entry) => ({
    category: entry.categoryDoc?.name || "Uncategorized",
    revenue: entry.revenue,
    unitsSold: entry.unitsSold,
  }));

  const recentOrders = await Order.find()
    .populate("user", "name")
    .sort("-createdAt")
    .limit(5);

  const lowStockProducts = await Product.find({
    stock: { $gt: 0, $lte: LOW_STOCK_THRESHOLD },
  })
    .select("name stock seller")
    .populate("seller", "name")
    .sort("stock")
    .limit(10);

  res.status(200).json({
    success: true,
    data: {
      totalUsers,
      totalCustomers,
      totalSellers,
      totalProducts,
      activeProducts,
      totalOrders,
      totalRevenue,
      ordersByStatus,
      salesOverTime,
      topSellingProducts,
      topCategories,
      recentOrders,
      lowStockProducts,
    },
  });
});

module.exports = {
  getSellerAnalytics,
  getAdminAnalytics,
};
