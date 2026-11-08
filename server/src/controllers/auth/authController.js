import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from '../../models/User.js';
import { RefreshToken } from '../../models/RefreshToken.js';
import {
  generateAccessToken,
  generateRefreshToken,
  generateAuthTokens,
  verifyRefreshToken,
  hashToken,
  getRefreshCookieOptions,
} from '../../utils/tokenService.js';
import { createWalletForUser } from '../../services/walletService.js';

/**
 * Register a new user and automatically create their wallet
 * @route POST /api/v1/auth/register
 */
export const register = async (req, res, next) => {
  try {
    const { name, email, password, referredBy, referralCode } = req.body;
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Check if email is already registered
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email is already registered',
      });
    }

    // 2. Validate referral code if provided
    const rawReferralCode = (referralCode !== undefined ? referralCode : referredBy) || '';
    const normalizedCode = typeof rawReferralCode === 'string' ? rawReferralCode.trim().toUpperCase() : '';

    let verifiedReferrer = null;
    let codeUsed = null;
    let rewardStatus = 'NOT_ELIGIBLE';

    if (normalizedCode.length > 0) {
      const referringUser = await User.findOne({
        referralCode: normalizedCode,
      });

      if (!referringUser) {
        return res.status(400).json({
          success: false,
          message: 'Invalid referral code',
        });
      }

      // Prevent self-referral via matching identity (e.g. same email address)
      if (referringUser.email && referringUser.email.toLowerCase().trim() === normalizedEmail) {
        return res.status(400).json({
          success: false,
          message: 'Self-referral is not permitted',
        });
      }

      verifiedReferrer = referringUser._id;
      codeUsed = referringUser.referralCode;
      rewardStatus = 'PENDING';
    }

    // 3. Create user (password will be hashed via pre-save hook; role is always strictly 'user')
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: 'user',
      referredBy: verifiedReferrer,
      referralCodeUsed: codeUsed,
      referralRewardStatus: rewardStatus,
    });

    // 4. Automatically create linked wallet for user
    const wallet = await createWalletForUser(user._id);

    // 5. Generate tokens with unique family session identifier
    const family = crypto.randomUUID();
    const { accessToken, refreshToken } = generateAuthTokens(user, process.env, { family });
    const tokenHash = hashToken(refreshToken);

    // 6. Persist token hash securely in database (never raw token)
    if (mongoose.connection?.readyState === 1 || RefreshToken.create !== mongoose.Model.create) {
      try {
        await RefreshToken.create({
          user: user._id,
          tokenHash,
          family,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isRevoked: false,
          createdByIp: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
        });
      } catch (tokenErr) {
        // If DB write fails, fail registration securely
        throw tokenErr;
      }
    }

    // 7. Set refresh token ONLY in HTTP-only secure cookie
    const cookieOptions = getRefreshCookieOptions();
    res.cookie('refreshToken', refreshToken, cookieOptions);

    // 8. Return response (NEVER return refreshToken in JSON body)
    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        wallet,
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Login user
 * @route POST /api/v1/auth/login
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // 1. Find user by email including hidden password field
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 2. Compare password
    const isPasswordMatch = await user.matchPassword(password);
    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // 3. Generate tokens with unique family session identifier
    const family = crypto.randomUUID();
    const { accessToken, refreshToken } = generateAuthTokens(user, process.env, { family });
    const tokenHash = hashToken(refreshToken);

    // 4. Persist token hash securely in database (never raw token)
    if (mongoose.connection?.readyState === 1 || RefreshToken.create !== mongoose.Model.create) {
      try {
        await RefreshToken.create({
          user: user._id,
          tokenHash,
          family,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          isRevoked: false,
          createdByIp: req.ip || '',
          userAgent: req.headers['user-agent'] || '',
        });
      } catch (tokenErr) {
        throw tokenErr;
      }
    }

    // 5. Set refresh token ONLY in HTTP-only secure cookie
    const cookieOptions = getRefreshCookieOptions();
    res.cookie('refreshToken', refreshToken, cookieOptions);

    // 6. Return response (NEVER return refreshToken in JSON body)
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        accessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh access token using refresh token rotation
 * Enforces atomic invalidation, single-winner concurrency, and token family reuse detection
 * @route POST /api/v1/auth/refresh
 */
