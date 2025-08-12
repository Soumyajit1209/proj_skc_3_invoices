export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';
import { GSTEInvoiceAPI, buildEInvoicePayload } from '@/lib/gst-api';

// POST /api/invoices/[id]/einvoice - Generate E-Invoice
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'SALES', 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const invoiceId = parseInt(params.id);
    
    // Get invoice with all required details
    const invoice = await Database.queryFirst(`
      SELECT 
        ti.*,
        mc.customer_company_name,
        mc.customer_name,
        mc.customer_address,
        mc.customer_state_name,
        mc.customer_state_code,
        mc.customer_gst_in,
        mc.customer_pin_code,
        mc.customer_phone,
        mc.customer_email,
        mc.customer_legal_name,
        mc.customer_type
      FROM tax_invoice ti
      JOIN master_customer mc ON ti.customer_id = mc.customer_id
      WHERE ti.tax_invoice_id = ? AND ti.status IN ('draft', 'generated')
    `, [invoiceId]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found or already submitted' }, { status: 404 });
    }

    // Get invoice items
    const items = await Database.query(`
      SELECT 
        tid.*,
        mfp.prod_name,
        tid.product_description,
        tid.hsn_sac_code,
        tid.is_service
      FROM tax_invoice_details tid
      LEFT JOIN master_finished_product mfp ON tid.prod_id = mfp.prod_id
      WHERE tid.tax_invoice_id = ?
      ORDER BY tid.item_serial_number
    `, [invoiceId]);

    // Get company GST settings
    const gstSettings = await Database.query(`
      SELECT setting_key, setting_value 
      FROM gst_settings 
      WHERE setting_key IN (
        'company_gstin', 'company_legal_name', 'company_trade_name',
        'company_address1', 'company_address2', 'company_location',
        'company_pin_code', 'company_state_code', 'company_phone', 'company_email'
      )
    `);

    const settings: Record<string, string> = {};
    gstSettings.forEach((setting: any) => {
      settings[setting.setting_key] = setting.setting_value;
    });

    // Validate required settings
    if (!settings.company_gstin || !settings.company_legal_name) {
      return NextResponse.json({ 
        error: 'Company GST settings not configured properly' 
      }, { status: 400 });
    }

    // Build E-Invoice payload
    const eInvoiceData = {
      invoiceNumber: invoice.invoice_no,
      invoiceDate: new Date(invoice.invoice_date).toISOString().split('T')[0].split('-').reverse().join('/'),
      sellerGstin: settings.company_gstin,
      sellerName: settings.company_legal_name,
      sellerTradeName: settings.company_trade_name || '',
      sellerAddress: settings.company_address1 || '',
      sellerAddress2: settings.company_address2 || '',
      sellerCity: settings.company_location || '',
      sellerPincode: settings.company_pin_code || '400001',
      sellerStateCode: settings.company_state_code || '27',
      sellerPhone: settings.company_phone || '',
      sellerEmail: settings.company_email || '',
      
      buyerGstin: invoice.customer_gst_in,
      buyerName: invoice.customer_legal_name || invoice.customer_company_name || invoice.customer_name,
      buyerTradeName: invoice.customer_name || '',
      buyerAddress: invoice.customer_address,
      buyerCity: invoice.customer_state_name || '',
      buyerPincode: invoice.customer_pin_code?.toString() || '400001',
      buyerStateCode: invoice.customer_state_code || invoice.buyer_pos,
      buyerPhone: invoice.customer_phone || '',
      buyerEmail: invoice.customer_email || '',
      
      supplyType: invoice.supply_type || 'B2B',
      transactionType: invoice.transaction_type || 'Regular',
      reverseCharge: invoice.reverse_charge || 'N',
      
      items: items.map((item: any) => ({
        serialNumber: item.item_serial_number || 1,
        name: item.product_description || item.prod_name || 'Product',
        isService: item.is_service === 'Y',
        hsnCode: item.hsn_sac_code,
        quantity: Number(item.qty),
        unit: 'NOS', // You might want to get this from the unit table
        rate: Number(item.rate),
        amount: Number(item.taxable_amt),
        gstRate: Number((item.cgst_rate || 0) + (item.sgst_rate || 0) + (item.igst_rate || 0)),
        cgstRate: item.cgst_rate || 0,