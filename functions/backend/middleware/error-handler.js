const { ApiError } = require('../lib/http.js');

const notFoundHandler = (_req, res) => {
  res.status(404).json({
    message: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
  });
};

const errorHandler = (error, _req, res, _next) => {
  const status = error instanceof ApiError
    ? error.status
    : Number(error?.status || error?.statusCode || 500);
  const message = error instanceof ApiError
    ? error.message
    : error?.message || 'Internal server error';
  const code = error instanceof ApiError
    ? error.code
    : error?.code || 'INTERNAL_SERVER_ERROR';

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    message,
    code,
    ...(error instanceof ApiError && error.details ? { details: error.details } : {}),
  });
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
