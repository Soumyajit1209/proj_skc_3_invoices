'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import Table, { TableColumn } from '@/components/Table';
import Form, { FormField } from '@/components/Form';
import axios from 'axios';

interface Invoice {
  id: number;
  invoice_number: string;
  invoice_date: string;
  customer: {
    customer_name: string;
    customer_gstin: string;
  };
  net_amount: number;
  is_submitted: boolean;
  irn?: string;
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [customers, setCustomers] = useState<any[]>([]);
  const [hsnCodes, setHsnCodes] = useState<any[]>([]);
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
    fetchInvoices(1);
    fetchMasterData();
  }, [router]);

  const fetchInvoices = async (page: number) => {
    setLoading(true);
    try {
      const response = await axios.get('/api/invoices', {
        params: { page, limit: pagination.itemsPerPage }
      });
      setInvoices(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMasterData = async () => {
    try {
      const [customersRes, hsnRes] = await Promise.all([
        axios.get('/api/masters/customers'),
        axios.get('/api/masters/hsn-codes')
      ]);
      setCustomers(customersRes.data.data);
      setHsnCodes(hsnRes.data.data);
    } catch (error) {
      console.error('Failed to fetch master data:', error);
    }
  };

  const handleDownloadPDF = async (invoice: Invoice) => {
    try {
      const response = await axios.get(`/api/invoices/${invoice.id}/pdf`, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Invoice-${invoice.invoice_number}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download PDF:', error);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  const handlePageChange = (page: number) => {
    fetchInvoices(page);
  };

  const columns: TableColumn[] = [
    { key: 'invoice_number', label: 'Invoice No.', sortable: true },
    {
      key: 'invoice_date',
      label: 'Date',
      render: (value) => new Date(value).toLocaleDateString('en-IN')
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (value) => value.customer_name
    },
    {
      key: 'net_amount',
      label: 'Amount',
      render: (value) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
    },
    {
      key: 'is_submitted',
      label: 'GST Status',
      render: (value) => (
        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${value ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
          }`}>
          {value ? 'Submitted' : 'Pending'}
        </span>
      )
    },
    {
      key: 'irn',
      label: 'IRN',
      render: (value) => value ? value.substring(0, 20) + '...' : 'N/A'
    }
  ];

 const invoiceFormFields: FormField[] = [
  {
    name: 'customer_id',
    label: 'Customer Company',
    type: 'select',
    required: true,
    // Fixed: Use customer_company_name with fallback to customer_name
    options: customers.map(c => ({ 
      value: c.customer_id.toString(), 
      label: c.customer_company_name || c.customer_name || `ID: ${c.customer_id}`
    }))
  },
  {
    name: 'invoice_date',
    label: 'Invoice Date',
    type: 'date',
    required: true,
    defaultValue: new Date().toISOString().split('T')[0]
  },
  {
    name: 'place_of_supply',
    label: 'Place of Supply (State Code)',
    type: 'text',
    required: true,
    placeholder: 'e.g., 19 for West Bengal'
  },
  {
    name: 'submit_to_gst',
    label: 'Submit to GST',
    type: 'select',
    options: [
      { value: 'false', label: 'No - Save as Draft' },
      { value: 'true', label: 'Yes - Submit to GST Portal' }
    ],
    defaultValue: 'false'
  }
];

  // Alternative approach: Show both company name and customer name for better clarity
  const invoiceFormFieldsAlternative: FormField[] = [
    {
      name: 'customer_id',
      label: 'Customer',
      type: 'select',
      required: true,
      // Show both company name and customer name for better identification
      options: customers.map(c => ({
        value: c.customer_id.toString(),
        label: c.customer_company_name
          ? `${c.customer_company_name} (${c.customer_name})`
          : c.customer_name || `Customer ID: ${c.customer_id}`
      }))
    },
  ]

  const [invoiceItems, setInvoiceItems] = useState([
    {
      item_name: '',
      hsn_code: '',
      quantity: 1,
      unit: 'NOS',
      rate: 0,
      gst_rate: 18
    }
  ]);

  const addInvoiceItem = () => {
    setInvoiceItems([
      ...invoiceItems,
      {
        item_name: '',
        hsn_code: '',
        quantity: 1,
        unit: 'NOS',
        rate: 0,
        gst_rate: 18
      }
    ]);
  };

  const removeInvoiceItem = (index: number) => {
    if (invoiceItems.length > 1) {
      setInvoiceItems(invoiceItems.filter((_, i) => i !== index));
    }
  };

  const updateInvoiceItem = (index: number, field: string, value: any) => {
    const updatedItems = [...invoiceItems];
    updatedItems[index] = { ...updatedItems[index], [field]: value };
    setInvoiceItems(updatedItems);
  };

  const calculateItemTotal = (item: any) => {
    const amount = item.quantity * item.rate;
    const gstAmount = (amount * item.gst_rate) / 100;
    return amount + gstAmount;
  };

  const calculateInvoiceTotal = () => {
    return invoiceItems.reduce((total, item) => total + calculateItemTotal(item), 0);
  };

  const handleCreateInvoice = async (formData: Record<string, any>) => {
    try {
      const invoiceData = {
        ...formData,
        items: invoiceItems
      };

      await axios.post('/api/invoices', invoiceData);
      setShowForm(false);
      setInvoiceItems([{
        item_name: '',
        hsn_code: '',
        quantity: 1,
        unit: 'NOS',
        rate: 0,
        gst_rate: 18
      }]);
      fetchInvoices(pagination.currentPage);
      alert('Invoice created successfully!');
    } catch (error) {
      console.error('Failed to create invoice:', error);
      alert('Failed to create invoice. Please try again.');
    }
  };

  return (
    <div>
      <Navbar />
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Tax Invoices</h1>
            <button
              onClick={() => setShowForm(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium"
            >
              Create Invoice
            </button>
          </div>

          <div className="bg-white rounded-lg shadow">
            <Table
              columns={columns}
              data={invoices}
              loading={loading}
              pagination={{
                ...pagination,
                onPageChange: handlePageChange
              }}
              onView={(invoice) => handleDownloadPDF(invoice)}
            />
          </div>

          {/* Create Invoice Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold">Create New Invoice</h2>
                    <button
                      onClick={() => setShowForm(false)}
                      className="text-gray-500 hover:text-gray-700"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="space-y-6">
                    {/* Invoice Header Form */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {invoiceFormFields.map(field => (
                        <div key={field.name} className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700">
                            {field.label}
                            {field.required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          {field.type === 'select' ? (
                            <select
                              name={field.name}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                              defaultValue={field.defaultValue}
                            >
                              {field.options?.map(option => (
                                <option key={option.value.toString()} value={option.value.toString()}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={field.type}
                              name={field.name}
                              defaultValue={field.defaultValue}
                              placeholder={field.placeholder}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Invoice Items */}
                    <div>
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-medium">Invoice Items</h3>
                        <button
                          type="button"
                          onClick={addInvoiceItem}
                          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm"
                        >
                          Add Item
                        </button>
                      </div>

                      <div className="space-y-4">
                        {invoiceItems.map((item, index) => (
                          <div key={index} className="border border-gray-200 p-4 rounded-lg">
                            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-2">
                              <div>
                                <label className="block text-sm text-gray-700 mb-1">Item Name</label>
                                <input
                                  type="text"
                                  value={item.item_name}
                                  onChange={(e) => updateInvoiceItem(index, 'item_name', e.target.value)}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                  placeholder="Item name"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-gray-700 mb-1">HSN Code</label>
                                <select
                                  value={item.hsn_code}
                                  onChange={(e) => {
                                    updateInvoiceItem(index, 'hsn_code', e.target.value);
                                    // Auto-update GST rate when HSN is selected
                                    const selectedHsn = hsnCodes.find(hsn => hsn.hsn_sac_code === e.target.value);
                                    if (selectedHsn) {
                                      updateInvoiceItem(index, 'gst_rate', Number(selectedHsn.gst_rate));
                                    }
                                  }}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                >
                                  <option value="">Select HSN</option>
                                  {hsnCodes.map(hsn => (
                                    <option key={hsn.hsn_sac_id} value={hsn.hsn_sac_code}>
                                      {hsn.hsn_sac_code} ({hsn.gst_rate}%)
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-sm text-gray-700 mb-1">Quantity</label>
                                <input
                                  type="number"
                                  value={item.quantity}
                                  onChange={(e) => updateInvoiceItem(index, 'quantity', Number(e.target.value))}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                  min="1"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-gray-700 mb-1">Unit</label>
                                <input
                                  type="text"
                                  value={item.unit}
                                  onChange={(e) => updateInvoiceItem(index, 'unit', e.target.value)}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                  placeholder="Unit"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-gray-700 mb-1">Rate</label>
                                <input
                                  type="number"
                                  value={item.rate}
                                  onChange={(e) => updateInvoiceItem(index, 'rate', Number(e.target.value))}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                  min="0"
                                  step="0.01"
                                />
                              </div>
                              <div>
                                <label className="block text-sm text-gray-700 mb-1">GST %</label>
                                <select
                                  value={item.gst_rate}
                                  onChange={(e) => updateInvoiceItem(index, 'gst_rate', Number(e.target.value))}
                                  className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                >
                                  <option value={0}>0%</option>
                                  <option value={5}>5%</option>
                                  <option value={12}>12%</option>
                                  <option value={18}>18%</option>
                                  <option value={28}>28%</option>
                                </select>
                              </div>
                            </div>
                            <div className="flex justify-between items-center">
                              <div className="text-sm text-gray-600">
                                Total: ₹{calculateItemTotal(item).toFixed(2)}
                              </div>
                              {invoiceItems.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeInvoiceItem(index)}
                                  className="text-red-600 hover:text-red-800 text-sm"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 text-right">
                        <div className="text-lg font-semibold">
                          Grand Total: ₹{calculateInvoiceTotal().toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end space-x-4">
                      <button
                        type="button"
                        onClick={() => setShowForm(false)}
                        className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const form = new FormData(document.querySelector('form') as HTMLFormElement);
                          const formData = Object.fromEntries(form.entries());
                          handleCreateInvoice(formData);
                        }}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                      >
                        Create Invoice
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


