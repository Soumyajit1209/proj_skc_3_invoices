export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';

// GET /api/invoices - List all invoices with pagination
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

    // Build the base query for listing invoices
    const baseQuery = `
      SELECT 
        ti.tax_invoice_id as id,
        ti.invoice_no as invoice_number,
        ti.invoice_date,
        ti.grand_total_amt as net_amount,
        ti.irn_no as irn,
        CASE 
          WHEN ti.irn_no IS NOT NULL AND ti.irn_no != '' THEN true
          ELSE false
        END as is_submitted,
        mc.customer_name,
        mc.customer_gst_in as customer_gstin
      FROM tax_invoice ti
      JOIN master_customer mc ON ti.customer_id = mc.customer_id
    `;

    let searchCondition = '';
    let searchParamsArray: any[] = [];

    if (search) {
      searchCondition = '(ti.invoice_no LIKE ? OR mc.customer_name LIKE ?)';
      const searchPattern = `%${search}%`;
      searchParamsArray = [searchPattern, searchPattern];
    }

    const { sql, countSql, params } = Database.buildPaginationQuery(
      baseQuery, page, limit, searchCondition, searchParamsArray
    );

    // Add ORDER BY before LIMIT in the base query
    const { sql, countSql, params } = Database.buildPaginationQuery(
      baseQuery + ' ORDER BY ti.tax_invoice_id DESC', page, limit, searchCondition, searchParamsArray
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
      is_submitted: invoice.is_submitted,
      irn: invoice.irn,
      customer: {
        customer_name: invoice.customer_name,
        customer_gstin: invoice.customer_gstin
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

    return NextResponse.json(result);
  } catch (error) {
    console.error('Invoices GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/invoices - Create a new invoice
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
    const { customer_id, invoice_date, place_of_supply, items, submit_to_gst } = body;

    if (!customer_id || !invoice_date || !items || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Generate invoice number (you might want to implement a better sequence)
    const lastInvoice = await Database.queryFirst(
      'SELECT invoice_no FROM tax_invoice ORDER BY tax_invoice_id DESC LIMIT 1'
    );
    
    let invoiceNumber;
    if (lastInvoice && lastInvoice.invoice_no) {
      const lastNumber = parseInt(lastInvoice.invoice_no.split('-').pop() || '0');
      invoiceNumber = `INV-${String(lastNumber + 1).padStart(6, '0')}`;
    } else {
      invoiceNumber = 'INV-000001';
    }

    // Calculate totals
    let grandTotalTaxableAmt = 0;
    let grandTotalCgstAmt = 0;
    let grandTotalSgstAmt = 0;
    let grandTotalAmt = 0;

    items.forEach((item: any) => {
      const taxableAmount = item.quantity * item.rate;
      const cgstAmt = (taxableAmount * item.gst_rate) / 200; // Half of GST rate for CGST
      const sgstAmt = (taxableAmount * item.gst_rate) / 200; // Half of GST rate for SGST
      const totalAmount = taxableAmount + cgstAmt + sgstAmt;

      grandTotalTaxableAmt += taxableAmount;
      grandTotalCgstAmt += cgstAmt;
      grandTotalSgstAmt += sgstAmt;
      grandTotalAmt += totalAmount;
    });

    // Start transaction
    const queries = [];

    // Insert invoice header
    const invoiceQuery = {
      sql: `
        INSERT INTO tax_invoice (
          customer_id, invoice_no, invoice_date, place_supply,
          grand_total_taxable_amt, grand_total_cgst_amt, grand_total_sgst_amt, grand_total_amt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      params: [
        customer_id, invoiceNumber, invoice_date, place_of_supply,
        grandTotalTaxableAmt, grandTotalCgstAmt, grandTotalSgstAmt, grandTotalAmt
      ]
    };

    queries.push(invoiceQuery);

    const results = await Database.transaction(queries);
    const invoiceId = (results[0] as any).insertId;

    // Insert invoice details
    for (const item of items) {
      const taxableAmount = item.quantity * item.rate;
      const cgstRate = item.gst_rate / 2; // Half for CGST
      const sgstRate = item.gst_rate / 2; // Half for SGST
      const cgstAmt = (taxableAmount * cgstRate) / 100;
      const sgstAmt = (taxableAmount * sgstRate) / 100;
      const totalAmount = taxableAmount + cgstAmt + sgstAmt;

      await Database.insert(`
        INSERT INTO tax_invoice_details (
          tax_invoice_id, prod_id, hsn_sac_code, qty, rate, per_id,
          taxable_amt, cgst_rate, cgst_amt, sgst_rate, sgst_amt, total_amount
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        invoiceId, null, item.hsn_code, item.quantity, item.rate, 1, // per_id = 1 for default unit
        taxableAmount, cgstRate, cgstAmt, sgstRate, sgstAmt, totalAmount
      ]);
    }

    // If submit_to_gst is true, you would implement GST submission logic here
    if (submit_to_gst) {
      // TODO: Implement GST portal submission
      console.log('GST submission requested for invoice:', invoiceNumber);
    }

    return NextResponse.json({ 
      success: true, 
      invoice_id: invoiceId,
      invoice_number: invoiceNumber
    }, { status: 201 });

  } catch (error) {
    console.error('Invoice creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}