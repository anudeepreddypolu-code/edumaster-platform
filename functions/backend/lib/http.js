class ApiError extends Error {
  constructor(status = 500, message = 'Internal server error', options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options.code || 'API_ERROR';
    this.details = options.details || null;
  }
}

const asyncHandler = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

const send = (res, status, data) => res.status(status).json(data);
const ok = (res, data) => send(res, 200, data);
const created = (res, data) => send(res, 201, data);

const requireString = (value, fieldName, { minLength = 1, maxLength = null } = {}) => {
  const normalized = String(value ?? '').trim();

  if (!normalized || normalized.length < minLength) {
    throw new ApiError(400, `${fieldName} is required`, { code: 'VALIDATION_ERROR' });
  }

  if (maxLength && normalized.length > maxLength) {
    throw new ApiError(400, `${fieldName} must be at most ${maxLength} characters`, { code: 'VALIDATION_ERROR' });
  }

  return normalized;
};

const optionalString = (value, fallback = '', { maxLength = null } = {}) => {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  if (maxLength && normalized.length > maxLength) {
    throw new ApiError(400, `Value must be at most ${maxLength} characters`, { code: 'VALIDATION_ERROR' });
  }

  return normalized;
};

const requireNumber = (value, fieldName, { min = null, max = null, integer = false } = {}) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new ApiError(400, `${fieldName} must be a valid number`, { code: 'VALIDATION_ERROR' });
  }

  if (integer && !Number.isInteger(parsed)) {
    throw new ApiError(400, `${fieldName} must be an integer`, { code: 'VALIDATION_ERROR' });
  }

  if (min !== null && parsed < min) {
    throw new ApiError(400, `${fieldName} must be at least ${min}`, { code: 'VALIDATION_ERROR' });
  }

  if (max !== null && parsed > max) {
    throw new ApiError(400, `${fieldName} must be at most ${max}`, { code: 'VALIDATION_ERROR' });
  }

  return parsed;
};

const optionalNumber = (value, fallback, options = {}) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return requireNumber(value, 'value', options);
};

const requireBoolean = (value, fieldName) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new ApiError(400, `${fieldName} must be true or false`, { code: 'VALIDATION_ERROR' });
};

module.exports = {
  ApiError,
  asyncHandler,
  ok,
  created,
  requireString,
  optionalString,
  requireNumber,
  optionalNumber,
  requireBoolean,
};
