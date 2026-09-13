process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Product');
jest.mock('../models/Order');
jest.mock('../models/User');

const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const {
  getSellerAnalytics,
  getAdminAnalytics,
} = require('../controllers/analyticsController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getSellerAnalytics', () => {
  const sellerProducts = [
    { _id: 'p1', name: 'Shirt', stock: 3, isActive: true },
    { _id: 'p2', name: 'Jacket', stock: 0, isActive: true },
    { _id: 'p3', name: 'Hat', stock: 50, isActive: false },
  ];

  const mockProductFind = (products) => {
    Product.find.mockReturnValue({ select: jest.fn().mockResolvedValue(products) });
  };

  test('returns an empty analytics shape when the seller has no products (no DB scan needed)', async () => {
    mockProductFind([]);

    const req = { user: { _id: 'seller1' } };
    const res = buildRes();

    await getSellerAnalytics(req, res, (err) => { if (err) throw err; });

    expect(Order.countDocuments).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ totalProducts: 0, revenue: 0, totalOrders: 0 }),
    });
  });

  test('counts active/inactive/low-stock/out-of-stock products correctly from real product data', async () => {
    mockProductFind(sellerProducts);
    Order.countDocuments.mockResolvedValue(0);
    Order.aggregate.mockResolvedValue([]);
    Order.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const req = { user: { _id: 'seller1' } };
    const res = buildRes();

    await getSellerAnalytics(req, res, (err) => { if (err) throw err; });

    const data = res.json.mock.calls[0][0].data;

    expect(data.totalProducts).toBe(3);
    expect(data.activeProducts).toBe(2);
    expect(data.inactiveProducts).toBe(1);
    expect(data.lowStockProducts.map((p) => p._id)).toEqual(['p1']);
    expect(data.outOfStockProducts.map((p) => p._id)).toEqual(['p2']);
  });

  test('always scopes queries to the products belonging to this seller only (isolation)', async () => {
    mockProductFind(sellerProducts);
    Order.countDocuments.mockResolvedValue(2);
    Order.aggregate.mockResolvedValue([]);
    Order.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const req = { user: { _id: 'seller1' } };
    const res = buildRes();

    await getSellerAnalytics(req, res, (err) => { if (err) throw err; });

    // The seller id used to fetch products comes only from req.user, never
    // from the request body/query.
    expect(Product.find).toHaveBeenCalledWith({ seller: 'seller1' });

    // Every order-scoped query is filtered to this seller's product ids.
    expect(Order.countDocuments).toHaveBeenCalledWith({
      'items.product': { $in: ['p1', 'p2', 'p3'] },
    });
  });

  test('revenue/units come from the historical item price snapshot and exclude cancelled orders', async () => {
    mockProductFind(sellerProducts);
    Order.countDocuments.mockResolvedValue(3);

    // First aggregate call in the controller is the totals aggregation.
    Order.aggregate
      .mockResolvedValueOnce([{ _id: null, totalUnitsSold: 7, revenue: 350 }]) // totals
      .mockResolvedValueOnce([]) // salesOverTime
      .mockResolvedValueOnce([]) // bestSelling
      .mockResolvedValueOnce([]); // categoryPerformance

    Order.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const req = { user: { _id: 'seller1' } };
    const res = buildRes();

    await getSellerAnalytics(req, res, (err) => { if (err) throw err; });

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalUnitsSold).toBe(7);
    expect(data.revenue).toBe(350);

    // Verify the aggregation pipeline itself excludes cancelled orders.
    const totalsPipeline = Order.aggregate.mock.calls[0][0];
    expect(totalsPipeline[0].$match.status).toEqual({ $ne: 'cancelled' });
  });
});

describe('getAdminAnalytics', () => {
  test('counts users by role using real database queries, not hardcoded numbers', async () => {
    User.countDocuments
      .mockResolvedValueOnce(10) // totalUsers
      .mockResolvedValueOnce(7) // customers
      .mockResolvedValueOnce(2); // sellers
    Product.countDocuments.mockResolvedValueOnce(20).mockResolvedValueOnce(18);
    Order.countDocuments.mockResolvedValue(15);
    Order.aggregate
      .mockResolvedValueOnce([{ _id: 'delivered', count: 5 }, { _id: 'cancelled', count: 2 }]) // status counts
      .mockResolvedValueOnce([{ _id: null, totalRevenue: 999 }]) // revenue
      .mockResolvedValueOnce([]) // salesOverTime
      .mockResolvedValueOnce([]) // topSelling
      .mockResolvedValueOnce([]); // topCategories
    Order.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });
    Product.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const req = {};
    const res = buildRes();

    await getAdminAnalytics(req, res, (err) => { if (err) throw err; });

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalUsers).toBe(10);
    expect(data.totalCustomers).toBe(7);
    expect(data.totalSellers).toBe(2);
    expect(data.totalProducts).toBe(20);
    expect(data.activeProducts).toBe(18);
    expect(data.ordersByStatus.delivered).toBe(5);
    expect(data.ordersByStatus.cancelled).toBe(2);
    expect(data.ordersByStatus.pending).toBe(0);
  });

  test('total revenue calculation excludes cancelled orders at the aggregation level', async () => {
    User.countDocuments.mockResolvedValue(0);
    Product.countDocuments.mockResolvedValue(0);
    Order.countDocuments.mockResolvedValue(0);
    Order.aggregate
      .mockResolvedValueOnce([]) // status counts
      .mockResolvedValueOnce([{ _id: null, totalRevenue: 500 }]) // revenue
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    Order.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });
    Product.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });

    const req = {};
    const res = buildRes();

    await getAdminAnalytics(req, res, (err) => { if (err) throw err; });

    const revenuePipeline = Order.aggregate.mock.calls[1][0];
    expect(revenuePipeline[0].$match.status).toEqual({ $ne: 'cancelled' });

    const data = res.json.mock.calls[0][0].data;
    expect(data.totalRevenue).toBe(500);
  });
});
