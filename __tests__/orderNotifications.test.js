process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Product');
jest.mock('../models/Order');
jest.mock('../controllers/cartController', () => ({
  getOrCreateCart: jest.fn(),
}));
jest.mock('../controllers/couponController', () => ({
  calculateCouponForOrder: jest.fn(),
}));
jest.mock('../utils/notificationService', () => ({
  createNotification: jest.fn().mockResolvedValue(true),
  createNotifications: jest.fn().mockResolvedValue([]),
}));
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return { ...actual, startSession: jest.fn() };
});

const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { getOrCreateCart } = require('../controllers/cartController');
const {
  createNotification,
  createNotifications,
} = require('../utils/notificationService');
const { createOrder, updateOrderStatus } = require('../controllers/orderController');

const fakeSession = { withTransaction: async (fn) => fn(), endSession: jest.fn() };

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

test('creating an order notifies the customer and every unique seller involved', async () => {
  const cart = {
    items: [
      { product: 'prodA', quantity: 1 },
      { product: 'prodB', quantity: 1 },
    ],
    save: jest.fn().mockResolvedValue(true),
  };
  getOrCreateCart.mockResolvedValue(cart);

  const makeProduct = (id, sellerId) => ({
    _id: id,
    name: 'Item',
    price: 50,
    discountPercentage: 0,
    stock: 10,
    isActive: true,
    seller: sellerId,
    variants: [],
    save: jest.fn().mockResolvedValue(true),
  });

  Product.findById.mockImplementation((id) => ({
    session: () =>
      Promise.resolve(
        id === 'prodA' ? makeProduct('prodA', 'sellerX') : makeProduct('prodB', 'sellerX'),
      ),
  }));

  Order.create.mockResolvedValue([{ _id: 'order1' }]);

  const req = { user: { _id: 'customer1' }, body: { shippingAddress: 'Addr' } };
  const res = buildRes();

  await createOrder(req, res, (err) => { if (err) throw err; });

  expect(createNotification).toHaveBeenCalledWith(
    expect.objectContaining({
      user: 'customer1',
      type: 'order_created',
      relatedOrder: 'order1',
    }),
  );

  // Both items belong to the same seller - only one notification should
  // be sent to that seller, not two.
  expect(createNotifications).toHaveBeenCalledWith([
    expect.objectContaining({ user: 'sellerX', type: 'order_created', relatedOrder: 'order1' }),
  ]);
});

test('a notification failure never prevents the order from being created', async () => {
  const cart = { items: [{ product: 'prodA', quantity: 1 }], save: jest.fn().mockResolvedValue(true) };
  getOrCreateCart.mockResolvedValue(cart);

  Product.findById.mockReturnValue({
    session: () =>
      Promise.resolve({
        _id: 'prodA',
        name: 'Item',
        price: 20,
        discountPercentage: 0,
        stock: 5,
        isActive: true,
        seller: 'sellerX',
        variants: [],
        save: jest.fn().mockResolvedValue(true),
      }),
  });

  Order.create.mockResolvedValue([{ _id: 'order2' }]);
  createNotification.mockRejectedValueOnce(new Error('notification service down'));

  const req = { user: { _id: 'customer1' }, body: { shippingAddress: 'Addr' } };
  const res = buildRes();

  await createOrder(req, res, (err) => { if (err) throw err; });

  expect(res.status).toHaveBeenCalledWith(201);
});

describe('updateOrderStatus notifications', () => {
  const buildOrderDoc = (initialStatus) => {
    const order = {
      _id: 'order1',
      user: 'customer1',
      status: initialStatus,
      items: [],
      save: jest.fn(function save() { return Promise.resolve(this); }),
    };
    return order;
  };

  const runStatusChange = async (fromStatus, toStatus) => {
    const order = buildOrderDoc(fromStatus);

    Order.findById.mockReturnValue({ session: () => Promise.resolve(order) });

    const req = {
      user: { _id: 'seller1', role: 'admin' },
      params: { id: 'order1' },
      body: { status: toStatus },
    };
    const res = buildRes();

    await updateOrderStatus(req, res, (err) => { if (err) throw err; });

    return order;
  };

  test('processing sends the "order is being processed" notification', async () => {
    await runStatusChange('pending', 'processing');
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'customer1', type: 'order_processing', relatedOrder: 'order1' }),
    );
  });

  test('shipped sends the "order shipped" notification', async () => {
    await runStatusChange('processing', 'shipped');
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'customer1', type: 'order_shipped', relatedOrder: 'order1' }),
    );
  });

  test('delivered sends the "order delivered" notification', async () => {
    await runStatusChange('shipped', 'delivered');
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'customer1', type: 'order_delivered', relatedOrder: 'order1' }),
    );
  });

  test('cancelled sends the "order cancelled" notification', async () => {
    await runStatusChange('pending', 'cancelled');
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'customer1', type: 'order_cancelled', relatedOrder: 'order1' }),
    );
  });

  test('re-saving the same status does not send a duplicate notification', async () => {
    await runStatusChange('processing', 'processing');
    expect(createNotification).not.toHaveBeenCalled();
  });
});
