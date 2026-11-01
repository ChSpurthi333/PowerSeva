function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Wraps async route handlers so rejected promises reach the error handler
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res) {
  res.status(404).json({ message: 'Route not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'A record with these details already exists' });
  }
  if (err.name === 'MulterError') {
    return res.status(400).json({ message: err.message });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 ? 'Internal server error' : err.message
  });
}

module.exports = { httpError, asyncHandler, notFound, errorHandler };
