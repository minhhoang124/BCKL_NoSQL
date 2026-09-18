import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User, SessionResponse } from '../types/auth';
import { fetchApi, setAccessToken, setOnAuthFailure, refreshSession } from '../services/apiClient';
import { AuthContext } from './useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback((session: SessionResponse) => {
    setUser(session.user);
    setAccessToken(session.accessToken);
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    setAccessToken(null);
  }, []);

  useEffect(() => {
    setOnAuthFailure(clearAuth);
    return () => setOnAuthFailure(null);
  }, [clearAuth]);

  const refresh = useCallback(async () => {
    try {
      const session = await refreshSession();
      login(session);
    } catch {
      clearAuth();
    } finally {
      setLoading(false);
    }
  }, [login, clearAuth]);

  useEffect(() => {
    // using then/catch inside useEffect to avoid synchronous state update warnings
    refreshSession()
      .then((session) => {
        login(session);
      })
      .catch(() => {
        clearAuth();
      })
      .finally(() => {
        setLoading(false);
      });
  }, [login, clearAuth]);

  const logout = async () => {
    await fetchApi('/auth/logout', { method: 'POST', retryOnUnauthorized: false });
    clearAuth();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
