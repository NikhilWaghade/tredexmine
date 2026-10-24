const ALLOWED_FIELDS = new Set([
  'name',
  'tag',
  'description',
  'price',
  'durationDays',
  'dailyRoiRate',
  'hashRate',
  'features',
  'isActive',
  'sortOrder',
]);

/**
 * Middleware validator for plan creation requests (Admin)
 */
export const createPlanValidation = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const errors = [];
  const body = req.body;

  // 1. Reject client-supplied ID
  if ('_id' in body || 'id' in body) {
    errors.push('Client-supplied ID is not allowed');
  }

  // 2. Reject client-supplied timestamps or version keys
  if ('createdAt' in body || 'updatedAt' in body || '__v' in body) {
    errors.push('Client-supplied timestamps or version fields are not allowed');
  }

  // 3. Reject any unintended extra fields
  const unintendedKeys = Object.keys(body).filter(
    (key) =>
      !ALLOWED_FIELDS.has(key) &&
      key !== '_id' &&
      key !== 'id' &&
      key !== 'createdAt' &&
      key !== 'updatedAt' &&
      key !== '__v'
  );
  if (unintendedKeys.length > 0) {
    errors.push(`Unintended fields are not allowed: ${unintendedKeys.join(', ')}`);
  }

  const {
    name,
    tag,
    description,
    price,
    durationDays,
    dailyRoiRate,
    hashRate,
    features,
    isActive,
    sortOrder,
  } = body;

  // 4. Validate name
  if (name === undefined || name === null || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Plan name is required');
  } else if (name.trim().length < 2 || name.trim().length > 100) {
    errors.push('Plan name must be between 2 and 100 characters');
  }

  // 5. Validate price
  if (price === undefined || price === null || price === '') {
    errors.push('Plan price is required');
  } else if (typeof price !== 'number' || Number.isNaN(price)) {
    errors.push('Plan price must be a valid number');
  } else if (price <= 0) {
    errors.push('Plan price must be greater than zero');
  }

  // 6. Validate durationDays
  if (durationDays === undefined || durationDays === null || durationDays === '') {
    errors.push('Plan duration in days is required');
  } else if (typeof durationDays !== 'number' || !Number.isInteger(durationDays)) {
    errors.push('Plan duration in days must be an integer');
  } else if (durationDays < 1) {
    errors.push('Plan duration must be at least 1 day');
  }

  // 7. Validate dailyRoiRate
  if (dailyRoiRate !== undefined && dailyRoiRate !== null && dailyRoiRate !== '') {
    if (typeof dailyRoiRate !== 'number' || Number.isNaN(dailyRoiRate)) {
      errors.push('Daily ROI rate must be a valid number');
    } else if (dailyRoiRate < 0) {
      errors.push('Daily ROI rate cannot be negative');
    }
  }

  // 8. Validate optional string fields
  if (tag !== undefined && tag !== null && typeof tag !== 'string') {
    errors.push('Tag must be a string');
  }

  if (description !== undefined && description !== null && typeof description !== 'string') {
    errors.push('Description must be a string');
  }

  if (hashRate !== undefined && hashRate !== null && typeof hashRate !== 'string') {
    errors.push('Hash rate must be a string');
  }

  // 9. Validate features array
  if (features !== undefined && features !== null) {
    if (!Array.isArray(features)) {
      errors.push('Features must be an array of strings');
    } else if (!features.every((f) => typeof f === 'string')) {
      errors.push('All features must be strings');
    }
  }

  // 10. Validate isActive
  if (isActive !== undefined && isActive !== null && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  // 11. Validate sortOrder
  if (sortOrder !== undefined && sortOrder !== null && sortOrder !== '') {
    if (typeof sortOrder !== 'number' || Number.isNaN(sortOrder)) {
      errors.push('Sort order must be a valid number');
    }
  }

  // Return validation error response if any rule failed
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
 * Middleware validator for plan update requests (Admin)
 */
export const updatePlanValidation = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['Request body must be a JSON object'],
    });
  }

  const errors = [];
  const body = req.body;

  // 1. Reject client-supplied ID
  if ('_id' in body || 'id' in body) {
    errors.push('Client-supplied ID is not allowed');
  }

  // 2. Reject client-supplied timestamps or version keys
  if ('createdAt' in body || 'updatedAt' in body || '__v' in body) {
    errors.push('Client-supplied timestamps or version fields are not allowed');
  }

  // 3. Reject any unintended extra fields
  const unintendedKeys = Object.keys(body).filter(
    (key) =>
      !ALLOWED_FIELDS.has(key) &&
      key !== '_id' &&
      key !== 'id' &&
      key !== 'createdAt' &&
      key !== 'updatedAt' &&
      key !== '__v'
  );
  if (unintendedKeys.length > 0) {
    errors.push(`Unintended fields are not allowed: ${unintendedKeys.join(', ')}`);
  }

  const {
    name,
    tag,
    description,
    price,
    durationDays,
    dailyRoiRate,
    hashRate,
    features,
    isActive,
    sortOrder,
  } = body;

  // Ensure at least one allowed field is provided for update
  const providedAllowedKeys = Object.keys(body).filter((key) => ALLOWED_FIELDS.has(key));
  if (providedAllowedKeys.length === 0) {
    errors.push('At least one updatable field must be provided');
  }

  // 4. Validate name if provided
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push('Plan name cannot be empty');
    } else if (name.trim().length < 2 || name.trim().length > 100) {
      errors.push('Plan name must be between 2 and 100 characters');
    }
  }

  // 5. Validate price if provided
  if (price !== undefined) {
    if (typeof price !== 'number' || Number.isNaN(price)) {
      errors.push('Plan price must be a valid number');
    } else if (price <= 0) {
      errors.push('Plan price must be greater than zero');
    }
  }

  // 6. Validate durationDays if provided
  if (durationDays !== undefined) {
    if (typeof durationDays !== 'number' || !Number.isInteger(durationDays)) {
      errors.push('Plan duration in days must be an integer');
    } else if (durationDays < 1) {
      errors.push('Plan duration must be at least 1 day');
    }
  }

  // 7. Validate dailyRoiRate if provided
  if (dailyRoiRate !== undefined && dailyRoiRate !== null && dailyRoiRate !== '') {
    if (typeof dailyRoiRate !== 'number' || Number.isNaN(dailyRoiRate)) {
      errors.push('Daily ROI rate must be a valid number');
    } else if (dailyRoiRate < 0) {
      errors.push('Daily ROI rate cannot be negative');
    }
  }

  // 8. Validate optional string fields if provided
  if (tag !== undefined && tag !== null && typeof tag !== 'string') {
    errors.push('Tag must be a string');
  }

  if (description !== undefined && description !== null && typeof description !== 'string') {
    errors.push('Description must be a string');
  }

  if (hashRate !== undefined && hashRate !== null && typeof hashRate !== 'string') {
    errors.push('Hash rate must be a string');
  }

  // 9. Validate features array if provided
  if (features !== undefined && features !== null) {
    if (!Array.isArray(features)) {
      errors.push('Features must be an array of strings');
    } else if (!features.every((f) => typeof f === 'string')) {
      errors.push('All features must be strings');
    }
  }

  // 10. Validate isActive if provided
  if (isActive !== undefined && isActive !== null && typeof isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  // 11. Validate sortOrder if provided
  if (sortOrder !== undefined && sortOrder !== null && sortOrder !== '') {
    if (typeof sortOrder !== 'number' || Number.isNaN(sortOrder)) {
      errors.push('Sort order must be a valid number');
    }
  }

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
  createPlanValidation,
  updatePlanValidation,
};
