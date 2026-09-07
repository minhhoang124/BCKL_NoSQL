import type { Role } from '@prisma/client';

export interface JwtPayload {
  sub: number;
  email: string;
  role: Role;
  type: 'access' | 'refresh';
  jti?: string;
}

export interface AuthenticatedUser {
  userId: number;
  email: string;
  role: Role;
}

export interface PublicUser {
  id: number;
  email: string;
  fullName: string | null;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}
