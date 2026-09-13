process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Product');
jest.mock('../models/Order');
jest.mock('../models/User');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');

const analyticsRoutes = require('../routes/analyticsRoutes');
const notFound = require('../middlewares/notFound');
const errorHandler = require('../middlewares/errorHandler');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

const users = {
  seller1: { _id: 'seller1', role: 'seller' },
  seller2: { _id: 'seller2', role: 'seller' },
  customer1: { _id: 'customer1', role: 'customer' },
  admin1: { _id: 'admin1', role: 'admin' },
};

const emptyOrderFindChain = () => ({
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue([]),
});

const emptyProductFindChain = () => ({
  select: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockResolvedValue([]),
});

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockImplementation((id) => Promise.resolve(users[id]));
  Order.countDocuments.mockResolvedValue(0);
  Order.aggregate.mockResolvedValue([]);
  Order.find.mockReturnValue(emptyOrderFindChain());
});

describe('GET /api/analytics/seller', () => {
  test('unauthenticated request is rejected (401)', async () => {
    const res = await request(buildApp()).get('/api/analytics/seller');
    expect(res.status).toBe(401);
  });

  test('a customer cannot access seller analytics (403)', async () => {
    const res = await request(buildApp())
      .get('/api/analytics/seller')
      .set('Authorization', `Bearer ${signToken('customer1')}`);

    expect(res.status).toBe(403);
  });

  test('an admin cannot use the seller analytics endpoint (403) - admins use /admin instead', async () => {
    const res = await request(buildApp())
      .get('/api/analytics/seller')
      .set('Authorization', `Bearer ${signToken('admin1')}`);

    expect(res.status).toBe(403);
  });

  test('a seller only ever gets their own product ids queried, never another seller\'s (isolation)', async () => {
    Product.find.mockImplementation((query) => ({
      select: jest.fn().mockResolvedValue(
        query.seller === 'seller1'
          ? [{ _id: 'p1', name: 'Seller1 Shirt', stock: 10, isActive: true }]
          : [{ _id: 'p99', name: 'Seller2 Shirt', stock: 10, isActive: true }],
      ),
    }));

    const res1 = await request(buildApp())
      .get('/api/analytics/seller')
      .set('Authorization', `Bearer ${signToken('seller1')}`);

    expect(res1.status).toBe(200);
    expect(res1.body.data.totalProducts).toBe(1);
    // The product-id filter passed to Order queries must be seller1's ids only.
    expect(Order.countDocuments).toHaveBeenCalledWith({
      'items.product': { $in: ['p1'] },
    });

    jest.clearAllMocks();
    User.findById.mockImplementation((id) => Promise.resolve(users[id]));
    Order.countDocuments.mockResolvedValue(0);
    Order.aggregate.mockResolvedValue([]);
    Order.find.mockReturnValue(emptyOrderFindChain());
    Product.find.mockImplementation((query) => ({
      select: jest.fn().mockResolvedValue(
        query.seller === 'seller1'
          ? [{ _id: 'p1', name: 'Seller1 Shirt', stock: 10, isActive: true }]
          : [{ _id: 'p99', name: 'Seller2 Shirt', stock: 10, isActive: true }],
      ),
    }));

    const res2 = await request(buildApp())
      .get('/api/analytics/seller')
      .set('Authorization', `Bearer ${signToken('seller2')}`);

    expect(res2.status).toBe(200);
    expect(Order.countDocuments).toHaveBeenCalledWith({
      'items.product': { $in: ['p99'] },
    });

    // seller2's response must never reference seller1's product id.
    expect(Order.countDocuments).not.toHaveBeenCalledWith({
      'items.product': { $in: ['p1'] },
    });
  });
});

describe('GET /api/analytics/admin', () => {
  beforeEach(() => {
    Product.find.mockReturnValue(emptyProductFindChain());
  });

  test('unauthenticated request is rejected (401)', async () => {
    const res = await request(buildApp()).get('/api/analytics/admin');
    expect(res.status).toBe(401);
  });

  test('a customer cannot access admin analytics (403)', async () => {
    const res = await request(buildApp())
      .get('/api/analytics/admin')
      .set('Authorization', `Bearer ${signToken('customer1')}`);

    expect(res.status).toBe(403);
  });

  test('a seller cannot access admin analytics (403)', async () => {
    const res = await request(buildApp())
      .get('/api/analytics/admin')
      .set('Authorization', `Bearer ${signToken('seller1')}`);

    expect(res.status).toBe(403);
  });

  test('an admin can access admin analytics (200)', async () => {
    User.countDocuments.mockResolvedValue(0);
    Product.countDocuments.mockResolvedValue(0);

    const res = await request(buildApp())
      .get('/api/analytics/admin')
      .set('Authorization', `Bearer ${signToken('admin1')}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
