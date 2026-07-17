import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  acknowledgeAuthRecovery,
  ApiError,
  AUTH_CONTINUATION_KEY,
  AUTH_EXPIRED_EVENT,
} from '../api/client';
import { getCurrentUser, loginWithPassword, logoutSession, type CurrentUser, type UserRole } from '../api/fleet';

export type { UserRole } from '../api/fleet';

export type AuthUser = {
  id?: string;
  name: string;
  username?: string;
  role: UserRole;
  capabilities?: CurrentUser['capabilities'];
  mustChangePassword?: boolean;
  isBackendSession?: boolean;
};

type LoginInput = {
  username: string;
  password: string;
  fallbackUser: AuthUser;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AUTH_STORAGE_KEY = 'fleet-auth-user';
export const DEMO_AUTH_ENABLED = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true';
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function userFromApi(user: CurrentUser): AuthUser {
  return {
    id: user.id,
    name: user.display_name || user.full_name || user.username,
    username: user.username,
    role: user.effective_role ?? (user.capabilities?.is_app_admin ? 'admin' : user.role),
    capabilities: user.capabilities,
    mustChangePassword: Boolean(user.must_change_password),
    isBackendSession: true,
  };
}

function readStoredUser(): AuthUser | null {
  const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const user = JSON.parse(stored) as AuthUser;
    return user.name && user.role ? user : null;
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

function isBackendReachableError(error: unknown) {
  return error instanceof ApiError;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const refreshUser = useCallback(async () => {
    const currentUser = await getCurrentUser();
    setUser(userFromApi(currentUser));
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadSession() {
      try {
        const currentUser = await getCurrentUser();
        if (isMounted) {
          setUser(userFromApi(currentUser));
        }
      } catch (error) {
        if (isMounted) {
          if (isBackendReachableError(error)) {
            window.localStorage.removeItem(AUTH_STORAGE_KEY);
            setUser(null);
          } else {
            setUser(DEMO_AUTH_ENABLED ? readStoredUser() : null);
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSession();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    function handleExpired() {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      setUser(null);
      const from = `${location.pathname}${location.search}${location.hash}`;
      if (location.pathname !== '/login') {
        navigate('/login', { replace: true, state: { from, sessionExpired: true } });
      }
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
  }, [location.hash, location.pathname, location.search, navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(user),
      isLoading,
      user,
      login: async ({ username, password, fallbackUser }) => {
        try {
          const backendUser = await loginWithPassword(username, password);
          window.localStorage.removeItem(AUTH_STORAGE_KEY);
          setUser(userFromApi(backendUser));
          acknowledgeAuthRecovery();
        } catch (error) {
          if (isBackendReachableError(error) || !DEMO_AUTH_ENABLED) {
            throw error;
          }
          window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(fallbackUser));
          setUser(fallbackUser);
        }
      },
      logout: async () => {
        try {
          await logoutSession();
        } catch {
          // Local fallback sessions and expired backend sessions both clear client-side state.
        }
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        window.sessionStorage.removeItem(AUTH_CONTINUATION_KEY);
        setUser(null);
      },
      refreshUser,
    }),
    [isLoading, refreshUser, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
