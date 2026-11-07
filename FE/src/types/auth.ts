export type Role = 'USER' | 'SELLER' | 'ADMIN';

export interface User {
  id: number;
  email: string;
  fullName: string | null;
  role: Role;
  isActive: boolean;
}

export interface SessionResponse {
  user: User;
  accessToken: string;
}

// TODO: Mô hình multi-role/capability đang chờ PR nghiệp vụ riêng.
