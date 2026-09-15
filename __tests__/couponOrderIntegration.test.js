process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Product');
jest.mock('../models/Order');
jest.mock('../controllers/cartController', () => ({
  getOrCreateCart: jest.fn(),
}));
jest.mock('../controllers/couponController', () => ({
  calculateCouponForOrder: jest.fn(),
}));
// createOrder's post-creation notification step (customer, sellers, and
// every admin) is best-effort and orthogonal to the coupon/order
// integration behaviour this file tests - mock it so those unrelated
// notification/User-lookup calls never fall through to a real,
// unconnected Mongoose model.
jest.mock('../utils/notificationService', () => ({
  createNotification: jest.fn().mockResolvedValue(true),
  createNotifications: jest.fn().mockResolvedValue([]),
}));
jest.mock('../models/User', () => ({
  find: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    }),
  }),
}));
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    startSession: jest.fn(),
  };
});

const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { getOrCreateCart } = require('../controllers/cartController');
const { calculateCouponForOrder } = require('../controllers/couponController');
const { createOrder } = require('../controllers/orderController');

const fakeSession = {
  withTransaction: async (fn) => fn(),
  endSession: jest.fn(),
};

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  mongoose.startSession.mockResolvedValue(fakeSession);
});

test('createOrder applies a valid coupon discount to the recalculated subtotal and records usage', async () => {
  const cart = {
    items: [{ product: 'prod1', quantity: 2 }],
    save: jest.fn().mockResolvedValue(true),
  };
  getOrCreateCart.mockResolvedValue(cart);

  const dbProduct = {
    _id: 'prod1',
    name: 'Real Product',
    price: 100,
    discountPercentage: 0,
    stock: 10,
    isActive: true,
    save: jest.fn().mockResolvedValue(true),
  };
  Product.findById.mockReturnValue({ session: () => Promise.resolve(dbProduct) });

  const couponDoc = { code: 'SAVE20', discountType: 'percentage', discountValue: 20, usedCount: 3, save: jest.fn().mockResolvedValue(true) };
  calculateCouponForOrder.mockResolvedValue({ coupon: couponDoc, discountAmount: 40 });

  const savedOrder = { _id: 'order1', totalPrice: 160 };
  Order.create.mockResolvedValue([savedOrder]);

  const req = {
    user: { _id: 'user1' },
    body: { shippingAddress: '123 Main St', couponCode: 'save20' },
  };
  const res = buildRes();

  await createOrder(req, res, (err) => { if (err) throw err; });

  // Subtotal (200) minus the server-calculated discount (40) = 160,
  // never a client-sent figure.
  expect(Order.create).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        subtotal: 200,
        totalPrice: 160,
        coupon: {
          code: 'SAVE20',
          discountType: 'percentage',
          discountValue: 20,
          discountAmount: 40,
        },
      }),
    ],
    expect.anything(),
  );

  // Usage count incremented and persisted within the same transaction.
  expect(couponDoc.usedCount).toBe(4);
  expect(couponDoc.save).toHaveBeenCalledWith({ session: fakeSession });
  expect(res.status).toHaveBeenCalledWith(201);
});

test('createOrder without a couponCode never touches coupon logic', async () => {
  const cart = {
    items: [{ product: 'prod1', quantity: 1 }],
    save: jest.fn().mockResolvedValue(true),
  };
  getOrCreateCart.mockResolvedValue(cart);

  const dbProduct = {
    _id: 'prod1',
    name: 'Real Product',
    price: 50,
    discountPercentage: 0,
    stock: 5,
    isActive: true,
    save: jest.fn().mockResolvedValue(true),
  };
  Product.findById.mockReturnValue({ session: () => Promise.resolve(dbProduct) });

  Order.create.mockResolvedValue([{ _id: 'order2', totalPrice: 50 }]);

  const req = { user: { _id: 'user1' }, body: { shippingAddress: 'Addr' } };
  const res = buildRes();

  await createOrder(req, res, (err) => { if (err) throw err; });

  expect(calculateCouponForOrder).not.toHaveBeenCalled();
  expect(Order.create).toHaveBeenCalledWith(
    [expect.objectContaining({ subtotal: 50, totalPrice: 50, coupon: undefined })],
    expect.anything(),
  );
});

test('createOrder propagates a coupon rejection (e.g. expired) and creates no order', async () => {
  const cart = {
    items: [{ product: 'prod1', quantity: 1 }],
    save: jest.fn(),
  };
  getOrCreateCart.mockResolvedValue(cart);

  const dbProduct = {
    _id: 'prod1',
    name: 'Real Product',
    price: 50,
    discountPercentage: 0,
    stock: 5,
    isActive: true,
    save: jest.fn().mockResolvedValue(true),
  };
  Product.findById.mockReturnValue({ session: () => Promise.resolve(dbProduct) });

  const ApiError = require('../utils/ApiError');
  calculateCouponForOrder.mockRejectedValue(new ApiError(400, 'This coupon has expired'));

  const req = { user: { _id: 'user1' }, body: { shippingAddress: 'Addr', couponCode: 'OLD10' } };
  const res = buildRes();

  let caughtError;
  await createOrder(req, res, (err) => { caughtError = err; });

  expect(caughtError.statusCode).toBe(400);
  expect(Order.create).not.toHaveBeenCalled();
});
