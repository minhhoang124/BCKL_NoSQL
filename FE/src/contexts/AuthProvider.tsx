import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { User, SessionResponse } from '../types/auth';
import { fetchApi, setAccessToken, setOnAuthFailure, refreshSession, getAuthSessionVersion, AuthSessionChangedError } from '../services/apiClient';
import { AuthContext } from './useAuth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback((session: SessionResponse) => {
    setUser(session.user);
    setAccessToken(session.accessToken, session.user.id);
    setLoading(false);
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    setAccessToken(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    setOnAuthFailure(clearAuth);
    return () => setOnAuthFailure(null);
  }, [clearAuth]);

  const refresh = useCallback(async () => {
    const version = getAuthSessionVersion();
    try {
      const session = await refreshSession(version);
      if (version === getAuthSessionVersion()) setUser(session.user);
    } catch {
      if (version === getAuthSessionVersion()) clearAuth();
    } finally {
      if (version === getAuthSessionVersion()) setLoading(false);
    }
  }, [clearAuth]);

  useEffect(() => {
    let active = true;
    const version = getAuthSessionVersion();
    // using then/catch inside useEffect to avoid synchronous state update warnings
    refreshSession(version)
      .then((session) => {
        if (active && version === getAuthSessionVersion()) setUser(session.user);
      })
      .catch(() => {
        if (active && version === getAuthSessionVersion()) clearAuth();
      })
      .finally(() => {
        if (active && version === getAuthSessionVersion()) setLoading(false);
      });
    return () => { active = false; };
  }, [clearAuth]);

  const logout = async () => {
    const version = getAuthSessionVersion();
    await fetchApi('/auth/logout', { method: 'POST', retryOnUnauthorized: false });
    if (version !== getAuthSessionVersion()) throw new AuthSessionChangedError();
    clearAuth();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
