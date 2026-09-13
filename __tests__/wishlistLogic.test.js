process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Wishlist');
jest.mock('../models/Product');

const Wishlist = require('../models/Wishlist');
const Product = require('../models/Product');
const {
  getWishlist,
  addProduct,
  removeProduct,
  clearWishlist,
  checkProduct,
} = require('../controllers/wishlistController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('getWishlist creates an empty wishlist for a user who has never had one', async () => {
  Wishlist.findOne.mockResolvedValue(null);
  const created = { user: 'user1', products: [], populate: jest.fn().mockResolvedValue(true) };
  Wishlist.create.mockResolvedValue(created);

  const req = { user: { _id: 'user1' } };
  const res = buildRes();

  await getWishlist(req, res, (err) => { if (err) throw err; });

  expect(Wishlist.create).toHaveBeenCalledWith({ user: 'user1', products: [] });
  expect(res.status).toHaveBeenCalledWith(200);
});

test('getWishlist only ever looks up the wishlist belonging to req.user (IDOR safety)', async () => {
  const existing = { user: 'user1', products: [], populate: jest.fn().mockResolvedValue(true) };
  Wishlist.findOne.mockResolvedValue(existing);

  const req = { user: { _id: 'user1' } };
  const res = buildRes();

  await getWishlist(req, res, (err) => { if (err) throw err; });

  expect(Wishlist.findOne).toHaveBeenCalledWith({ user: 'user1' });
});

test('addProduct rejects a product that does not exist', async () => {
  Product.findById.mockResolvedValue(null);

  const req = { user: { _id: 'user1' }, body: { productId: 'doesNotExist' } };
  const res = buildRes();

  let caughtError;
  await addProduct(req, res, (err) => { caughtError = err; });

  expect(caughtError.statusCode).toBe(404);
});

test('addProduct does not duplicate a product already in the wishlist', async () => {
  Product.findById.mockResolvedValue({ _id: 'prod1' });

  const wishlist = {
    user: 'user1',
    products: [{ toString: () => 'prod1' }],
    save: jest.fn().mockResolvedValue(true),
    populate: jest.fn().mockResolvedValue(true),
  };
  Wishlist.findOne.mockResolvedValue(wishlist);

  const req = { user: { _id: 'user1' }, body: { productId: 'prod1' } };
  const res = buildRes();

  await addProduct(req, res, (err) => { if (err) throw err; });

  expect(wishlist.save).not.toHaveBeenCalled();
  expect(wishlist.products).toHaveLength(1);
});

test('addProduct appends a new product and persists it', async () => {
  Product.findById.mockResolvedValue({ _id: 'prod2' });

  const wishlist = {
    user: 'user1',
    products: [],
    save: jest.fn().mockResolvedValue(true),
    populate: jest.fn().mockResolvedValue(true),
  };
  Wishlist.findOne.mockResolvedValue(wishlist);

  const req = { user: { _id: 'user1' }, body: { productId: 'prod2' } };
  const res = buildRes();

  await addProduct(req, res, (err) => { if (err) throw err; });

  expect(wishlist.products).toContain('prod2');
  expect(wishlist.save).toHaveBeenCalled();
});

test('removeProduct filters out only the targeted product', async () => {
  const wishlist = {
    user: 'user1',
    products: [{ toString: () => 'prod1' }, { toString: () => 'prod2' }],
    save: jest.fn().mockResolvedValue(true),
    populate: jest.fn().mockResolvedValue(true),
  };
  Wishlist.findOne.mockResolvedValue(wishlist);

  const req = { user: { _id: 'user1' }, params: { productId: 'prod1' } };
  const res = buildRes();

  await removeProduct(req, res, (err) => { if (err) throw err; });

  expect(wishlist.products).toHaveLength(1);
  expect(wishlist.products[0].toString()).toBe('prod2');
});

test('clearWishlist empties the products array', async () => {
  const wishlist = {
    user: 'user1',
    products: [{ toString: () => 'prod1' }],
    save: jest.fn().mockResolvedValue(true),
  };
  Wishlist.findOne.mockResolvedValue(wishlist);

  const req = { user: { _id: 'user1' } };
  const res = buildRes();

  await clearWishlist(req, res, (err) => { if (err) throw err; });

  expect(wishlist.products).toEqual([]);
  expect(wishlist.save).toHaveBeenCalled();
});

test('checkProduct returns false when the user has no wishlist yet', async () => {
  Wishlist.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

  const req = { user: { _id: 'user1' }, params: { productId: 'prod1' } };
  const res = buildRes();

  await checkProduct(req, res, (err) => { if (err) throw err; });

  expect(res.json).toHaveBeenCalledWith({ success: true, data: { inWishlist: false } });
});
