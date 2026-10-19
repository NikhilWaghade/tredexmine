import { useState, useEffect, useCallback } from 'react';
import { authService, walletService } from '../services';
import { AuthContext } from './authContextInstance';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    return localStorage.getItem('token') || localStorage.getItem('accessToken') || null;
  });

  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  const [wallet, setWallet] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authError, setAuthError] = useState(null);

  const openAuthModal = useCallback(() => setIsAuthModalOpen(true), []);
  const closeAuthModal = useCallback(() => {
    setIsAuthModalOpen(false);
    setAuthError(null);
  }, []);

  // Fetch fresh wallet balance from backend
  const refreshWallet = useCallback(async () => {
    const currentToken = localStorage.getItem('token') || localStorage.getItem('accessToken');
    if (!currentToken) {
      setWallet(null);
      return null;
    }
    try {
      const data = await walletService.getWallet();
      if (data.success && data.wallet) {
        setWallet(data.wallet);
        window.dispatchEvent(new CustomEvent('wallet:updated', { detail: data.wallet }));
        return data.wallet;
      }
    } catch (err) {
      console.warn('[AuthContext] Failed to fetch wallet balance:', err.message);
    }
    return null;
  }, []);

  // Initialize auth session on mount
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      const currentToken = localStorage.getItem('token') || localStorage.getItem('accessToken');
      if (!currentToken) {
        if (isMounted) {
          setIsLoading(false);
          setUser(null);
          setWallet(null);
        }
        return;
      }

      try {
        const [meData, walletData] = await Promise.allSettled([
          authService.getMe(),
          walletService.getWallet(),
        ]);

        if (isMounted) {
          if (meData.status === 'fulfilled' && meData.value.success) {
            setUser(meData.value.data.user);
            localStorage.setItem('user', JSON.stringify(meData.value.data.user));
          } else {
            // Token is likely invalid or expired
            localStorage.removeItem('token');
            localStorage.removeItem('accessToken');
            localStorage.removeItem('user');
            setToken(null);
            setUser(null);
            setWallet(null);
            return;
          }

          if (walletData.status === 'fulfilled' && walletData.value.success) {
            setWallet(walletData.value.wallet);
          }
        }
      } catch (err) {
        console.error('[AuthContext] Auth initialization error:', err);
        if (isMounted) {
          setToken(null);
          setUser(null);
          setWallet(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initAuth();

    // Listen for global unauthorized events
    const handleUnauthorized = () => {
      if (isMounted) {
        setToken(null);
        setUser(null);
        setWallet(null);
      }
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      isMounted = false;
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);

  const login = async (email, password) => {
    setAuthError(null);
    try {
      const res = await authService.login(email, password);
      if (res.success && res.data) {
        const { accessToken, user: loggedUser, refreshToken } = res.data;
        localStorage.setItem('token', accessToken);
        localStorage.setItem('accessToken', accessToken);
        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        }
        localStorage.setItem('user', JSON.stringify(loggedUser));
        setToken(accessToken);
        setUser(loggedUser);
        closeAuthModal();

        // Immediately refresh wallet
        await refreshWallet();
        return { success: true, user: loggedUser };
      }
      throw new Error(res.message || 'Login failed');
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Invalid credentials';
      setAuthError(message);
      throw new Error(message, { cause: err });
    }
  };

  const register = async (userData) => {
    setAuthError(null);
    try {
      const res = await authService.register(userData);
      if (res.success && res.data) {
        const { accessToken, user: registeredUser, wallet: userWallet, refreshToken } = res.data;
        localStorage.setItem('token', accessToken);
        localStorage.setItem('accessToken', accessToken);
        if (refreshToken) {
          localStorage.setItem('refreshToken', refreshToken);
        }
        localStorage.setItem('user', JSON.stringify(registeredUser));
        setToken(accessToken);
        setUser(registeredUser);
        if (userWallet) {
          setWallet(userWallet);
        } else {
          await refreshWallet();
        }
        closeAuthModal();
        return { success: true, user: registeredUser };
      }
      throw new Error(res.message || 'Registration failed');
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Registration failed';
      setAuthError(message);
      throw new Error(message, { cause: err });
    }
  };

  const logout = async () => {
    try {
      await authService.logout();
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      setToken(null);
      setUser(null);
      setWallet(null);
    }
  };


  const value = {
    user,
    wallet,
    token,
    isAuthenticated: Boolean(token && user),
    isLoading,
    authError,
    setAuthError,
    isAuthModalOpen,
    openAuthModal,
    closeAuthModal,
    login,
    register,
    logout,
    refreshWallet,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export default AuthProvider;


