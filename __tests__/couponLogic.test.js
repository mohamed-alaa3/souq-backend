process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Coupon');
jest.mock('../models/Order');

const Coupon = require('../models/Coupon');
const Order = require('../models/Order');
const {
  createCoupon,
  updateCoupon,
  toggleCouponActive,
  deleteCoupon,
  validateCoupon,
  calculateCouponForOrder,
} = require('../controllers/couponController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createCoupon validation', () => {
  test('rejects a percentage discount over 100', async () => {
    const req = {
      body: {
        code: 'BIG50',
        discountType: 'percentage',
        discountValue: 150,
        startDate: '2026-01-01',
        expiryDate: '2026-02-01',
      },
    };
    const res = buildRes();

    let caughtError;
    await createCoupon(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(400);
    expect(Coupon.create).not.toHaveBeenCalled();
  });

  test('rejects expiryDate before startDate', async () => {
    const req = {
      body: {
        code: 'EARLY',
        discountType: 'fixed',
        discountValue: 10,
        startDate: '2026-05-01',
        expiryDate: '2026-01-01',
      },
    };
    const res = buildRes();

    let caughtError;
    await createCoupon(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(400);
  });

  test('rejects a duplicate coupon code', async () => {
    Coupon.findOne.mockResolvedValue({ _id: 'existing', code: 'SAVE10' });

    const req = {
      body: {
        code: 'save10',
        discountType: 'fixed',
        discountValue: 10,
        startDate: '2026-01-01',
        expiryDate: '2026-02-01',
      },
    };
    const res = buildRes();

    let caughtError;
    await createCoupon(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(400);
    expect(Coupon.create).not.toHaveBeenCalled();
  });

  test('creates a valid coupon and uppercases the code', async () => {
    Coupon.findOne.mockResolvedValue(null);
    Coupon.create.mockResolvedValue({ code: 'SAVE10' });

    const req = {
      body: {
        code: 'save10',
        discountType: 'fixed',
        discountValue: 10,
        startDate: '2026-01-01',
        expiryDate: '2026-02-01',
      },
    };
    const res = buildRes();

    await createCoupon(req, res, (err) => { if (err) throw err; });

    expect(Coupon.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SAVE10' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateCoupon', () => {
  test('rejects turning a valid coupon into an invalid one', async () => {
    const existingCoupon = {
      toObject: () => ({
        code: 'SAVE10',
        discountType: 'fixed',
        discountValue: 10,
        startDate: new Date('2026-01-01'),
        expiryDate: new Date('2026-02-01'),
        minOrderAmount: 0,
      }),
      save: jest.fn(),
    };
    Coupon.findById.mockResolvedValue(existingCoupon);

    const req = { params: { id: 'c1' }, body: { discountType: 'percentage', discountValue: 999 } };
    const res = buildRes();

    let caughtError;
    await updateCoupon(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(400);
    expect(existingCoupon.save).not.toHaveBeenCalled();
  });
});

describe('toggleCouponActive (admin activate/deactivate)', () => {
  test('flips an active coupon to inactive', async () => {
    const coupon = { isActive: true, save: jest.fn().mockResolvedValue(true) };
    Coupon.findById.mockResolvedValue(coupon);

    const req = { params: { id: 'c1' } };
    const res = buildRes();

    await toggleCouponActive(req, res, (err) => { if (err) throw err; });

    expect(coupon.isActive).toBe(false);
    expect(coupon.save).toHaveBeenCalled();
  });

  test('flips an inactive coupon back to active', async () => {
    const coupon = { isActive: false, save: jest.fn().mockResolvedValue(true) };
    Coupon.findById.mockResolvedValue(coupon);

    const req = { params: { id: 'c1' } };
    const res = buildRes();

    await toggleCouponActive(req, res, (err) => { if (err) throw err; });

    expect(coupon.isActive).toBe(true);
  });

  test('404s when the coupon does not exist', async () => {
    Coupon.findById.mockResolvedValue(null);

    const req = { params: { id: 'missing' } };
    const res = buildRes();

    let caughtError;
    await toggleCouponActive(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(404);
  });
});

describe('deleteCoupon', () => {
  test('deletes an existing coupon', async () => {
    const coupon = { deleteOne: jest.fn().mockResolvedValue(true) };
    Coupon.findById.mockResolvedValue(coupon);

    const req = { params: { id: 'c1' } };
    const res = buildRes();

    await deleteCoupon(req, res, (err) => { if (err) throw err; });

    expect(coupon.deleteOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('calculateCouponForOrder (shared checkout/order logic)', () => {
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

  test('rejects an unknown coupon code', async () => {
    Coupon.findOne.mockResolvedValue(null);
    await expect(calculateCouponForOrder('NOPE', 100, 'user1')).rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects a deactivated coupon', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ isActive: false }));
    await expect(calculateCouponForOrder('SAVE20', 100, 'user1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an expired coupon', async () => {
    Coupon.findOne.mockResolvedValue(
      activeCoupon({ expiryDate: new Date(Date.now() - 1000) }),
    );
    await expect(calculateCouponForOrder('SAVE20', 100, 'user1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an order below minOrderAmount', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ minOrderAmount: 200 }));
    await expect(calculateCouponForOrder('SAVE20', 100, 'user1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects once the global usage limit is reached', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ usageLimit: 5, usedCount: 5 }));
    await expect(calculateCouponForOrder('SAVE20', 100, 'user1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects once a user has hit their per-user usage limit', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ perUserLimit: 1 }));
    Order.countDocuments.mockResolvedValue(1);

    await expect(calculateCouponForOrder('SAVE20', 100, 'user1')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('calculates a percentage discount correctly', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon());
    const result = await calculateCouponForOrder('SAVE20', 100, 'user1');
    expect(result.discountAmount).toBe(20);
  });

  test('caps a percentage discount at maxDiscount', async () => {
    Coupon.findOne.mockResolvedValue(activeCoupon({ discountValue: 50, maxDiscount: 10 }));
    const result = await calculateCouponForOrder('SAVE20', 100, 'user1');
    expect(result.discountAmount).toBe(10);
  });

  test('never discounts more than the order subtotal (fixed coupon larger than order)', async () => {
    Coupon.findOne.mockResolvedValue(
      activeCoupon({ discountType: 'fixed', discountValue: 500 }),
    );
    const result = await calculateCouponForOrder('SAVE20', 30, 'user1');
    expect(result.discountAmount).toBe(30);
  });
});

describe('validateCoupon endpoint', () => {
  test('returns the computed discount and new total for a valid coupon', async () => {
    Coupon.findOne.mockResolvedValue({
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
    });

    const req = { user: { _id: 'user1' }, body: { code: 'save20', cartTotal: 100 } };
    const res = buildRes();

    await validateCoupon(req, res, (err) => { if (err) throw err; });

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        code: 'SAVE20',
        discountType: 'percentage',
        discountValue: 20,
        discountAmount: 20,
        newTotal: 80,
      },
    });
  });
});
