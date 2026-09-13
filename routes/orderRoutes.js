
const express = require('express');

const {
  createOrder,
  getMyOrders,
  getOrder,
  getAllOrders,
  updateOrderStatus,
  getSellerOrders,
  cancelOrder,
} = require("../controllers/orderController");

const protect = require('../middlewares/protect');
const authorize = require('../middlewares/authorize');

const router = express.Router();

// All order routes require authentication.
router.use(protect);

// Customer
router.post('/', createOrder);
router.get('/me', getMyOrders);
// Seller
router.get('/seller/me', authorize('seller'), getSellerOrders);

// Admin
router.get('/', authorize('admin'), getAllOrders);
router.patch('/:id/status', authorize('admin'), updateOrderStatus);

// Customer / Seller
router.patch('/:id/cancel', cancelOrder);

// Customer / Admin
router.get('/:id', getOrder);

module.exports = router;

