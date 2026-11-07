import { createContext, useContext } from 'react';
import type { User, SessionResponse } from '../types/auth';

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (session: SessionResponse) => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  applyProfile?: (user: User, sessionVersion: number) => void;
  endSession?: (sessionVersion: number) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
