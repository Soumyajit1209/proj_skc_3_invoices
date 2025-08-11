'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Table, { TableColumn } from '@/components/Table';
import Form, { FormField } from '@/components/Form';
import axios from 'axios';

const MASTER_TYPES = [
  { key: 'customers', label: 'Customers', icon: '👥' },
  { key: 'vendors', label: 'Vendors', icon: '🏢' },
  { key: 'raw-materials', label: 'Raw Materials', icon: '📦' },
  { key: 'finished-products', label: 'Finished Products', icon: '🎁' },
  { key: 'godowns', label: 'Godowns', icon: '🏪' },
  { key: 'hsn-codes', label: 'HSN/SAC Codes', icon: '🏷️' },
  { key: 'units', label: 'Units', icon: '📏' },
  { key: 'users', label: 'Users', icon: '👤' }
];

export default function MastersPage() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState('customers');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
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
  }, [router]);

  useEffect(() => {
    fetchData(1);
  }, [selectedType]);

  const fetchData = async (page: number) => {
    setLoading(true);
    try {
      const response = await axios.get(`/api/masters/${selectedType}`, {
        params: { page, limit: pagination.itemsPerPage }
      });
      setData(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (page: number) => {
    fetchData(page);
  };

  const handleEdit = (item: any) => {
    setEditItem(item);
    setShowForm(true);
  };

  const handleDelete = async (item: any) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
      await axios.delete(`/api/masters/${selectedType}?id=${item.id}`);
      fetchData(pagination.currentPage);
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Delete failed. Please try again.');
    }
  };

  const handleSubmit = async (formData: Record<string, any>) => {
    try {
      if (editItem) {
        await axios.put(`/api/masters/${selectedType}?id=${editItem.id}`, formData);
      } else {
        await axios.post(`/api/masters/${selectedType}`, formData);
      }
      setShowForm(false);
      setEditItem(null);
      fetchData(pagination.currentPage);
    } catch (error) {
      console.error('Submit failed:', error);
      alert('Operation failed. Please try again.');
    }
  };

  const getColumns = (): TableColumn[] => {
    switch (selectedType) {
      case 'customers':
        return [
          { key: 'customer_name', label: 'Name', sortable: true },
          { key: 'customer_email', label: 'Email' },
          { key: 'customer_phone', label: 'Phone' },
          { key: 'customer_gstin', label: 'GSTIN' },
          { key: 'customer_city', label: 'City' }
        ];
      case 'vendors':
        return [
          { key: 'vendor_name', label: 'Name', sortable: true },
          { key: 'vendor_email', label: 'Email' },
          { key: 'vendor_phone', label: 'Phone' },
          { key: 'vendor_gstin', label: 'GSTIN' },
          { key: 'vendor_city', label: 'City' }
        ];
      case 'raw-materials':
        return [
          { key: 'raw_material_name', label: 'Name', sortable: true },
          { key: 'raw_material_code', label: 'Code' },
          { 
            key: 'hsnSacCode', 
            label: 'HSN Code', 
            render: (value) => value?.code || 'N/A' 
          }
        ];
      case 'finished-products':
        return [
          { key: 'finished_product_name', label: 'Name', sortable: true },
          { key: 'finished_product_code', label: 'Code' },
          { 
            key: 'hsnSacCode', 
            label: 'HSN Code', 
            render: (value) => value?.code || 'N/A' 
          }
        ];
      case 'godowns':
        return [
          { key: 'godown_name', label: 'Name', sortable: true },
          { key: 'godown_code', label: 'Code' }
        ];
      case 'hsn-codes':
        return [
          { key: 'code', label: 'Code', sortable: true },
          { key: 'description', label: 'Description' },
          { key: 'gst_rate', label: 'GST Rate (%)', render: (value) => `${value}%` }
        ];
      case 'units':
        return [
          { key: 'unit_name', label: 'Name', sortable: true },
          { key: 'unit_code', label: 'Code' }
        ];
      case 'users':
        return [
          { key: 'username', label: 'Username', sortable: true },
          { key: 'full_name', label: 'Full Name' },
          { key: 'email', label: 'Email' },
          { key: 'is_active', label: 'Status', render: (value) => value ? 'Active' : 'Inactive' }
        ];
      default:
        return [];
    }
  };

  const getFormFields = (): FormField[] => {
    switch (selectedType) {
      case 'customers':
        return [
          { name: 'customer_name', label: 'Customer Name', type: 'text', required: true },
          { name: 'customer_address', label: 'Address', type: 'textarea', required: true },
          { name: 'customer_city', label: 'City', type: 'text', required: true },
          { name: 'customer_state', label: 'State', type: 'text', required: true },
          { name: 'customer_pincode', label: 'Pincode', type: 'text', required: true },
          { name: 'customer_phone', label: 'Phone', type: 'text', required: true },
          { name: 'customer_email', label: 'Email', type: 'email', required: true },
          { name: 'customer_gstin', label: 'GSTIN', type: 'text', required: true },
          { name: 'customer_pan', label: 'PAN', type: 'text', required: true }
        ];
      case 'vendors':
        return [
          { name: 'vendor_name', label: 'Vendor Name', type: 'text', required: true },
          { name: 'vendor_address', label: 'Address', type: 'textarea', required: true },
          { name: 'vendor_city', label: 'City', type: 'text', required: true },
          { name: 'vendor_state', label: 'State', type: 'text', required: true },
          { name: 'vendor_pincode', label: 'Pincode', type: 'text', required: true },
          { name: 'vendor_phone', label: 'Phone', type: 'text', required: true },
          { name: 'vendor_email', label: 'Email', type: 'email', required: true },
          { name: 'vendor_gstin', label: 'GSTIN', type: 'text', required: true },
          { name: 'vendor_pan', label: 'PAN', type: 'text', required: true }
        ];
      case 'raw-materials':
        return [
          { name: 'raw_material_name', label: 'Material Name', type: 'text', required: true },
          { name: 'raw_material_code', label: 'Material Code', type: 'text', required: true },
          { name: 'hsn_sac_code_id', label: 'HSN Code ID', type: 'number', required: true }
        ];
      case 'godowns':
        return [
          { name: 'godown_name', label: 'Godown Name', type: 'text', required: true },
          { name: 'godown_code', label: 'Godown Code', type: 'text', required: true }
        ];
      case 'hsn-codes':
        return [
          { name: 'code', label: 'HSN/SAC Code', type: 'text', required: true },
          { name: 'description', label: 'Description', type: 'textarea', required: true },
          { name: 'gst_rate', label: 'GST Rate (%)', type: 'number', required: true }
        ];
      case 'units':
        return [
          { name: 'unit_name', label: 'Unit Name', type: 'text', required: true },
          { name: 'unit_code', label: 'Unit Code', type: 'text', required: true }
        ];
      default:
        return [];
    }
  };

  return (
    <div>
      <Navbar />
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Masters Management</h1>
            <button
              onClick={() => {
                setEditItem(null);
                setShowForm(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium"
            >
              Add New
            </button>
          </div>

          {/* Master Type Selection */}
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {MASTER_TYPES.map(type => (
              <button
                key={type.key}
                onClick={() => setSelectedType(type.key)}
                className={`p-3 rounded-lg text-center transition-colors ${
                  selectedType === type.key
                    ? 'bg-blue-100 border-2 border-blue-500 text-blue-700'
                    : 'bg-white border-2 border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="text-2xl mb-1">{type.icon}</div>
                <div className="text-xs font-medium">{type.label}</div>
              </button>
            ))}
          </div>

          {/* Data Table */}
          <div className="bg-white rounded-lg shadow">
            <Table
              columns={getColumns()}
              data={data}
              loading={loading}
              pagination={{
                ...pagination,
                onPageChange: handlePageChange
              }}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          </div>

          {/* Form Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">
                      {editItem ? 'Edit' : 'Add New'} {MASTER_TYPES.find(t => t.key === selectedType)?.label}
                    </h2>
                    <button
                      onClick={() => {
                        setShowForm(false);
                        setEditItem(null);
                      }}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <Form
                    fields={getFormFields()}
                    onSubmit={handleSubmit}
                    initialData={editItem || {}}
                    submitLabel={editItem ? 'Update' : 'Create'}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}