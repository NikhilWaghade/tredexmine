import mongoose from 'mongoose';
import {
  getActivePlans,
  getActivePlanById,
  purchasePlan as purchasePlanService,
  getUserActivePlans,
  createPlan as createPlanService,
  getAllPlansAdmin,
  getPlanByIdAdmin,
  updatePlan as updatePlanService,
  togglePlanStatus as togglePlanStatusService,
} from '../services/planService.js';

/**
 * Get all active plans sorted by sortOrder
 * @route GET /api/v1/plans
 */
export const getPlans = async (req, res, next) => {
  try {
    const plans = await getActivePlans();

    return res.status(200).json({
      success: true,
      count: plans.length,
      plans,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single active plan by ID
 * @route GET /api/v1/plans/:id
 */
export const getPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate MongoDB ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan ID format',
      });
    }

    const plan = await getActivePlanById(id);

    return res.status(200).json({
      success: true,
      plan,
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Purchase a plan using authenticated user's wallet balance
 * @route POST /api/v1/plans/:id/purchase
 */
export const purchasePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    // Read mandatory idempotency key from header or body
    const idempotencyKey =
      req.headers['idempotency-key'] ||
      req.headers['x-idempotency-key'] ||
      req.body?.idempotencyKey;

    const result = await purchasePlanService(userId, id, { idempotencyKey });

    const statusCode = result.isIdempotent ? 200 : 201;
    const message = result.isIdempotent
      ? 'Plan purchase already processed'
      : 'Plan purchased successfully';

    return res.status(statusCode).json({
      success: true,
      message,
      data: {
        userPlan: result.userPlan,
        walletBalance: result.walletBalance,
        ...(result.transaction ? { transaction: result.transaction } : {}),
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Get active plans subscribed by the authenticated user
 * @route GET /api/v1/plans/my/active
 */
export const getMyActivePlans = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const userPlans = await getUserActivePlans(userId);

    return res.status(200).json({
      success: true,
      count: userPlans.length,
      userPlans,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new plan (Administrator only)
 * @route POST /api/v1/plans
 */
export const createPlan = async (req, res, next) => {
  try {
    const plan = await createPlanService(req.body);

    return res.status(201).json({
      success: true,
      message: 'Plan created successfully',
      plan,
      data: {
        plan,
      },
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Get all plans including inactive ones (Administrator only)
 * @route GET /api/v1/plans/admin/all
 */
export const getAdminPlans = async (req, res, next) => {
  try {
    const plans = await getAllPlansAdmin();

    return res.status(200).json({
      success: true,
      count: plans.length,
      plans,
      data: plans,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get any plan by ID, regardless of active status (Administrator only)
 * @route GET /api/v1/plans/admin/:id
 */
export const getAdminPlanById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan ID format',
      });
    }

    const plan = await getPlanByIdAdmin(id);

    return res.status(200).json({
      success: true,
      plan,
      data: {
        plan,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Update an existing plan (Administrator only)
 * @route PUT /api/v1/plans/:id
 */
export const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan ID format',
      });
    }

    const plan = await updatePlanService(id, req.body);

    return res.status(200).json({
      success: true,
      message: 'Plan updated successfully',
      plan,
      data: {
        plan,
      },
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Toggle or set plan active status (Administrator only)
 * @route PATCH /api/v1/plans/:id/status
 */
export const togglePlanStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan ID format',
      });
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean',
      });
    }

    const plan = await togglePlanStatusService(id, isActive);

    return res.status(200).json({
      success: true,
      message: `Plan ${plan.isActive ? 'activated' : 'deactivated'} successfully`,
      plan,
      data: {
        plan,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

export default {
  getPlans,
  getPlanById,
  purchasePlan,
  getMyActivePlans,
  createPlan,
  getAdminPlans,
  getAdminPlanById,
  updatePlan,
  togglePlanStatus,
};