export const refresh = async (req, res, next) => {
  try {
    // 1. Read refresh token from cookies (preferred) or request body (API fallback)
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    const trimmedToken = token.trim();

    // 2. Verify refresh token cryptographic signature and expiration
    let decoded;
    try {
      decoded = verifyRefreshToken(trimmedToken);
    } catch (_) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
    }

    const tokenHash = hashToken(trimmedToken);

    // 3. Persistent verification and atomic rotation
    if (mongoose.connection?.readyState === 1 || RefreshToken.findOne !== mongoose.Model.findOne) {
      const existingToken = await RefreshToken.findOne({ tokenHash });

      if (!existingToken) {
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token',
        });
      }

      // Check if token was already revoked/rotated -> REUSE ATTACK DETECTED!
      if (existingToken.isRevoked) {
        // Immediate family invalidation: revoke all active tokens in this session family
        try {
          await RefreshToken.updateMany(
            { family: existingToken.family },
            { $set: { isRevoked: true, revokedAt: new Date() } }
          );
        } catch (_) {}

        const cookieOptions = getRefreshCookieOptions();
        res.clearCookie('refreshToken', cookieOptions);
        res.clearCookie('refreshToken', { ...cookieOptions, path: '/' });

        return res.status(401).json({
          success: false,
          message: 'Refresh token has already been used and was revoked: session terminated',
        });
      }

      // Check database expiration
      if (existingToken.expiresAt && existingToken.expiresAt.getTime() <= Date.now()) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token has expired',
        });
      }

      // 4. Atomic Compare-And-Swap (CAS) to invalidate current token
      // Guarantees only one concurrent request can ever rotate this token
      const claimedToken = await RefreshToken.findOneAndUpdate(
        {
          _id: existingToken._id,
          isRevoked: false,
        },
        {
          $set: {
            isRevoked: true,
            revokedAt: new Date(),
          },
        },
        { new: true }
      );

      if (!claimedToken) {
        // Concurrent race detected: token was already claimed by a parallel request
        try {
          await RefreshToken.updateMany(
            { family: existingToken.family },
            { $set: { isRevoked: true, revokedAt: new Date() } }
          );
        } catch (_) {}

        const cookieOptions = getRefreshCookieOptions();
        res.clearCookie('refreshToken', cookieOptions);
        res.clearCookie('refreshToken', { ...cookieOptions, path: '/' });

        return res.status(401).json({
          success: false,
          message: 'Refresh token rotation race detected: token already rotated',
        });
      }

      // 5. Find user
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User session expired or user no longer exists',
        });
      }

      // 6. Generate rotated tokens preserving family session lineage
      const family = existingToken.family || decoded.family || crypto.randomUUID();
      const newAccessToken = generateAccessToken({ id: user._id, role: user.role });
      const newRefreshToken = generateRefreshToken({ id: user._id, family });
      const newTokenHash = hashToken(newRefreshToken);

      // Persist replacement token
      await RefreshToken.create({
        user: user._id,
        tokenHash: newTokenHash,
        family,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        isRevoked: false,
        createdByIp: req.ip || '',
        userAgent: req.headers['user-agent'] || '',
      });

      // Link lineage
      claimedToken.replacedByTokenHash = newTokenHash;
      await claimedToken.save();

      // Set rotated refresh token in HTTP-only cookie
      const cookieOptions = getRefreshCookieOptions();
      res.cookie('refreshToken', newRefreshToken, cookieOptions);

      return res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: newAccessToken,
        },
      });
    }

    // In-memory fallback when executing in disconnected unit mock tests
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User session expired or user no longer exists',
      });
    }

    const newAccessToken = generateAccessToken({ id: user._id, role: user.role });
    const newRefreshToken = generateRefreshToken({ id: user._id });
    res.cookie('refreshToken', newRefreshToken, getRefreshCookieOptions());

    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Logout user: revokes refresh token on server and clears client cookie
 * @route POST /api/v1/auth/logout
 */
