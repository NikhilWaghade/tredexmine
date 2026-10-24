import { User } from '../../models/User.js';
import {
  generateAccessToken,
  generateAuthTokens,
  verifyRefreshToken,
} from '../../utils/tokenService.js';
import { createWalletForUser } from '../../services/walletService.js';

// Cookie options for refresh token
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
};

/**
 * Register a new user and automatically create their wallet
 * @route POST /api/v1/auth/register
 */
export const register = async (req, res, next) => {
  try {
    const { name, email, password, referredBy } = req.body;

    // 1. Check if email is already registered
    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email is already registered',
      });
    }

    // 2. Validate referral code if provided
    let verifiedReferredBy = null;
    if (referredBy) {
      const referringUser = await User.findOne({
        referralCode: referredBy.trim().toUpperCase(),
      });
      if (referringUser) {
        verifiedReferredBy = referringUser.referralCode;
      }
    }

    // 3. Create user (password will be hashed via pre-save hook; role is always strictly 'user')
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: 'user',
      referredBy: verifiedReferredBy,
    });

    // 4. Automatically create linked wallet for user
    const wallet = await createWalletForUser(user._id);

    // 5. Generate tokens
    const { accessToken, refreshToken } = generateAuthTokens(user);

    // 6. Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

    // 7. Return response with user, linked wallet, and tokens
    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        wallet,
        accessToken,
        refreshToken,
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

    // 3. Generate tokens
    const { accessToken, refreshToken } = generateAuthTokens(user);

    // 4. Set refresh token in HTTP-only cookie
    res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

    // 5. Return response
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh access token using refresh token
 * @route POST /api/v1/auth/refresh
 */
export const refresh = async (req, res, next) => {
  try {
    // 1. Read refresh token from cookies or request body
    const token = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    // 2. Verify refresh token
    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
    }

    // 3. Find user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User session expired or user no longer exists',
      });
    }

    // 4. Generate new access token
    const newAccessToken = generateAccessToken({
      id: user._id,
      role: user.role,
    });

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
 * Logout user
 * @route POST /api/v1/auth/logout
 */
export const logout = (req, res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });

  return res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
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
