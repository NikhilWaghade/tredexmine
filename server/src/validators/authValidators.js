import validator from 'validator';

/**
 * Middleware validator for user registration requests
 */
export const registerValidation = (req, res, next) => {
  const { name, email, password, role, referredBy } = req.body || {};
  const errors = [];

  // Validate Name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Name is required');
  } else if (name.trim().length < 2 || name.trim().length > 60) {
    errors.push('Name must be between 2 and 60 characters');
  }

  // Validate Email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.push('Email is required');
  } else if (!validator.isEmail(email.trim())) {
    errors.push('Please provide a valid email address');
  }

  // Validate Password
  if (!password || typeof password !== 'string') {
    errors.push('Password is required');
  } else if (password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }

  // Reject requests that explicitly contain a role field
  if (role !== undefined || (req.body && 'role' in req.body)) {
    errors.push('Role cannot be specified during registration');
  }

  // Return validation error response if any rules failed
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

/**
 * Middleware validator for user login requests
 */
export const loginValidation = (req, res, next) => {
  const { email, password } = req.body || {};
  const errors = [];

  // Validate Email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.push('Email is required');
  } else if (!validator.isEmail(email.trim())) {
    errors.push('Please provide a valid email address');
  }

  // Validate Password
  if (!password || typeof password !== 'string' || password.length === 0) {
    errors.push('Password is required');
  }

  // Return validation error response if any rules failed
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  next();
};

export default {
  registerValidation,
  loginValidation,
};
