process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Review');
jest.mock('../models/Product');
jest.mock('../models/Order');
jest.mock('../models/User');
jest.mock('../utils/notificationService', () => ({
  createNotification: jest.fn().mockResolvedValue(true),
  createNotifications: jest.fn().mockResolvedValue([]),
}));

const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const { createNotifications } = require('../utils/notificationService');
const { createReview, getReviewById, deleteReview } = require('../controllers/reviewController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('a new review notifies the product\'s seller and every admin, deep-linked to the exact product + review', async () => {
  Product.findById.mockResolvedValue({ _id: 'prod1', name: 'Cool Shirt', seller: 'seller1' });
  Order.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'order1' }) });
  Review.findOne.mockResolvedValue(null);

  const createdReview = {
    _id: 'review1',
    product: 'prod1',
    user: { name: 'Alice' },
    populate: jest.fn().mockResolvedValue(true),
  };
  Review.create.mockResolvedValue(createdReview);
  Review.calcAverageRatings.mockResolvedValue({ ratingsAverage: 1, ratingsQuantity: 1 });

  User.find.mockReturnValue({
    select: jest.fn().mockResolvedValue([{ _id: 'admin1' }, { _id: 'admin2' }]),
  });

  const req = {
    user: { _id: 'user1', role: 'customer' },
    body: { product: 'prod1', rating: 1, comment: 'Terrible product, do not buy' },
  };
  const res = buildRes();

  await createReview(req, res, (err) => { if (err) throw err; });

  expect(createNotifications).toHaveBeenCalledWith([
    expect.objectContaining({
      user: 'seller1',
      type: 'product_review',
      relatedProduct: 'prod1',
      relatedReview: 'review1',
    }),
    expect.objectContaining({
      user: 'admin1',
      type: 'product_review',
      relatedProduct: 'prod1',
      relatedReview: 'review1',
    }),
    expect.objectContaining({
      user: 'admin2',
      type: 'product_review',
      relatedProduct: 'prod1',
      relatedReview: 'review1',
    }),
  ]);

  // Not a generic notification - the message must be specific enough to
  // identify what's being reviewed for moderation purposes.
  const sellerNotification = createNotifications.mock.calls[0][0][0];
  expect(sellerNotification.message).toContain('Cool Shirt');
});

test('a notification failure never prevents the review from being created', async () => {
  Product.findById.mockResolvedValue({ _id: 'prod1', name: 'Cool Shirt', seller: 'seller1' });
  Order.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'order1' }) });
  Review.findOne.mockResolvedValue(null);

  const createdReview = {
    _id: 'review1',
    product: 'prod1',
    user: { name: 'Alice' },
    populate: jest.fn().mockResolvedValue(true),
  };
  Review.create.mockResolvedValue(createdReview);
  Review.calcAverageRatings.mockResolvedValue({});
  User.find.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error('DB down')) });

  const req = {
    user: { _id: 'user1', role: 'customer' },
    body: { product: 'prod1', rating: 4, comment: 'Pretty good' },
  };
  const res = buildRes();

  await createReview(req, res, (err) => { if (err) throw err; });

  expect(res.status).toHaveBeenCalledWith(201);
});

describe('deep-link moderation path (getReviewById + seller delete)', () => {
  test('the product\'s seller can open the exact review via getReviewById', async () => {
    const review = {
      _id: 'review1',
      user: { _id: { toString: () => 'customer1' }, name: 'Alice' },
      product: { _id: 'prod1', name: 'Cool Shirt', seller: { toString: () => 'seller1' } },
    };
    // getReviewById does .findById(id).populate('user',...).populate('product',...)
    Review.findById.mockReturnValue({ populate: () => ({ populate: () => Promise.resolve(review) }) });

    const req = { user: { _id: 'seller1', role: 'seller' }, params: { id: 'review1' } };
    const res = buildRes();

    await getReviewById(req, res, (err) => { if (err) throw err; });

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('a seller who does not own the product cannot open the review (403)', async () => {
    const review = {
      _id: 'review1',
      user: { _id: { toString: () => 'customer1' }, name: 'Alice' },
      product: { _id: 'prod1', name: 'Cool Shirt', seller: { toString: () => 'seller1' } },
    };
    Review.findById.mockReturnValue({ populate: () => ({ populate: () => Promise.resolve(review) }) });

    const req = { user: { _id: 'seller2', role: 'seller' }, params: { id: 'review1' } };
    const res = buildRes();

    let caughtError;
    await getReviewById(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(403);
  });

  test('the product\'s seller can delete a problematic review reached via the notification', async () => {
    const review = {
      _id: 'review1',
      user: { toString: () => 'customer1' },
      product: 'prod1',
      deleteOne: jest.fn().mockResolvedValue(true),
    };
    Review.findById.mockResolvedValue(review);
    Product.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ seller: { toString: () => 'seller1' } }) });
    Review.calcAverageRatings.mockResolvedValue({});

    const req = { user: { _id: { toString: () => 'seller1' }, role: 'seller' }, params: { id: 'review1' } };
    const res = buildRes();

    await deleteReview(req, res, (err) => { if (err) throw err; });

    expect(review.deleteOne).toHaveBeenCalled();
  });

  test('a seller who does not own the product cannot delete the review (403)', async () => {
    const review = {
      _id: 'review1',
      user: { toString: () => 'customer1' },
      product: 'prod1',
      deleteOne: jest.fn(),
    };
    Review.findById.mockResolvedValue(review);
    Product.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ seller: { toString: () => 'seller1' } }) });

    const req = { user: { _id: { toString: () => 'seller2' }, role: 'seller' }, params: { id: 'review1' } };
    const res = buildRes();

    let caughtError;
    await deleteReview(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(403);
    expect(review.deleteOne).not.toHaveBeenCalled();
  });
});
