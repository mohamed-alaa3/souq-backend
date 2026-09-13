process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Product');

const Product = require('../models/Product');
const { getProducts } = require('../controllers/productController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// Product.find(...) returns a chainable Mongoose query in the real
// controller (.populate().populate().sort().skip().limit()). Mock a
// minimal chainable stub that resolves to an empty product list, and
// capture the filter object + sort string the controller built.
const mockChainableFind = () => {
  const chain = {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };
  Product.find.mockReturnValue(chain);
  Product.countDocuments.mockResolvedValue(0);
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('discount=true filters to products with an active discount only', async () => {
  mockChainableFind();

  const req = { query: { discount: 'true' } };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(Product.find).toHaveBeenCalledWith(
    expect.objectContaining({ discountPercentage: { $gt: 0 } }),
  );
});

test('inStock=true filters to products with stock greater than zero', async () => {
  mockChainableFind();

  const req = { query: { inStock: 'true' } };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(Product.find).toHaveBeenCalledWith(
    expect.objectContaining({ stock: { $gt: 0 } }),
  );
});

test('inStock=false filters to out-of-stock products only', async () => {
  mockChainableFind();

  const req = { query: { inStock: 'false' } };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(Product.find).toHaveBeenCalledWith(
    expect.objectContaining({ stock: 0 }),
  );
});

test('minRating filters products by ratingsAverage', async () => {
  mockChainableFind();

  const req = { query: { minRating: '4' } };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(Product.find).toHaveBeenCalledWith(
    expect.objectContaining({ ratingsAverage: { $gte: 4 } }),
  );
});

test('sort=rating sorts by ratingsAverage descending', async () => {
  const chain = mockChainableFind();

  const req = { query: { sort: 'rating' } };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(chain.sort).toHaveBeenCalledWith('-ratingsAverage');
});

test('sort=popularity sorts by review count then rating', async () => {
  const chain = mockChainableFind();

  const req = { query: { sort: 'popularity' } };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(chain.sort).toHaveBeenCalledWith('-ratingsQuantity -ratingsAverage');
});

test('an unrecognized sort value falls back to newest', async () => {
  const chain = mockChainableFind();

  const req = { query: { sort: 'nonsense' } };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(chain.sort).toHaveBeenCalledWith('-createdAt');
});

test('with no filters supplied, only the default isActive query is used', async () => {
  mockChainableFind();

  const req = { query: {} };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(Product.find).toHaveBeenCalledWith({ isActive: true });
});

test('filters combine together correctly', async () => {
  mockChainableFind();

  const req = {
    query: {
      category: 'cat1',
      minPrice: '10',
      maxPrice: '100',
      discount: 'true',
      inStock: 'true',
      minRating: '3',
      search: 'shirt',
    },
  };
  const res = buildRes();

  await getProducts(req, res, (err) => { if (err) throw err; });

  expect(Product.find).toHaveBeenCalledWith({
    isActive: true,
    category: 'cat1',
    price: { $gte: 10, $lte: 100 },
    discountPercentage: { $gt: 0 },
    stock: { $gt: 0 },
    ratingsAverage: { $gte: 3 },
    $text: { $search: 'shirt' },
  });
});
