import { UserRole } from '@prisma/client';

export interface AuthUser {
  userId: string;
  role: UserRole;
}
