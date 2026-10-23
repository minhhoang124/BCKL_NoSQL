import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { Loading } from '../components/Loading/Loading';
import { hasRole } from '../utils/roles';
import { hasBuyerAccess } from '../utils/buyerAccess';
import type { Role } from '../types/auth';
import type { ReactNode } from 'react';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: Role[];
  buyerAccess?: boolean;
}

export function ProtectedRoute({ children, allowedRoles, buyerAccess = false }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Loading fullScreen />;
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && !hasRole(user, allowedRoles) &&
    !(buyerAccess && allowedRoles.includes('USER') && hasBuyerAccess(user))) {
    return <Navigate to="/" replace />; // Or to a 'Forbidden' page
  }

  return children;
}