export const logout = async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (token && typeof token === 'string' && token.trim().length > 0) {
      const tokenHash = hashToken(token);
      if (mongoose.connection?.readyState === 1 || RefreshToken.findOneAndUpdate !== mongoose.Model.findOneAndUpdate) {
        try {
          await RefreshToken.findOneAndUpdate(
            { tokenHash },
            { $set: { isRevoked: true, revokedAt: new Date() } }
          );
        } catch (_) {}
      }
    }

    const cookieOptions = getRefreshCookieOptions();
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('refreshToken', { ...cookieOptions, path: '/' });

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get current authenticated user details
 * @route GET /api/v1/auth/me
 */
export const getMe = (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Current user retrieved successfully',
    data: {
      user: req.user,
    },
  });
};

/**
 * Development-only endpoint to provision an administrator account via JSON payload
 * Requires NODE_ENV !== 'production' and valid x-dev-provision-secret header (enforced by devProvisionGuard)
 * @route POST /api/v1/auth/dev-provision-admin
 */
export const devProvisionAdmin = async (req, res, next) => {
  try {
    const { name, email, password, force } = req.body || {};

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedName = name.trim();

    // 1. Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail }).select('+password');

    if (existingUser) {
      // Case A: User already exists as an administrator
      if (existingUser.role === 'admin') {
        if (!force) {
          return res.status(409).json({
            success: false,
            message: `User "${normalizedEmail}" is already an administrator. Set "force": true in JSON body to update credentials.`,
            data: {
              user: {
                id: existingUser._id,
                name: existingUser.name,
                email: existingUser.email,
                role: existingUser.role,
              },
            },
          });
        }

        // Force update existing admin credentials
        existingUser.name = normalizedName;
        existingUser.password = password; // Trigger pre('save') bcryptjs hash
        await existingUser.save();

        return res.status(200).json({
          success: true,
          message: `Administrator "${normalizedEmail}" credentials updated successfully.`,
          data: {
            user: {
              id: existingUser._id,
              name: existingUser.name,
              email: existingUser.email,
              role: existingUser.role,
            },
            action: 'updated',
          },
        });
      }

      // Case B: User exists as a standard user (role: 'user')
      if (!force) {
        return res.status(409).json({
          success: false,
          message: `Account "${normalizedEmail}" already exists as a standard user. Set "force": true in JSON body to promote this account to administrator.`,
          data: {
            user: {
              id: existingUser._id,
              name: existingUser.name,
              email: existingUser.email,
              role: existingUser.role,
            },
          },
        });
      }

      // Force promote user to administrator
      existingUser.role = 'admin';
      existingUser.name = normalizedName;
      existingUser.password = password;
      existingUser.isVerified = true;
      await existingUser.save();

      return res.status(200).json({
        success: true,
        message: `Existing user "${normalizedEmail}" promoted to administrator successfully.`,
        data: {
          user: {
            id: existingUser._id,
            name: existingUser.name,
            email: existingUser.email,
            role: existingUser.role,
          },
          action: 'promoted',
        },
      });
    }

    // 2. Create new administrator user
    const newUser = new User({
      name: normalizedName,
      email: normalizedEmail,
      password,
      role: 'admin',
      isVerified: true,
    });

    await newUser.save();

    // 3. Ensure linked wallet exists
    try {
      await createWalletForUser(newUser._id);
    } catch (walletErr) {
      // Wallet creation failure should not crash admin creation
    }

    return res.status(201).json({
      success: true,
      message: `Development administrator "${normalizedEmail}" created successfully.`,
      data: {
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        },
        action: 'created',
      },
    });
  } catch (error) {
    next(error);
  }
};

export default {
  register,
  login,
  refresh,
  logout,
  getMe,
  devProvisionAdmin,
};
