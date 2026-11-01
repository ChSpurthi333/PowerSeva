const { httpError } = require('./errorMiddleware');

// Usage: router.use(authenticate, authorize('admin'))
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(httpError(403, 'You do not have permission to perform this action'));
  }
  next();
};

module.exports = { authorize };
