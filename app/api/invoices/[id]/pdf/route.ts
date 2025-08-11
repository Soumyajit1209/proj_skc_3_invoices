import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
    
    const invoice = await prisma.taxInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        details: true
      }
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const invoiceData = {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date.toLocaleDateString('en-IN'),
      irn: invoice.irn || '',
      ackNumber: invoice.ack_number || '',
      customer: {
        name: invoice.customer.customer_name,
        address: `${invoice.customer.customer_address}, ${invoice.customer.customer_city}, ${invoice.customer.customer_state} - ${invoice.customer.customer_pincode}`,
        gstin: invoice.customer.customer_gstin
      },
      items: invoice.details.map((detail: {
        item_name: string;
        hsn_code: string;
        quantity: number | string;
        unit: string;
        rate: number | string;
        amount: number | string;
        gst_rate: number | string;
        cgst_amount: number | string;
        sgst_amount: number | string;
        igst_amount: number | string;
        total_amount: number | string;
      }) => ({
        name: detail.item_name,
        hsnCode: detail.hsn_code,
        quantity: Number(detail.quantity),
        unit: detail.unit,
        rate: Number(detail.rate),
        amount: Number(detail.amount),
        gstRate: Number(detail.gst_rate),
        cgstAmount: Number(detail.cgst_amount),
        sgstAmount: Number(detail.sgst_amount),
        igstAmount: Number(detail.igst_amount),
        totalAmount: Number(detail.total_amount)
      })),
      totals: {
        totalAmount: Number(invoice.total_amount),
        cgstAmount: Number(invoice.cgst_amount),
        sgstAmount: Number(invoice.sgst_amount),
        igstAmount: Number(invoice.igst_amount),
        netAmount: Number(invoice.net_amount),
        amountInWords: numberToWords(Number(invoice.net_amount))
      },
      qrCode: invoice.qr_code || ''
    };

    const pdfBytes = await generateInvoicePDF(invoiceData);

    // Convert Uint8Array to Buffer for NextResponse
    const pdfBuffer = Buffer.from(pdfBytes);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${invoice.invoice_number}.pdf"`
      }
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}