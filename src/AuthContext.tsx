import React, { createContext, useContext, useEffect, useState } from 'react';
import { EduService } from './EduService';
import { AuthUser, RegisterOtpResponse, RegisterPayload } from './types';

const AUTH_EVENT_KEY = 'edumaster.auth.event';

type WindowWithProgressFlush = Window & {
  __edumasterFlushProgress?: () => Promise<void>;
};

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  isAdmin: boolean;
  login: (identifier: string, password: string, options?: { forceLogoutOtherSessions?: boolean }) => Promise<void>;
  register: (payload: RegisterPayload & { channel?: 'email' | 'sms' }) => Promise<RegisterOtpResponse>;
  updateProfile: (payload: { name: string; email: string; mobileNumber?: string | null }) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  login: async () => {},
  register: async () => ({ verificationRequired: true, challenge: { challengeId: '', channel: 'email', expiresInSeconds: 0, destination: '' } }),
  updateProfile: async () => {},
  logout: async () => {},
  refreshSession: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = async () => {
    const sessionUser = await EduService.restoreSession();
    setUser(sessionUser);
  };

  useEffect(() => {
    refreshSession().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleAuthExpired = () => {
      setUser(null);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_EVENT_KEY || !event.newValue) {
        return;
      }

      try {
        const payload = JSON.parse(event.newValue) as { type?: 'login' | 'logout' };
        if (payload.type === 'logout') {
          setUser(null);
          return;
        }

        if (payload.type === 'login') {
          void refreshSession();
        }
      } catch {
        // Ignore malformed cross-tab auth events.
      }
    };

    window.addEventListener('edumaster:auth-expired', handleAuthExpired);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('edumaster:auth-expired', handleAuthExpired);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const login = async (identifier: string, password: string, options?: { forceLogoutOtherSessions?: boolean }) => {
    const response = await EduService.login(identifier, password, options);
    setUser(response.user);
  };

  const register = async (payload: RegisterPayload & { channel?: 'email' | 'sms' }) => {
    return EduService.register(payload);
  };

  const updateProfile = async (payload: { name: string; email: string; mobileNumber?: string | null }) => {
    const response = await EduService.updateProfile(payload);
    setUser(response.user);
  };

  const logout = async () => {
    if (typeof window !== 'undefined') {
      try {
        await (window as WindowWithProgressFlush).__edumasterFlushProgress?.();
      } catch (error) {
        console.error('Failed to flush lesson progress before logout:', error);
      }
    }

    await EduService.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: user?.role === 'admin',
        login,
        register,
        updateProfile,
        logout,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
