process.env.JWT_SECRET = 'test_secret_key';

// Mock the DB-facing pieces so we can test the PRICING/STOCK LOGIC itself
// in isolation, without a live MongoDB connection.
jest.mock('../models/Product');
jest.mock('../models/Order');
jest.mock('../controllers/cartController', () => ({
  getOrCreateCart: jest.fn(),
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
const { createOrder } = require('../controllers/orderController');

// Fake session whose withTransaction just runs the callback directly.
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

test('createOrder computes total from DB price, ignoring any client-sent price', async () => {
  // Client tries to sneak in a price of 1 cent per item - must be ignored entirely.
  const cart = {
    items: [{ product: 'prod1', quantity: 2 }],
    save: jest.fn().mockResolvedValue(true),
  };
  getOrCreateCart.mockResolvedValue(cart);

  const dbProduct = {
    _id: 'prod1',
    name: 'Real Product',
    price: 100, // authoritative price
    discountPercentage: 0,
    stock: 10,
    isActive: true,
    save: jest.fn().mockResolvedValue(true),
  };
  Product.findById.mockReturnValue({ session: () => Promise.resolve(dbProduct) });

  const savedOrder = { _id: 'order1', totalPrice: 200 };
  Order.create.mockResolvedValue([savedOrder]);

  const req = {
    user: { _id: 'user1' },
    body: { shippingAddress: '123 Main St', price: 0.01 }, // malicious client field
  };
  const res = buildRes();

  await createOrder(req, res, (err) => { if (err) throw err; });

  expect(Order.create).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        totalPrice: 200, // 100 * 2, NOT client's 0.01
        items: [expect.objectContaining({ price: 100, quantity: 2, name: 'Real Product' })],
      }),
    ],
    expect.anything()
  );
  expect(dbProduct.stock).toBe(8); // stock decremented
  expect(cart.items).toEqual([]); // cart cleared
  expect(res.status).toHaveBeenCalledWith(201);
});

test('createOrder rejects when requested quantity exceeds stock', async () => {
  const cart = { items: [{ product: 'prod1', quantity: 5 }], save: jest.fn() };
  getOrCreateCart.mockResolvedValue(cart);

  const dbProduct = { _id: 'prod1', name: 'Low Stock Item', price: 50, stock: 2, isActive: true };
  Product.findById.mockReturnValue({ session: () => Promise.resolve(dbProduct) });

  const req = { user: { _id: 'user1' }, body: { shippingAddress: 'Addr' } };
  const res = buildRes();

  let caughtError;
  await createOrder(req, res, (err) => { caughtError = err; });

  expect(caughtError).toBeDefined();
  expect(caughtError.statusCode).toBe(400);
  expect(caughtError.message).toMatch(/in stock/i);
  expect(Order.create).not.toHaveBeenCalled();
});

test('createOrder rejects an empty cart with 400', async () => {
  getOrCreateCart.mockResolvedValue({ items: [] });

  const req = { user: { _id: 'user1' }, body: { shippingAddress: 'Addr' } };
  const res = buildRes();

  let caughtError;
  await createOrder(req, res, (err) => { caughtError = err; });

  expect(caughtError.statusCode).toBe(400);
  expect(caughtError.message).toMatch(/empty/i);
});
