'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

interface User {
  fullName: string;
  username: string;
  permissions: Array<{
    departmentCode: string;
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
  }>;
}

export default function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    // Get user data from localStorage or context
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/');
  };

  const hasPermission = (departmentCode: string) => {
    return user?.permissions.some(p => p.departmentCode === departmentCode && p.canRead);
  };

  const navItems = [
    { name: 'Dashboard', href: '/dashboard', permission: null },
    { name: 'Masters', href: '/masters', permission: 'MASTERS' },
    { name: 'Stock', href: '/stock', permission: 'INVENTORY' },
    { name: 'Purchases', href: '/purchases', permission: 'PURCHASE' },
    { name: 'Invoices', href: '/invoices', permission: 'SALES' },
  ].filter(item => !item.permission || hasPermission(item.permission));

  return (
    <nav className="bg-white shadow-lg border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/dashboard" className="flex-shrink-0">
              <h1 className="text-xl font-bold text-gray-900">GST Invoice System</h1>
            </Link>

            <div className="hidden md:ml-6 md:flex md:space-x-8">
              {navItems.map(item => (
                <Link
                  key={item.name}
                  href={item.href}
                  className="text-gray-500 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {user && (
              <div className="hidden md:flex items-center space-x-4">
                <span className="text-sm text-gray-700">
                  Welcome, {user.fullName}
                </span>
                <button
                  onClick={handleLogout}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Logout
                </button>
              </div>
            )}

            <div className="md:hidden">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="text-gray-500 hover:text-gray-900 focus:outline-none focus:text-gray-900 p-2"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {isMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="md:hidden">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-gray-50">
            {navItems.map(item => (
              <Link
                key={item.name}
                href={item.href}
                className="text-gray-700 hover:text-gray-900 block px-3 py-2 rounded-md text-base font-medium"
                onClick={() => setIsMenuOpen(false)}
              >
                {item.name}
              </Link>
            ))}
            {user && (
              <div className="border-t pt-4 mt-4">
                <div className="px-3 py-2 text-sm text-gray-700">
                  {user.fullName}
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full text-left text-red-600 hover:text-red-900 px-3 py-2 rounded-md text-base font-medium"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}