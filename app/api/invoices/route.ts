export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
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
    
    // Get invoice with customer details
    const invoice = await Database.queryFirst(`
      SELECT 
        ti.*,
        mc.customer_name,
        mc.customer_address,
        mc.customer_state_name,
        mc.customer_gst_in as customer_gstin
      FROM tax_invoice ti
      JOIN master_customer mc ON ti.customer_id = mc.customer_id
      WHERE ti.tax_invoice_id = ?
    `, [invoiceId]);

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    // Get invoice details
    const details = await Database.query(`
      SELECT 
        tid.*,
        mfp.prod_name as item_name,
        tid.hsn_sac_code as hsn_code,
        mfpu.per_name as unit
      FROM tax_invoice_details tid
      LEFT JOIN master_finished_product mfp ON tid.prod_id = mfp.prod_id
      LEFT JOIN master_finished_product_unit mfpu ON tid.per_id = mfpu.per_id
      WHERE tid.tax_invoice_id = ?
    `, [invoiceId]);

    const invoiceData = {
      invoiceNumber: invoice.invoice_no,
      invoiceDate: new Date(invoice.invoice_date).toLocaleDateString('en-IN'),
      irn: invoice.irn_no || '',
      ackNumber: invoice.ack_no || '',
      customer: {
        name: invoice.customer_name,
        address: `${invoice.customer_address}, ${invoice.customer_state_name}`,
        gstin: invoice.customer_gstin
      },
      items: details.map((detail: any) => ({
        name: detail.item_name || 'Product',
        hsnCode: detail.hsn_code,
        quantity: Number(detail.qty),
        unit: detail.unit || 'NOS',
        rate: Number(detail.rate),
        amount: Number(detail.taxable_amt),
        gstRate: Number(detail.cgst_rate + detail.sgst_rate),
        cgstAmount: Number(detail.cgst_amt),
        sgstAmount: Number(detail.sgst_amt),
        igstAmount: 0, // Not in current schema
        totalAmount: Number(detail.total_amount)
      })),
      totals: {
        totalAmount: Number(invoice.grand_total_taxable_amt || 0),
        cgstAmount: Number(invoice.grand_total_cgst_amt || 0),
        sgstAmount: Number(invoice.grand_total_sgst_amt || 0),
        igstAmount: 0, // Not in current schema
        netAmount: Number(invoice.grand_total_amt || 0),
        amountInWords: numberToWords(Number(invoice.grand_total_amt || 0))
      },
      qrCode: '' // Not in current schema
    };

    const pdfBytes = await generateInvoicePDF(invoiceData);

    // Convert Uint8Array to Buffer for NextResponse
    const pdfBuffer = Buffer.from(pdfBytes);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${invoice.invoice_no}.pdf"`
      }
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}