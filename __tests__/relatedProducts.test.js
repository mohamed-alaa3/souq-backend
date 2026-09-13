process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Product');

const Product = require('../models/Product');
const { getRelatedProducts } = require('../controllers/productController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Product.find(...) returns a chainable Mongoose query in the real
// controller (.select().populate().sort().limit()). Mock a minimal
// chainable stub and capture the filter object built by the controller.
const mockChainableFind = (resolvedProducts = []) => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(resolvedProducts),
  };
  Product.find.mockReturnValue(chain);
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('404s when the base product does not exist', async () => {
  Product.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue(null),
  });

  const req = { params: { id: 'missing' }, query: {} };
  const res = buildRes();
  const next = jest.fn();

  await getRelatedProducts(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(next.mock.calls[0][0].statusCode).toBe(404);
});

test('excludes the current product and filters by its category and isActive', async () => {
  Product.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ _id: 'p1', category: 'cat1' }),
  });

  const chain = mockChainableFind([]);

  const req = { params: { id: 'p1' }, query: {} };
  const res = buildRes();

  await getRelatedProducts(req, res, (err) => { if (err) throw err; });

  expect(Product.find).toHaveBeenCalledWith({
    _id: { $ne: 'p1' },
    category: 'cat1',
    isActive: true,
  });
  expect(chain.limit).toHaveBeenCalled();
});

test('returns the products resolved by the query', async () => {
  Product.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ _id: 'p1', category: 'cat1' }),
  });

  const relatedDocs = [
    { _id: 'p2', name: 'Related Shirt', isActive: true },
    { _id: 'p3', name: 'Related Pants', isActive: true },
  ];

  mockChainableFind(relatedDocs);

  const req = { params: { id: 'p1' }, query: {} };
  const res = buildRes();

  await getRelatedProducts(req, res, (err) => { if (err) throw err; });

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: relatedDocs,
  });
});

test('respects a custom limit within bounds', async () => {
  Product.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ _id: 'p1', category: 'cat1' }),
  });

  const chain = mockChainableFind([]);

  const req = { params: { id: 'p1' }, query: { limit: '3' } };
  const res = buildRes();

  await getRelatedProducts(req, res, (err) => { if (err) throw err; });

  expect(chain.limit).toHaveBeenCalledWith(3);
});

test('clamps an out-of-range limit to the maximum allowed', async () => {
  Product.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ _id: 'p1', category: 'cat1' }),
  });

  const chain = mockChainableFind([]);

  const req = { params: { id: 'p1' }, query: { limit: '9999' } };
  const res = buildRes();

  await getRelatedProducts(req, res, (err) => { if (err) throw err; });

  expect(chain.limit).toHaveBeenCalledWith(20);
});

test('clamps a zero/negative/non-numeric limit up to the minimum of 1 instead of silently defaulting', async () => {
  Product.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ _id: 'p1', category: 'cat1' }),
  });

  const chain = mockChainableFind([]);

  const req = { params: { id: 'p1' }, query: { limit: '0' } };
  const res = buildRes();

  await getRelatedProducts(req, res, (err) => { if (err) throw err; });

  // limit=0 must clamp to 1, not silently fall back to the default of 8
  // (Number(0) || 8 would incorrectly evaluate to 8 since 0 is falsy).
  expect(chain.limit).toHaveBeenCalledWith(1);
});

test('falls back to the default limit of 8 when no limit is given', async () => {
  Product.findById.mockReturnValue({
    select: jest.fn().mockResolvedValue({ _id: 'p1', category: 'cat1' }),
  });

  const chain = mockChainableFind([]);

  const req = { params: { id: 'p1' }, query: {} };
  const res = buildRes();

  await getRelatedProducts(req, res, (err) => { if (err) throw err; });

  expect(chain.limit).toHaveBeenCalledWith(8);
});
