process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Coupon');
jest.mock('../models/Order');
jest.mock('../models/User');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const User = require('../models/User');

const couponRoutes = require('../routes/couponRoutes');
const notFound = require('../middlewares/notFound');
const errorHandler = require('../middlewares/errorHandler');

// Build the app the same way server.js does for this router, so the full
// real pipeline (auth, role authorization, validation, error handling)
// runs exactly as it would in production.
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/coupons', couponRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

const customerUser = { _id: 'customer1', role: 'customer' };
const adminUser = { _id: 'admin1', role: 'admin' };

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockImplementation((id) =>
    Promise.resolve(id === 'admin1' ? adminUser : customerUser),
  );
});

describe('POST /api/coupons/validate (customer checkout flow)', () => {
  const activeCoupon = (overrides = {}) => ({
    code: 'SAVE20',
    discountType: 'percentage',
    discountValue: 20,
    minOrderAmount: 0,
    maxDiscount: null,
    usageLimit: null,
    usedCount: 0,
    perUserLimit: null,
    isActive: true,
    startDate: new Date(Date.now() - 86400000),
    expiryDate: new Date(Date.now() + 86400000),
    ...overrides,
  });

  test('valid coupon returns the correct discount and new total', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon());

    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'save20', cartTotal: 100 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      code: 'SAVE20',
      discountType: 'percentage',
      discountValue: 20,
      discountAmount: 20,
      newTotal: 80,
    });
  });

  test('invalid (unknown) coupon code returns 404', async () => {
    Coupon.findOne.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'DOESNOTEXIST', cartTotal: 100 });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('expired coupon returns 400 with a clear message', async () => {
    Coupon.findOne.mockResolvedValue(
      activeCoupon({ expiryDate: new Date(Date.now() - 1000) }),
    );

    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'SAVE20', cartTotal: 100 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  test('order below the minimum required amount returns 400', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ minOrderAmount: 200 }));

    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'SAVE20', cartTotal: 50 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minimum order/i);
  });

  test('maximum discount cap is respected even for a large percentage', async () => {
    Coupon.findOne.mockResolvedValue(
      activeCoupon({ discountValue: 90, maxDiscount: 15 }),
    );

    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'SAVE20', cartTotal: 100 });

    expect(res.status).toBe(200);
    expect(res.body.data.discountAmount).toBe(15);
    expect(res.body.data.newTotal).toBe(85);
  });

  test('a coupon at its global usage limit is rejected', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ usageLimit: 10, usedCount: 10 }));

    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'SAVE20', cartTotal: 100 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/usage limit/i);
  });

  test('a customer who already used their per-user allowance is rejected', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ perUserLimit: 1 }));
    Order.countDocuments.mockResolvedValue(1);

    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'SAVE20', cartTotal: 100 });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already used/i);
  });

  test('unauthenticated request is rejected with 401', async () => {
    const res = await request(buildApp())
      .post('/api/coupons/validate')
      .send({ code: 'SAVE20', cartTotal: 100 });

    expect(res.status).toBe(401);
  });
});

describe('Admin coupon management authorization + activate/deactivate', () => {
  test('a customer cannot list coupons (403)', async () => {
    const res = await request(buildApp())
      .get('/api/coupons')
      .set('Authorization', `Bearer ${signToken('customer1')}`);

    expect(res.status).toBe(403);
  });

  test('a customer cannot create a coupon (403)', async () => {
    const res = await request(buildApp())
      .post('/api/coupons')
      .set('Authorization', `Bearer ${signToken('customer1')}`)
      .send({ code: 'HACK', discountType: 'fixed', discountValue: 100 });

    expect(res.status).toBe(403);
    expect(Coupon.create).not.toHaveBeenCalled();
  });

  test('an admin can list coupons', async () => {
    Coupon.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([{ code: 'SAVE20' }]) });

    const res = await request(buildApp())
      .get('/api/coupons')
      .set('Authorization', `Bearer ${signToken('admin1')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ code: 'SAVE20' }]);
  });

  test('an admin can deactivate an active coupon via the toggle endpoint', async () => {
    const coupon = { isActive: true, save: jest.fn().mockResolvedValue(true) };
    Coupon.findById.mockResolvedValue(coupon);

    const res = await request(buildApp())
      .patch('/api/coupons/c1/toggle')
      .set('Authorization', `Bearer ${signToken('admin1')}`);

    expect(res.status).toBe(200);
    expect(coupon.isActive).toBe(false);
    expect(coupon.save).toHaveBeenCalled();
  });

  test('a customer cannot use the admin toggle endpoint (403)', async () => {
    const res = await request(buildApp())
      .patch('/api/coupons/c1/toggle')
      .set('Authorization', `Bearer ${signToken('customer1')}`);

    expect(res.status).toBe(403);
    expect(Coupon.findById).not.toHaveBeenCalled();
  });

  test('an admin can delete a coupon', async () => {
    const coupon = { deleteOne: jest.fn().mockResolvedValue(true) };
    Coupon.findById.mockResolvedValue(coupon);

    const res = await request(buildApp())
      .delete('/api/coupons/c1')
      .set('Authorization', `Bearer ${signToken('admin1')}`);

    expect(res.status).toBe(200);
    expect(coupon.deleteOne).toHaveBeenCalled();
  });
});
