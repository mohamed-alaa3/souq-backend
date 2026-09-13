process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Review');
jest.mock('../models/Product');
jest.mock('../models/Order');
jest.mock('../models/User');
jest.mock('../models/Notification');

const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const {
  createReview,
  updateReview,
  deleteReview,
} = require('../controllers/reviewController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
  User.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
});

test('createReview rejects a user who never purchased the product', async () => {
  Product.findById.mockResolvedValue({ _id: 'prod1' });
  Order.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

  const req = {
    user: { _id: 'user1', role: 'customer' },
    body: { product: 'prod1', rating: 5, comment: 'Great!' },
  };
  const res = buildRes();

  let caughtError;
  await createReview(req, res, (err) => { caughtError = err; });

  expect(caughtError).toBeDefined();
  expect(caughtError.statusCode).toBe(403);
  expect(Review.create).not.toHaveBeenCalled();
});

test('createReview rejects a duplicate review from the same user', async () => {
  Product.findById.mockResolvedValue({ _id: 'prod1' });
  Order.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'order1' }) });
  Review.findOne.mockResolvedValue({ _id: 'existingReview' });

  const req = {
    user: { _id: 'user1', role: 'customer' },
    body: { product: 'prod1', rating: 4, comment: 'Nice' },
  };
  const res = buildRes();

  let caughtError;
  await createReview(req, res, (err) => { caughtError = err; });

  expect(caughtError.statusCode).toBe(400);
  expect(Review.create).not.toHaveBeenCalled();
});

test('createReview rejects an out-of-range rating before touching the DB', async () => {
  const req = {
    user: { _id: 'user1', role: 'customer' },
    body: { product: 'prod1', rating: 9, comment: 'Nice' },
  };
  const res = buildRes();

  let caughtError;
  await createReview(req, res, (err) => { caughtError = err; });

  expect(caughtError.statusCode).toBe(400);
  expect(Product.findById).not.toHaveBeenCalled();
});

test('createReview succeeds for a verified purchase and recalculates product rating stats', async () => {
  Product.findById.mockResolvedValue({ _id: 'prod1' });
  Order.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'order1' }) });
  Review.findOne.mockResolvedValue(null);

  const createdReview = {
    _id: 'review1',
    product: 'prod1',
    populate: jest.fn().mockResolvedValue(true),
  };
  Review.create.mockResolvedValue(createdReview);
  Review.calcAverageRatings.mockResolvedValue({ ratingsAverage: 5, ratingsQuantity: 1 });

  const req = {
    user: { _id: 'user1', role: 'customer' },
    body: { product: 'prod1', rating: 5, comment: 'Excellent product' },
  };
  const res = buildRes();

  await createReview(req, res, (err) => { if (err) throw err; });

  expect(Review.create).toHaveBeenCalledWith({
    user: 'user1',
    product: 'prod1',
    rating: 5,
    comment: 'Excellent product',
  });
  expect(Review.calcAverageRatings).toHaveBeenCalledWith('prod1');
  expect(res.status).toHaveBeenCalledWith(201);
});

test('updateReview blocks a user editing someone else\'s review', async () => {
  Review.findById.mockResolvedValue({ _id: 'review1', user: 'someoneElse', product: 'prod1' });

  const req = {
    user: { _id: 'user1', role: 'customer' },
    params: { id: 'review1' },
    body: { rating: 3 },
  };
  const res = buildRes();

  let caughtError;
  await updateReview(req, res, (err) => { caughtError = err; });

  expect(caughtError.statusCode).toBe(403);
});

test('deleteReview allows an admin to remove someone else\'s review (moderation)', async () => {
  const reviewDoc = {
    _id: 'review1',
    user: { toString: () => 'ownerUser' },
    product: 'prod1',
    deleteOne: jest.fn().mockResolvedValue(true),
  };
  Review.findById.mockResolvedValue(reviewDoc);
  Review.calcAverageRatings.mockResolvedValue({ ratingsAverage: 0, ratingsQuantity: 0 });

  const req = {
    user: { _id: { toString: () => 'adminUser' }, role: 'admin' },
    params: { id: 'review1' },
  };
  const res = buildRes();

  await deleteReview(req, res, (err) => { if (err) throw err; });

  expect(reviewDoc.deleteOne).toHaveBeenCalled();
  expect(Review.calcAverageRatings).toHaveBeenCalledWith('prod1');
  expect(res.status).toHaveBeenCalledWith(200);
});

test('deleteReview blocks a non-owner, non-admin customer', async () => {
  const reviewDoc = {
    _id: 'review1',
    user: { toString: () => 'ownerUser' },
    product: 'prod1',
    deleteOne: jest.fn(),
  };
  Review.findById.mockResolvedValue(reviewDoc);

  const req = {
    user: { _id: { toString: () => 'someoneElse' }, role: 'customer' },
    params: { id: 'review1' },
  };
  const res = buildRes();

  let caughtError;
  await deleteReview(req, res, (err) => { caughtError = err; });

  expect(caughtError.statusCode).toBe(403);
  expect(reviewDoc.deleteOne).not.toHaveBeenCalled();
});
