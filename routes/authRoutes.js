const express = require('express');
const { register, login, getMe, updateMe } = require('../controllers/authController');
const protect = require('../middlewares/protect');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.patch('/me', protect, updateMe);

module.exports = router;
