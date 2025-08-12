// app/api/invoices/route.ts
export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';

// GET /api/invoices - List all invoices with pagination (FIXED)
export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'SALES', 'read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';

    // Check cache first
    const cacheKey = RedisCache.getCacheKey('invoices', page, limit, search);
    const cachedData = await RedisCache.get(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    // Fixed query - removed the problematic IGST column reference and fixed SQL syntax
    const baseQuery = `
      SELECT 
        ti.tax_invoice_id as id,
        ti.invoice_no as invoice_number,
        ti.invoice_date,
        ti.grand_total_amt as net_amount,
        ti.irn_no as irn,
        ti.status,
        ti.supply_type,
        ti.transaction_type,
        CASE 
          WHEN ti.irn_no IS NOT NULL AND ti.irn_no != '' THEN 1
          ELSE 0
        END as is_submitted,
        COALESCE(mc.customer_company_name, mc.customer_name) as customer_name,
        mc.customer_gst_in as customer_gstin,
        ti.grand_total_taxable_amt,
        ti.grand_total_cgst_amt,
        ti.grand_total_sgst_amt,
        ti.error_message,
        ti.error_code
      FROM tax_invoice ti
      JOIN master_customer mc ON ti.customer_id = mc.customer_id
    `;

    let searchCondition = '';
    let searchParamsArray: any[] = [];

    if (search) {
      searchCondition = '(ti.invoice_no LIKE ? OR mc.customer_name LIKE ? OR mc.customer_company_name LIKE ?)';
      const searchPattern = `%${search}%`;
      searchParamsArray = [searchPattern, searchPattern, searchPattern];
    }

    const { sql, countSql, params } = Database.buildPaginationQuery(
      baseQuery + ' ORDER BY ti.tax_invoice_id DESC', 
      page, 
      limit, 
      searchCondition, 
      searchParamsArray
    );

    const [invoices, totalResult] = await Promise.all([
      Database.query(sql, params),
      Database.queryFirst<{ total: number }>(countSql, params)
    ]);

    // Transform the data to match the expected format
    const transformedInvoices = invoices.map((invoice: any) => ({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      net_amount: Number(invoice.net_amount || 0),
      is_submitted: Boolean(invoice.is_submitted),
      irn: invoice.irn,
      status: invoice.status || 'draft',
      supply_type: invoice.supply_type,
      transaction_type: invoice.transaction_type,
      customer: {
        customer_name: invoice.customer_name,
        customer_gstin: invoice.customer_gstin
      },
      totals: {
        taxable_amount: Number(invoice.grand_total_taxable_amt || 0),
        cgst_amount: Number(invoice.grand_total_cgst_amt || 0),
        sgst_amount: Number(invoice.grand_total_sgst_amt || 0),
        igst_amount: 0 // Default to 0 since this column doesn't exist
      },
      error: {
        code: invoice.error_code,
        message: invoice.error_message
      }
    }));

    const total = totalResult?.total || 0;

    const result = {
      data: transformedInvoices,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit
      }
    };

    // Cache the result
    await RedisCache.set(cacheKey, result, 1800); // 30 minutes cache

    return NextResponse.json(result);
  } catch (error) {
    console.error('Invoices GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/invoices - Create a new invoice (ENHANCED)
export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'SALES', 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { 
      customer_id, 
      invoice_date, 
      place_of_supply, 
      items, 
      submit_to_gst = false,
      supply_type = 'B2B',
      transaction_type = 'Regular',
      reverse_charge = 'N'
    } = body;

    if (!customer_id || !invoice_date || !items || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get customer details
    const customer = await Database.queryFirst(`
      SELECT customer_gst_in, customer_state_code, customer_pin_code,
             customer_company_name, customer_name, customer_address
      FROM master_customer 
      WHERE customer_id = ?
    `, [customer_id]);

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    // Get company settings for seller details
    const companySettings = await Database.query(`
      SELECT setting_key, setting_value 
      FROM gst_settings 
      WHERE setting_key IN (
        'company_gstin', 'company_legal_name', 'company_address1', 
        'company_location', 'company_pin_code', 'company_state_code'
      )
    `);

    const settings: Record<string, string> = {};
    companySettings.forEach((setting: any) => {
      settings[setting.setting_key] = setting.setting_value;
    });

    // Generate invoice number using sequence
    const currentYear = new Date().getFullYear();
    const financialYear = `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
    
    // Get or create sequence
    let sequence = await Database.queryFirst(`
      SELECT * FROM e_invoice_sequence WHERE financial_year = ?
    `, [financialYear]);

    if (!sequence) {
      await Database.insert(`
        INSERT INTO e_invoice_sequence (financial_year, series_prefix, current_number) 
        VALUES (?, 'INV', 1)
      `, [financialYear]);
      sequence = { current_number: 1, series_prefix: 'INV' };
    }

    const invoiceNumber = `${sequence.series_prefix}${sequence.current_number.toString().padStart(6, '0')}`;

    // Update sequence
    await Database.execute(`
      UPDATE e_invoice_sequence SET current_number = current_number + 1 
      WHERE financial_year = ?
    `, [financialYear]);

    // Determine if it's interstate (IGST) or intrastate (CGST+SGST)
    const sellerStateCode = settings.company_state_code || '27';
    const buyerStateCode = customer.customer_state_code || place_of_supply;
    const isInterState = sellerStateCode !== buyerStateCode;

    // Calculate totals
    let grandTotalTaxableAmt = 0;
    let grandTotalCgstAmt = 0;
    let grandTotalSgstAmt = 0;
    let grandTotalAmt = 0;

    items.forEach((item: any) => {
      const taxableAmount = item.quantity * item.rate;
      let cgstAmt = 0, sgstAmt = 0;

      if (!isInterState) {
        cgstAmt = (taxableAmount * item.gst_rate) / 200; // Half of GST rate
        sgstAmt = (taxableAmount * item.gst_rate) / 200; // Half of GST rate
      }

      const totalAmount = taxableAmount + cgstAmt + sgstAmt;

      grandTotalTaxableAmt += taxableAmount;
      grandTotalCgstAmt += cgstAmt;
      grandTotalSgstAmt += sgstAmt;
      grandTotalAmt += totalAmount;
    });

    // Insert invoice header
    const invoiceId = await Database.insert(`
      INSERT INTO tax_invoice (
        customer_id, invoice_no, invoice_date, place_supply, supply_type, 
        transaction_type, reverse_charge, seller_legal_name, seller_address1, 
        seller_location, seller_pin_code, seller_state_code, buyer_pos, 
        buyer_pin_code, status, grand_total_taxable_amt, grand_total_cgst_amt, 
        grand_total_sgst_amt, grand_total_amt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `, [
      customer_id, invoiceNumber, invoice_date, place_of_supply, supply_type, 
      transaction_type, reverse_charge, settings.company_legal_name || 'Company Name',
      settings.company_address1 || 'Company Address', settings.company_location || 'City',
      parseInt(settings.company_pin_code) || 400001, sellerStateCode, buyerStateCode,
      customer.customer_pin_code || 400001, grandTotalTaxableAmt, grandTotalCgstAmt, 
      grandTotalSgstAmt, grandTotalAmt
    ]);

    // Insert invoice details
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const taxableAmount = item.quantity * item.rate;
      let cgstRate = 0, sgstRate = 0;
      let cgstAmt = 0, sgstAmt = 0;

      if (!isInterState) {
        cgstRate = item.gst_rate / 2;
        sgstRate = item.gst_rate / 2;
        cgstAmt = (taxableAmount * cgstRate) / 100;
        sgstAmt = (taxableAmount * sgstRate) / 100;
      }

      const totalAmount = taxableAmount + cgstAmt + sgstAmt;

      await Database.insert(`
        INSERT INTO tax_invoice_details (
          tax_invoice_id, item_serial_number, product_description, hsn_sac_code, 
          qty, unit_price, rate, per_id, assessable_amount, taxable_amt,
          cgst_rate, cgst_amt, sgst_rate, sgst_amt, total_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        invoiceId, i + 1, item.item_name || 'Product', item.hsn_code,
        item.quantity, item.rate, item.rate, 1, // per_id = 1 for default unit
        taxableAmount, taxableAmount, cgstRate, cgstAmt, sgstRate, sgstAmt, totalAmount
      ]);
    }

    // Clear cache
    await RedisCache.delPattern('invoices:*');

    return NextResponse.json({ 
      success: true, 
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
      is_interstate: isInterState,
      totals: {
        taxable_amount: grandTotalTaxableAmt,
        cgst_amount: grandTotalCgstAmt,
        sgst_amount: grandTotalSgstAmt,
        igst_amount: 0,
        total_amount: grandTotalAmt
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Invoice creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/invoices - Update invoice
export async function PUT(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'SALES', 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get('id');
    
    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const body = await request.json();

    // Check if invoice can be updated
    const invoice = await Database.queryFirst(`
      SELECT status FROM tax_invoice WHERE tax_invoice_id = ?
    `, [invoiceId]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'submitted') {
      return NextResponse.json({ error: 'Cannot update submitted invoice' }, { status: 400 });
    }

    // Update invoice
    const updateFields = [];
    const updateValues = [];

    if (body.status) {
      updateFields.push('status = ?');
      updateValues.push(body.status);
    }

    if (body.remarks) {
      updateFields.push('remarks = ?');
      updateValues.push(body.remarks);
    }

    if (updateFields.length > 0) {
      updateValues.push(invoiceId);
      await Database.execute(
        `UPDATE tax_invoice SET ${updateFields.join(', ')} WHERE tax_invoice_id = ?`,
        updateValues
      );
    }

    // Clear cache
    await RedisCache.delPattern('invoices:*');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Invoice update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/invoices - Delete invoice
export async function DELETE(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'SALES', 'delete')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get('id');
    
    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    // Check if invoice can be deleted
    const invoice = await Database.queryFirst(`
      SELECT status FROM tax_invoice WHERE tax_invoice_id = ?
    `, [invoiceId]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (invoice.status === 'submitted') {
      return NextResponse.json({ error: 'Cannot delete submitted invoice' }, { status: 400 });
    }

    // Delete invoice details first
    await Database.execute(`
      DELETE FROM tax_invoice_details WHERE tax_invoice_id = ?
    `, [invoiceId]);

    // Delete invoice
    await Database.execute(`
      DELETE FROM tax_invoice WHERE tax_invoice_id = ?
    `, [invoiceId]);

    // Clear cache
    await RedisCache.delPattern('invoices:*');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Invoice delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}