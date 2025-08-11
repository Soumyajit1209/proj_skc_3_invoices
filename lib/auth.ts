import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { prisma } from './prisma';

export interface JWTPayload {
  userId: number;
  username: string;
  fullName: string;
  permissions: {
    departmentId: number;
    departmentCode: string;
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
  }[];
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '24h' });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
  } catch {
    return null;
  }
}

export async function authenticateUser(username: string, password: string): Promise<JWTPayload | null> {
  try {
    const user = await prisma.masterUser.findUnique({
      where: { username, is_active: true },
      include: {
        departmentAccess: {
          include: {
            department: true
          }
        }
      }
    });

    if (!user || !await verifyPassword(password, user.password)) {
      return null;
    }

    const permissions = user.departmentAccess.map(access => ({
      departmentId: access.department_id,
      departmentCode: access.department.department_code,
      canRead: access.can_read,
      canWrite: access.can_write,
      canDelete: access.can_delete
    }));

    return {
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      permissions
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return null;
  }
}

export function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

export function hasPermission(user: JWTPayload, departmentCode: string, action: 'read' | 'write' | 'delete'): boolean {
  const permission = user.permissions.find(p => p.departmentCode === departmentCode);
  if (!permission) return false;

  switch (action) {
    case 'read': return permission.canRead;
    case 'write': return permission.canWrite;
    case 'delete': return permission.canDelete;
    default: return false;
  }
}