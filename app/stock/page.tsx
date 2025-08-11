'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Table, { TableColumn } from '@/components/Table';
import axios from 'axios';

export default function StockPage() {
  const router = useRouter();
  const [stockData, setStockData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedGodown, setSelectedGodown] = useState('');
  const [godowns, setGodowns] = useState<any[]>([]);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalItems: 0,
    itemsPerPage: 50
  });

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/');
      return;
    }
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    fetchGodowns();
    fetchStock(1);
  }, [router, selectedGodown]);

  const fetchGodowns = async () => {
    try {
      const response = await axios.get('/api/masters/godowns');
      setGodowns(response.data.data);
    } catch (error) {
      console.error('Failed to fetch godowns:', error);
    }
  };

  const fetchStock = async (page: number) => {
    setLoading(true);
    try {
      const params: any = { page, limit: pagination.itemsPerPage };
      if (selectedGodown) {
        params.godown_id = selectedGodown;
      }

      const response = await axios.get('/api/stock', { params });
      setStockData(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Failed to fetch stock:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    fetchStock(page);
  };

  const columns: TableColumn[] = [
    { 
      key: 'godown', 
      label: 'Godown', 
      render: (value) => value?.godown_name || 'N/A'
    },
    { 
      key: 'rawMaterial', 
      label: 'Item Name', 
      render: (value, row) => {
        if (row.rawMaterial) {
          return row.rawMaterial.raw_material_name;
        } else if (row.finishedProduct) {
          return row.finishedProduct.finished_product_name;
        }
        return 'N/A';
      }
    },
    { 
      key: 'rawMaterial', 
      label: 'Item Code', 
      render: (value, row) => {
        if (row.rawMaterial) {
          return row.rawMaterial.raw_material_code;
        } else if (row.finishedProduct) {
          return row.finishedProduct.finished_product_code;
        }
        return 'N/A';
      }
    },
    { 
      key: 'quantity', 
      label: 'Quantity', 
      render: (value) => Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })
    },
    { 
      key: 'unit', 
      label: 'Unit', 
      render: (value) => value?.unit_name || 'N/A'
    },
    { 
      key: 'rate', 
      label: 'Rate', 
      render: (value) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    },
    { 
      key: 'amount', 
      label: 'Amount', 
      render: (value) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    },
    {
      key: 'rawMaterial',
      label: 'HSN Code',
      render: (value, row) => {
        if (row.rawMaterial?.hsnSacCode) {
          return row.rawMaterial.hsnSacCode.code;
        } else if (row.finishedProduct?.hsnSacCode) {
          return row.finishedProduct.hsnSacCode.code;
        }
        return 'N/A';
      }
    },
    {
      key: 'created_at',
      label: 'Updated',
      render: (value) => new Date(value).toLocaleDateString('en-IN')
    }
  ];

  return (
    <div>
      <Navbar />
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Stock Management</h1>
            <div className="flex space-x-4">
              <select
                value={selectedGodown}
                onChange={(e) => setSelectedGodown(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Godowns</option>
                {godowns.map(godown => (
                  <option key={godown.id} value={godown.id}>
                    {godown.godown_name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => router.push('/stock/stockout')}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg font-medium"
              >
                Stock Out
              </button>
              <button
                onClick={() => router.push('/stock/return')}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium"
              >
                Return
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Total Items</p>
                  <p className="text-2xl font-semibold text-gray-900">{pagination.totalItems}</p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">In Stock</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stockData.filter(item => Number(item.quantity) > 0).length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Low Stock</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stockData.filter(item => Number(item.quantity) < 10 && Number(item.quantity) > 0).length}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-lg">
              <div className="flex items-center">
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-500">Out of Stock</p>
                  <p className="text-2xl font-semibold text-gray-900">
                    {stockData.filter(item => Number(item.quantity) === 0).length}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <Table
              columns={columns}
              data={stockData}
              loading={loading}
              pagination={{
                ...pagination,
                onPageChange: handlePageChange
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}