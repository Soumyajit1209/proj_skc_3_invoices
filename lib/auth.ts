import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { Database, MasterUser } from './db';

const JWT_SECRET: Secret = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];

export interface User {
  id: number;
  username: string;
  fullName: string;
  email: string;
  role: string;
  permissions: string[];
}

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

// Authenticate user with username and password
export async function authenticateUser(username: string, password: string): Promise<User | null> {
  try {
    const userQuery = `
      SELECT user_id, user_name, name_display, user_email, role, password, status
      FROM master_user 
      WHERE user_name = ? AND status = 1
    `;
    
    const user = await Database.queryFirst<MasterUser>(userQuery, [username]);
    
    if (!user) {
      return null;
    }

    // Plain text password comparison
    const isPasswordValid = password === user.password;
    if (!isPasswordValid) {
      return null;
    }

    const permissions = await getUserPermissions(user.user_id, user.role);

    return {
      id: user.user_id,
      username: user.user_name,
      fullName: user.name_display,
      email: user.user_email,
      role: user.role,
      permissions
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return null;
  }
}

// Get user permissions based on department access
async function getUserPermissions(userId: number, role: string): Promise<string[]> {
  try {
    const permissionsQuery = `
      SELECT DISTINCT d.department_name, da.department_access_id
      FROM master_user_department_access da
      JOIN master_user_department d ON da.department_id = d.department_id
      WHERE da.user_id = ?
    `;
    
    const departments = await Database.query(permissionsQuery, [userId]);
    const permissions = departments.map(dept => dept.department_name);

    if (role === 'admin') {
      permissions.push('SALES', 'PURCHASE', 'INVENTORY', 'MASTERS', 'REPORTS');
    } else if (role === 'manager') {
      permissions.push('SALES', 'INVENTORY', 'REPORTS');
    } else {
      permissions.push('SALES');
    }

    return Array.from(new Set(permissions)); // avoids --downlevelIteration issue
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return ['SALES'];
  }
}

// Generate JWT token
export function generateToken(user: User): string {
  try {
    const payload: TokenPayload = {
      userId: user.id,
      username: user.username,
      role: user.role
    };

    const options: SignOptions = { expiresIn: JWT_EXPIRES_IN };

    return jwt.sign(payload, JWT_SECRET, options);
  } catch (error) {
    console.error('Token generation error:', error);
    throw new Error('Failed to generate token');
  }
}

// Verify JWT token - with better error handling
export function verifyToken(token: string): User | null {
  try {
    if (!token) {
      return null;
    }

    // Check if we're in edge runtime (which doesn't support crypto)
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      console.warn('JWT verification skipped: crypto not available in edge runtime');
      // For development/testing, you might want to decode without verification
      // This is NOT secure for production!
      try {
        const decoded = jwt.decode(token) as TokenPayload;
        if (decoded && decoded.userId) {
          return {
            id: decoded.userId,
            username: decoded.username,
            fullName: '',
            email: '',
            role: decoded.role,
            permissions: []
          };
        }
      } catch (decodeError) {
        console.error('Token decode error:', decodeError);
      }
      return null;
    }

    const payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
    
    return {
      id: payload.userId,
      username: payload.username,
      fullName: '',
      email: '',
      role: payload.role,
      permissions: []
    };
  } catch (error) {
    console.error('Token verification error:', error);
    return null;
  }
}

// Extract token from request
export function getTokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  return null;
}

// Check if user has specific permission
export function hasPermission(user: User, module: string, action: 'read' | 'write' | 'delete'): boolean {
  if (user.role === 'admin') {
    return true;
  }
  
  if (user.role === 'manager') {
    return action !== 'delete' && ['SALES', 'INVENTORY', 'REPORTS'].includes(module);
  }
  
  return action === 'read' && module === 'SALES';
}

// Create new user (plain text password)
export async function createUser(userData: {
  username: string;
  password: string;
  fullName: string;
  email: string;
  role: string;
  phone?: string;
  designation?: string;
}): Promise<number> {
  try {
    const insertQuery = `
      INSERT INTO master_user (
        user_name, password, name_display, user_email, role, 
        contact_no, designation, status, verify_otp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
    `;
    
    const userId = await Database.insert(insertQuery, [
      userData.username,
      userData.password, // storing plain text
      userData.fullName,
      userData.email,
      userData.role,
      userData.phone || '',
      userData.designation || '',
    ]);
    
    return userId;
  } catch (error) {
    console.error('Create user error:', error);
    throw error;
  }
}

// Update user
export async function updateUser(userId: number, userData: Partial<{
  username: string;
  fullName: string;
  email: string;
  role: string;
  phone: string;
  designation: string;
  status: number;
}>): Promise<boolean> {
  try {
    const fields = [];
    const values = [];
    
    if (userData.username) {
      fields.push('user_name = ?');
      values.push(userData.username);
    }
    if (userData.fullName) {
      fields.push('name_display = ?');
      values.push(userData.fullName);
    }
    if (userData.email) {
      fields.push('user_email = ?');
      values.push(userData.email);
    }
    if (userData.role) {
      fields.push('role = ?');
      values.push(userData.role);
    }
    if (userData.phone) {
      fields.push('contact_no = ?');
      values.push(userData.phone);
    }
    if (userData.designation) {
      fields.push('designation = ?');
      values.push(userData.designation);
    }
    if (userData.status !== undefined) {
      fields.push('status = ?');
      values.push(userData.status);
    }
    
    if (fields.length === 0) {
      return false;
    }
    
    values.push(userId);
    
    const updateQuery = `UPDATE master_user SET ${fields.join(', ')} WHERE user_id = ?`;
    const affectedRows = await Database.execute(updateQuery, values);
    
    return affectedRows > 0;
  } catch (error) {
    console.error('Update user error:', error);
    throw error;
  }
}

// Get user by ID
export async function getUserById(userId: number): Promise<User | null> {
  try {
    const userQuery = `
      SELECT user_id, user_name, name_display, user_email, role, status
      FROM master_user 
      WHERE user_id = ?
    `;
    
    const user = await Database.queryFirst<MasterUser>(userQuery, [userId]);
    
    if (!user) {
      return null;
    }

    const permissions = await getUserPermissions(user.user_id, user.role);

    return {
      id: user.user_id,
      username: user.user_name,
      fullName: user.name_display,
      email: user.user_email,
      role: user.role,
      permissions
    };
  } catch (error) {
    console.error('Get user error:', error);
    return null;
  }
}