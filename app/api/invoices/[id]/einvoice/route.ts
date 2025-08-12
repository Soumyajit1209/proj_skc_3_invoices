// app/api/invoices/[id]/einvoice/route.ts
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
      return NextResponse.json({ 
        error: 'Invoice not found or already submitted' 
      }, { status: 404 });
    }

    // Check if invoice total meets e-invoice threshold (₹50,000)
    const invoiceAmount = parseFloat(invoice.grand_total_amt) || 0;
    if (invoiceAmount < 50000) {
      return NextResponse.json({ 
        error: 'E-Invoice not required for amounts below ₹50,000' 
      }, { status: 400 });
    }

    // Get invoice items
    const items = await Database.query(`
      SELECT 
        tid.*,
        mfp.prod_name,
        tid.product_description,
        tid.hsn_sac_code,
        tid.is_service,
        mfpu.per_name as unit_name
      FROM tax_invoice_details tid
      LEFT JOIN master_finished_product mfp ON tid.prod_id = mfp.prod_id
      LEFT JOIN master_finished_product_unit mfpu ON tid.per_id = mfpu.per_id
      WHERE tid.tax_invoice_id = ?
      ORDER BY tid.item_serial_number
    `, [invoiceId]);

    if (!items || items.length === 0) {
      return NextResponse.json({ 
        error: 'No invoice items found' 
      }, { status: 400 });
    }

    // Get company GST settings
    const gstSettings = await Database.query(`
      SELECT setting_key, setting_value 
      FROM gst_settings 
      WHERE setting_key IN (
        'company_gstin', 'company_legal_name', 'company_trade_name',
        'company_address1', 'company_address2', 'company_location',
        'company_pin_code', 'company_state_code', 'company_phone', 
        'company_email', 'gst_api_enabled', 'gst_api_url',
        'gst_api_username', 'gst_api_password'
      ) AND is_active = 1
    `);

    const settings: Record<string, string> = {};
    gstSettings.forEach((setting: any) => {
      settings[setting.setting_key] = setting.setting_value;
    });

    // Validate required settings
    const requiredSettings = [
      'company_gstin', 'company_legal_name', 'company_address1',
      'company_location', 'company_pin_code', 'company_state_code'
    ];

    for (const key of requiredSettings) {
      if (!settings[key]) {
        return NextResponse.json({ 
          error: `Missing GST setting: ${key}` 
        }, { status: 400 });
      }
    }

    // Check if GST API is enabled
    if (settings.gst_api_enabled !== '1') {
      return NextResponse.json({ 
        error: 'GST API integration is not enabled' 
      }, { status: 400 });
    }

    // Determine if it's interstate transaction
    const sellerStateCode = settings.company_state_code;
    const buyerStateCode = invoice.customer_state_code || invoice.buyer_pos;
    const isInterState = sellerStateCode !== buyerStateCode;

    // Build E-Invoice payload
    const eInvoiceData = {
      invoiceNumber: invoice.invoice_no,
      invoiceDate: new Date(invoice.invoice_date).toISOString().split('T')[0].split('-').reverse().join('/'),
      sellerGstin: settings.company_gstin,
      sellerName: settings.company_legal_name,
      sellerTradeName: settings.company_trade_name || '',
      sellerAddress: settings.company_address1,
      sellerAddress2: settings.company_address2 || '',
      sellerCity: settings.company_location,
      sellerPincode: settings.company_pin_code,
      sellerStateCode: settings.company_state_code,
      sellerPhone: settings.company_phone || '',
      sellerEmail: settings.company_email || '',
      
      buyerGstin: invoice.customer_gst_in,
      buyerName: invoice.customer_legal_name || invoice.customer_company_name || invoice.customer_name,
      buyerTradeName: invoice.customer_name || '',
      buyerAddress: invoice.customer_address,
      buyerCity: invoice.customer_state_name || '',
      buyerPincode: invoice.customer_pin_code?.toString() || '400001',
      buyerStateCode: buyerStateCode,
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
        unit: item.unit_name || 'NOS',
        rate: Number(item.rate),
        amount: Number(item.taxable_amt),
        gstRate: Number((item.cgst_rate || 0) + (item.sgst_rate || 0) + (item.igst_rate || 0)),
        cgstRate: Number(item.cgst_rate || 0),
        cgstAmount: Number(item.cgst_amt || 0),
        sgstRate: Number(item.sgst_rate || 0),
        sgstAmount: Number(item.sgst_amt || 0),
        igstRate: Number(item.igst_rate || 0),
        igstAmount: Number(item.igst_amount || 0),
        totalAmount: Number(item.total_amount)
      })),
      
      totalAmount: Number(invoice.grand_total_taxable_amt || 0),
      cgstAmount: Number(invoice.grand_total_cgst_amt || 0),
      sgstAmount: Number(invoice.grand_total_sgst_amt || 0),
      igstAmount: 0, // Since column doesn't exist in current schema
      netAmount: Number(invoice.grand_total_amt || 0),
      
      isInterState: isInterState,
      placeOfSupply: invoice.place_supply || invoice.buyer_pos
    };

    // Log the transaction attempt
    const logId = await Database.insert(`
      INSERT INTO e_invoice_transaction_log (
        tax_invoice_id, transaction_type, request_payload, status, api_endpoint
      ) VALUES (?, 'generate', ?, 'pending', ?)
    `, [
      invoiceId, 
      JSON.stringify(eInvoiceData), 
      settings.gst_api_url || 'https://api.gst.gov.in/einvoice'
    ]);

    try {
      // Initialize GST API client
      const gstAPI = new GSTEInvoiceAPI();
      
      // Build the payload according to GST API format
      const payload = buildEInvoicePayload(eInvoiceData);
      
      // Generate E-Invoice
      const response = await gstAPI.generateEInvoice(payload);

      // Update transaction log with response
      await Database.execute(`
        UPDATE e_invoice_transaction_log SET 
          response_payload = ?, irn = ?, ack_number = ?, ack_date = ?, 
          status = 'success'
        WHERE log_id = ?
      `, [
        JSON.stringify(response), 
        response.Irn, 
        response.AckNo?.toString(), 
        new Date(response.AckDt),
        logId
      ]);

      // Update invoice with E-Invoice details
      await Database.execute(`
        UPDATE tax_invoice SET 
          irn_no = ?, ack_no = ?, ack_date = ?, status = 'generated',
          signed_invoice = ?, signed_qr_code = ?, qr_code_url = ?
        WHERE tax_invoice_id = ?
      `, [
        response.Irn,
        response.AckNo?.toString(),
        new Date(response.AckDt).toISOString().split('T')[0],
        response.SignedInvoice,
        response.SignedQRCode,
        response.SignedQRCode,
        invoiceId
      ]);

      // Clear cache
      await RedisCache.delPattern('invoices:*');

      return NextResponse.json({
        success: true,
        message: 'E-Invoice generated successfully',
        data: {
          irn: response.Irn,
          ackNumber: response.AckNo,
          ackDate: response.AckDt,
          qrCode: response.SignedQRCode,
          status: 'generated',
          ewbNumber: response.EwbNo,
          ewbDate: response.EwbDt,
          ewbValidTill: response.EwbValidTill
        }
      });

    } catch (apiError: any) {
      console.error('GST API Error:', apiError);

      // Update transaction log with error
      await Database.execute(`
        UPDATE e_invoice_transaction_log SET 
          status = 'failed', error_message = ?, response_payload = ?
        WHERE log_id = ?
      `, [
        apiError.message,
        JSON.stringify({ error: apiError.message, details: apiError.stack }),
        logId
      ]);

      // Update invoice with error details
      await Database.execute(`
        UPDATE tax_invoice SET 
          status = 'error', error_code = 'GST_API_ERROR', 
          error_message = ?
        WHERE tax_invoice_id = ?
      `, [
        apiError.message,
        invoiceId
      ]);

      return NextResponse.json({
        error: 'Failed to generate E-Invoice',
        details: apiError.message,
        gstError: true
      }, { status: 400 });
    }

  } catch (error) {
    console.error('E-Invoice generation error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}

// DELETE /api/invoices/[id]/einvoice - Cancel E-Invoice
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'SALES', 'delete')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const invoiceId = parseInt(params.id);
    const body = await request.json();
    const { cancelReason = '1', cancelRemarks = 'Invoice cancelled' } = body;

    // Get invoice details
    const invoice = await Database.queryFirst(`
      SELECT irn_no, status FROM tax_invoice 
      WHERE tax_invoice_id = ?
    `, [invoiceId]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (!invoice.irn_no) {
      return NextResponse.json({ 
        error: 'Cannot cancel invoice without IRN' 
      }, { status: 400 });
    }

    if (invoice.status === 'cancelled') {
      return NextResponse.json({ 
        error: 'Invoice already cancelled' 
      }, { status: 400 });
    }

    // Log the cancellation attempt
    const logId = await Database.insert(`
      INSERT INTO e_invoice_transaction_log (
        tax_invoice_id, transaction_type, request_payload, status, api_endpoint
      ) VALUES (?, 'cancel', ?, 'pending', ?)
    `, [
      invoiceId,
      JSON.stringify({ irn: invoice.irn_no, cancelReason, cancelRemarks }),
      process.env.GST_API_BASE_URL + '/invoice/cancel'
    ]);

    try {
      // Initialize GST API client
      const gstAPI = new GSTEInvoiceAPI();
      
      // Cancel E-Invoice
      const response = await gstAPI.cancelEInvoice(invoice.irn_no, cancelReason);

      // Update transaction log
      await Database.execute(`
        UPDATE e_invoice_transaction_log SET 
          response_payload = ?, status = 'success'
        WHERE log_id = ?
      `, [JSON.stringify(response), logId]);

      // Update invoice status
      await Database.execute(`
        UPDATE tax_invoice SET 
          status = 'cancelled', cancelled_date = NOW(), 
          cancel_reason = ?
        WHERE tax_invoice_id = ?
      `, [cancelRemarks, invoiceId]);

      // Clear cache
      await RedisCache.delPattern('invoices:*');

      return NextResponse.json({
        success: true,
        message: 'E-Invoice cancelled successfully',
        data: response
      });

    } catch (apiError: any) {
      console.error('GST API Cancel Error:', apiError);

      // Update transaction log with error
      await Database.execute(`
        UPDATE e_invoice_transaction_log SET 
          status = 'failed', error_message = ?, response_payload = ?
        WHERE log_id = ?
      `, [
        apiError.message,
        JSON.stringify({ error: apiError.message }),
        logId
      ]);

      return NextResponse.json({
        error: 'Failed to cancel E-Invoice',
        details: apiError.message
      }, { status: 400 });
    }

  } catch (error) {
    console.error('E-Invoice cancellation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/invoices/[id]/einvoice - Get E-Invoice status
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'SALES', 'read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const invoiceId = parseInt(params.id);

    // Get invoice e-invoice details
    const invoice = await Database.queryFirst(`
      SELECT 
        tax_invoice_id,
        invoice_no,
        status,
        irn_no,
        ack_no,
        ack_date,
        signed_qr_code,
        error_code,
        error_message,
        cancelled_date,
        cancel_reason
      FROM tax_invoice 
      WHERE tax_invoice_id = ?
    `, [invoiceId]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Get transaction logs
    const logs = await Database.query(`
      SELECT 
        log_id,
        transaction_type,
        status,
        error_code,
        error_message,
        created_at
      FROM e_invoice_transaction_log 
      WHERE tax_invoice_id = ?
      ORDER BY created_at DESC
    `, [invoiceId]);

    return NextResponse.json({
      success: true,
      data: {
        invoice: {
          id: invoice.tax_invoice_id,
          invoiceNumber: invoice.invoice_no,
          status: invoice.status,
          irn: invoice.irn_no,
          ackNumber: invoice.ack_no,
          ackDate: invoice.ack_date,
          qrCode: invoice.signed_qr_code,
          errorCode: invoice.error_code,
          errorMessage: invoice.error_message,
          cancelledDate: invoice.cancelled_date,
          cancelReason: invoice.cancel_reason,
          hasEInvoice: !!invoice.irn_no
        },
        logs: logs
      }
    });

  } catch (error) {
    console.error('Get E-Invoice status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}