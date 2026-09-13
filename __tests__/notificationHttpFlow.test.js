process.env.JWT_SECRET = 'test_secret_key';

jest.mock('../models/Notification');
jest.mock('../models/User');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

const Notification = require('../models/Notification');
const User = require('../models/User');

const notificationRoutes = require('../routes/notificationRoutes');
const notFound = require('../middlewares/notFound');
const errorHandler = require('../middlewares/errorHandler');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationRoutes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
};

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET);

const users = {
  user1: { _id: 'user1', role: 'customer' },
  user2: { _id: 'user2', role: 'customer' },
};

beforeEach(() => {
  jest.clearAllMocks();
  User.findById.mockImplementation((id) => Promise.resolve(users[id]));
});

test('unauthenticated request to list notifications is rejected (401)', async () => {
  const res = await request(buildApp()).get('/api/notifications');
  expect(res.status).toBe(401);
});

test('unauthenticated request to unread-count is rejected (401)', async () => {
  const res = await request(buildApp()).get('/api/notifications/unread-count');
  expect(res.status).toBe(401);
});

test('a user only ever queries their own notifications', async () => {
  const findChain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };
  Notification.find.mockReturnValue(findChain);
  Notification.countDocuments.mockResolvedValue(0);

  const res = await request(buildApp())
    .get('/api/notifications')
    .set('Authorization', `Bearer ${signToken('user1')}`);

  expect(res.status).toBe(200);
  expect(Notification.find).toHaveBeenCalledWith({ user: 'user1' });
});

test('user1 cannot mark user2\'s notification as read (403)', async () => {
  Notification.findById.mockResolvedValue({
    user: { toString: () => 'user2' },
    isRead: false,
    save: jest.fn(),
  });

  const res = await request(buildApp())
    .patch('/api/notifications/notif1/read')
    .set('Authorization', `Bearer ${signToken('user1')}`);

  expect(res.status).toBe(403);
});

test('user1 cannot delete user2\'s notification (403)', async () => {
  Notification.findById.mockResolvedValue({
    user: { toString: () => 'user2' },
    deleteOne: jest.fn(),
  });

  const res = await request(buildApp())
    .delete('/api/notifications/notif1')
    .set('Authorization', `Bearer ${signToken('user1')}`);

  expect(res.status).toBe(403);
});

test('a user can mark and delete their own notification', async () => {
  const notification = {
    user: { toString: () => 'user1' },
    isRead: false,
    save: jest.fn().mockResolvedValue(true),
  };
  Notification.findById.mockResolvedValue(notification);

  const readRes = await request(buildApp())
    .patch('/api/notifications/notif1/read')
    .set('Authorization', `Bearer ${signToken('user1')}`);

  expect(readRes.status).toBe(200);

  const deletable = { user: { toString: () => 'user1' }, deleteOne: jest.fn().mockResolvedValue(true) };
  Notification.findById.mockResolvedValue(deletable);

  const deleteRes = await request(buildApp())
    .delete('/api/notifications/notif1')
    .set('Authorization', `Bearer ${signToken('user1')}`);

  expect(deleteRes.status).toBe(200);
  expect(deletable.deleteOne).toHaveBeenCalled();
});
