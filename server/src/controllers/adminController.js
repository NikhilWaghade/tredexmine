import {
  getAdminOverviewMetrics,
  getAllUsersAdmin,
  getActiveInvestmentsAdmin,
  getAllWalletsAdmin,
  getAllDepositsAdmin,
  getAllReferralsAdmin,
  getAllPaymentsAdmin,
} from '../services/adminService.js';

export const getAdminOverviewController = async (req, res, next) => {
  try {
    const data = await getAdminOverviewMetrics();
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllUsersAdminController = async (req, res, next) => {
  try {
    const { search, page, limit, role } = req.query;
    const result = await getAllUsersAdmin({ search, page, limit, role });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getActiveInvestmentsAdminController = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const result = await getActiveInvestmentsAdmin({ page, limit, status });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllWalletsAdminController = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await getAllWalletsAdmin({ page, limit });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllDepositsAdminController = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const result = await getAllDepositsAdmin({ page, limit, status });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllReferralsAdminController = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await getAllReferralsAdmin({ page, limit });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export const getAllPaymentsAdminController = async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const result = await getAllPaymentsAdmin({ page, limit, status });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

export default {
  getAdminOverviewController,
  getAllUsersAdminController,
  getActiveInvestmentsAdminController,
  getAllWalletsAdminController,
  getAllDepositsAdminController,
  getAllReferralsAdminController,
  getAllPaymentsAdminController,
};

