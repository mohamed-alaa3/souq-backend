process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Notification');

const Notification = require('../models/Notification');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} = require('../controllers/notificationController');

const buildRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getNotifications', () => {
  test('returns paginated notifications scoped to the authenticated user only', async () => {
    const findChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ _id: 'n1' }, { _id: 'n2' }]),
    };
    Notification.find.mockReturnValue(findChain);
    Notification.countDocuments
      .mockResolvedValueOnce(2) // total
      .mockResolvedValueOnce(1); // unreadCount

    const req = { user: { _id: 'user1' }, query: { page: '1', limit: '10' } };
    const res = buildRes();

    await getNotifications(req, res, (err) => { if (err) throw err; });

    expect(Notification.find).toHaveBeenCalledWith({ user: 'user1' });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ _id: 'n1' }, { _id: 'n2' }],
      unreadCount: 1,
      pagination: { total: 2, page: 1, limit: 10, pages: 1 },
    });
  });

  test('sorts newest first', async () => {
    const sortSpy = jest.fn().mockReturnThis();
    Notification.find.mockReturnValue({
      sort: sortSpy,
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });
    Notification.countDocuments.mockResolvedValue(0);

    const req = { user: { _id: 'user1' }, query: {} };
    const res = buildRes();

    await getNotifications(req, res, (err) => { if (err) throw err; });

    expect(sortSpy).toHaveBeenCalledWith('-createdAt');
  });

  test('clamps page size to the 50 maximum', async () => {
    const limitSpy = jest.fn().mockResolvedValue([]);
    Notification.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: limitSpy,
    });
    Notification.countDocuments.mockResolvedValue(0);

    const req = { user: { _id: 'user1' }, query: { limit: '500' } };
    const res = buildRes();

    await getNotifications(req, res, (err) => { if (err) throw err; });

    expect(limitSpy).toHaveBeenCalledWith(50);
  });
});

describe('getUnreadCount', () => {
  test('counts only this user\'s unread notifications', async () => {
    Notification.countDocuments.mockResolvedValue(4);

    const req = { user: { _id: 'user1' } };
    const res = buildRes();

    await getUnreadCount(req, res, (err) => { if (err) throw err; });

    expect(Notification.countDocuments).toHaveBeenCalledWith({ user: 'user1', isRead: false });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { unreadCount: 4 } });
  });
});

describe('markAsRead', () => {
  test('marks the notification as read when the requester owns it', async () => {
    const notification = {
      user: { toString: () => 'user1' },
      isRead: false,
      save: jest.fn().mockResolvedValue(true),
    };
    Notification.findById.mockResolvedValue(notification);

    const req = { user: { _id: 'user1' }, params: { id: 'n1' } };
    const res = buildRes();

    await markAsRead(req, res, (err) => { if (err) throw err; });

    expect(notification.isRead).toBe(true);
    expect(notification.save).toHaveBeenCalled();
  });

  test('rejects marking another user\'s notification as read (403)', async () => {
    const notification = { user: { toString: () => 'someoneElse' }, isRead: false, save: jest.fn() };
    Notification.findById.mockResolvedValue(notification);

    const req = { user: { _id: 'user1' }, params: { id: 'n1' } };
    const res = buildRes();

    let caughtError;
    await markAsRead(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(403);
    expect(notification.save).not.toHaveBeenCalled();
  });

  test('404s for a notification that does not exist', async () => {
    Notification.findById.mockResolvedValue(null);

    const req = { user: { _id: 'user1' }, params: { id: 'missing' } };
    const res = buildRes();

    let caughtError;
    await markAsRead(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(404);
  });

  test('is a no-op (no extra save) if already read', async () => {
    const notification = { user: { toString: () => 'user1' }, isRead: true, save: jest.fn() };
    Notification.findById.mockResolvedValue(notification);

    const req = { user: { _id: 'user1' }, params: { id: 'n1' } };
    const res = buildRes();

    await markAsRead(req, res, (err) => { if (err) throw err; });

    expect(notification.save).not.toHaveBeenCalled();
  });
});

describe('markAllAsRead', () => {
  test('only updates the authenticated user\'s own unread notifications', async () => {
    Notification.updateMany.mockResolvedValue({ modifiedCount: 3 });

    const req = { user: { _id: 'user1' } };
    const res = buildRes();

    await markAllAsRead(req, res, (err) => { if (err) throw err; });

    expect(Notification.updateMany).toHaveBeenCalledWith(
      { user: 'user1', isRead: false },
      { $set: { isRead: true } },
    );
  });
});

describe('deleteNotification', () => {
  test('deletes when the requester owns the notification', async () => {
    const notification = { user: { toString: () => 'user1' }, deleteOne: jest.fn().mockResolvedValue(true) };
    Notification.findById.mockResolvedValue(notification);

    const req = { user: { _id: 'user1' }, params: { id: 'n1' } };
    const res = buildRes();

    await deleteNotification(req, res, (err) => { if (err) throw err; });

    expect(notification.deleteOne).toHaveBeenCalled();
  });

  test('a user cannot delete another user\'s notification (403)', async () => {
    const notification = { user: { toString: () => 'someoneElse' }, deleteOne: jest.fn() };
    Notification.findById.mockResolvedValue(notification);

    const req = { user: { _id: 'user1' }, params: { id: 'n1' } };
    const res = buildRes();

    let caughtError;
    await deleteNotification(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(403);
    expect(notification.deleteOne).not.toHaveBeenCalled();
  });

  test('404s for a notification that does not exist', async () => {
    Notification.findById.mockResolvedValue(null);

    const req = { user: { _id: 'user1' }, params: { id: 'missing' } };
    const res = buildRes();

    let caughtError;
    await deleteNotification(req, res, (err) => { caughtError = err; });

    expect(caughtError.statusCode).toBe(404);
  });
});
