export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';
import { generateInvoicePDF, numberToWords } from '@/lib/pdf';

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

    // Check cache first
    const cacheKey = RedisCache.getCacheKey('invoice_pdf', invoiceId.toString());
    const cachedData = await RedisCache.get(cacheKey);
    
    // Get invoice with customer details using updated schema
    const invoice = await Database.queryFirst(`
      SELECT 
        ti.*,
        COALESCE(mc.customer_company_name, mc.customer_name) as customer_name,
        mc.customer_company_name,
        mc.customer_name as customer_person_name,
        mc.customer_address,
        mc.customer_state_name,
        mc.customer_gst_in as customer_gstin,
        mc.customer_pin_code,
        mc.customer_phone,
        mc.customer_email
      FROM tax_invoice ti
      JOIN master_customer mc ON ti.customer_id = mc.customer_id
      WHERE ti.tax_invoice_id = ?
    `, [invoiceId]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Get invoice details with updated schema
    const details = await Database.query(`
      SELECT 
        tid.*,
        mfp.prod_name as item_name,
        tid.hsn_sac_code as hsn_code,
        mfpu.per_name as unit,
        tid.product_description,
        tid.item_serial_number,
        tid.is_service,
        tid.unit_price,
        tid.assessable_amount,
        COALESCE(tid.igst_rate, 0) as igst_rate,
        COALESCE(tid.igst_amount, 0) as igst_amount
      FROM tax_invoice_details tid
      LEFT JOIN master_finished_product mfp ON tid.prod_id = mfp.prod_id
      LEFT JOIN master_finished_product_unit mfpu ON tid.per_id = mfpu.per_id
      WHERE tid.tax_invoice_id = ?
      ORDER BY tid.item_serial_number
    `, [invoiceId]);

    // Determine if it's interstate transaction
    const isInterState = (invoice.grand_total_igst_amt || 0) > 0;

    const invoiceData = {
      invoiceNumber: invoice.invoice_no,
      invoiceDate: new Date(invoice.invoice_date).toLocaleDateString('en-IN'),
      irn: invoice.irn_no || '',
      ackNumber: invoice.ack_no || '',
      status: invoice.status || 'draft',
      supplyType: invoice.supply_type || 'B2B',
      transactionType: invoice.transaction_type || 'Regular',
      customer: {
        name: invoice.customer_name,
        companyName: invoice.customer_company_name,
        personName: invoice.customer_person_name,
        address: `${invoice.customer_address}${invoice.customer_state_name ? ', ' + invoice.customer_state_name : ''}`,
        gstin: invoice.customer_gstin,
        pinCode: invoice.customer_pin_code,
        phone: invoice.customer_phone,
        email: invoice.customer_email
      },
      seller: {
        legalName: invoice.seller_legal_name || 'Company Name',
        address: invoice.seller_address1 || 'Company Address',
        location: invoice.seller_location || 'City',
        pinCode: invoice.seller_pin_code || 400001,
        stateCode: invoice.seller_state_code || '27',
        phone: invoice.seller_phone,
        email: invoice.seller_email
      },
      items: details.map((detail: any) => ({
        serialNumber: detail.item_serial_number || 1,
        name: detail.product_description || detail.item_name || 'Product',
        description: detail.product_description || detail.item_name || 'Product',
        hsnCode: detail.hsn_code,
        isService: detail.is_service === 'Y',
        quantity: Number(detail.qty),
        unit: detail.unit || 'NOS',
        unitPrice: Number(detail.unit_price || detail.rate),
        rate: Number(detail.rate),
        amount: Number(detail.total_amount || detail.taxable_amt),
        assessableAmount: Number(detail.assessable_amount || detail.taxable_amt),
        gstRate: Number((detail.cgst_rate || 0) + (detail.sgst_rate || 0) + (detail.igst_rate || 0)),
        cgstRate: Number(detail.cgst_rate || 0),
        cgstAmount: Number(detail.cgst_amt || 0),
        sgstRate: Number(detail.sgst_rate || 0),
        sgstAmount: Number(detail.sgst_amt || 0),
        igstRate: Number(detail.igst_rate || 0),
        igstAmount: Number(detail.igst_amount || 0),
        totalAmount: Number(detail.total_amount)
      })),
      totals: {
        totalAmount: Number(invoice.grand_total_taxable_amt || 0),
        cgstAmount: Number(invoice.grand_total_cgst_amt || 0),
        sgstAmount: Number(invoice.grand_total_sgst_amt || 0),
        igstAmount: Number(invoice.grand_total_igst_amt || 0),
        netAmount: Number(invoice.grand_total_amt || 0),
        roundOffAmount: Number(invoice.round_off_amount || 0),
        amountInWords: numberToWords(Number(invoice.grand_total_amt || 0))
      },
      qrCode: invoice.signed_qr_code || invoice.qr_code_url || '',
      isInterState: isInterState,
      placeOfSupply: invoice.place_supply || invoice.buyer_pos,
      additionalDetails: {
        buyerOrderNo: invoice.buyer_order_no,
        buyerOrderDate: invoice.buyer_order_date,
        deliveryNote: invoice.delivery_note,
        modeTermsPayment: invoice.mode_terms_payment,
        dispatchDocNo: invoice.dispatch_doc_no,
        dispatchThrough: invoice.dispatch_through,
        dispatchDestination: invoice.dispatch_destination,
        termsDelivery: invoice.terms_delivery,
        remarks: invoice.remarks
      }
    };

    const pdfBytes = await generateInvoicePDF(invoiceData);

    // Convert Uint8Array to Buffer for NextResponse
    const pdfBuffer = Buffer.from(pdfBytes);

    // Cache the result for 1 hour
    const pdfCacheData = {
      buffer: Array.from(pdfBytes),
      filename: `Invoice-${invoice.invoice_no}.pdf`
    };
    await RedisCache.set(cacheKey, pdfCacheData, 3600);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${invoice.invoice_no}.pdf"`,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}