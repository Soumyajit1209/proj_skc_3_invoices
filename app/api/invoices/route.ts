import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';
import { GSTEInvoiceAPI, buildEInvoicePayload } from '@/lib/gst-api';
import { generateInvoicePDF, numberToWords } from '@/lib/pdf';

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

    const cacheKey = RedisCache.getCacheKey('invoices', page, limit, search);
    const cachedData = await RedisCache.get(cacheKey);
    
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    const skip = (page - 1) * limit;
    
    const searchCondition = search ? {
      OR: [
        { invoice_number: { contains: search } },
        { customer: { customer_name: { contains: search } } },
        { irn: { contains: search } }
      ]
    } : {};

    const [invoices, total] = await Promise.all([
      prisma.taxInvoice.findMany({
        skip,
        take: limit,
        where: searchCondition,
        include: {
          customer: true,
          details: true
        },
        orderBy: { id: 'desc' }
      }),
      prisma.taxInvoice.count({ where: searchCondition })
    ]);

    const result = {
      data: invoices,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit
      }
    };

    await RedisCache.set(cacheKey, result, 3600);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Invoices GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

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

    // Calculate totals
    let totalAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    const processedItems = items.map((item: any) => {
      const amount = item.quantity * item.rate;
      const gstAmount = (amount * item.gst_rate) / 100;
      
      // Determine if inter-state or intra-state
      const isInterState = place_of_supply !== '19'; // Assuming seller state is 19 (WB)
      
      totalAmount += amount;
      
      if (isInterState) {
        igstAmount += gstAmount;
        return {
          ...item,
          amount,
          cgst_amount: 0,
          sgst_amount: 0,
          igst_amount: gstAmount,
          total_amount: amount + gstAmount
        };
      } else {
        const halfGst = gstAmount / 2;
        cgstAmount += halfGst;
        sgstAmount += halfGst;
        return {
          ...item,
          amount,
          cgst_amount: halfGst,
          sgst_amount: halfGst,
          igst_amount: 0,
          total_amount: amount + gstAmount
        };
      }
    });

    const netAmount = totalAmount + cgstAmount + sgstAmount + igstAmount;

    // Generate invoice number
    const invoiceCount = await prisma.taxInvoice.count();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${(invoiceCount + 1).toString().padStart(4, '0')}`;

    let irnData = null;

    // Submit to GST if required
    if (submit_to_gst) {
      try {
        const customer = await prisma.masterCustomer.findUnique({
          where: { id: customer_id }
        });

        if (!customer) {
          throw new Error('Customer not found');
        }

        const gstApi = new GSTEInvoiceAPI();
        
        const eInvoicePayload = buildEInvoicePayload({
          invoiceNumber,
          invoiceDate: invoice_date,
          sellerGstin: process.env.GST_API_GSTIN!,
          sellerName: 'Your Company Name',
          sellerAddress: 'Your Company Address',
          sellerCity: 'Bhātpāra',
          sellerPincode: '743124',
          buyerGstin: customer.customer_gstin,
          buyerName: customer.customer_name,
          buyerAddress: customer.customer_address,
          buyerCity: customer.customer_city,
          buyerPincode: customer.customer_pincode,
          items: processedItems.map((item: any) => ({
            name: item.item_name,
            hsnCode: item.hsn_code,
            quantity: item.quantity,
            unit: item.unit,
            rate: item.rate,
            amount: item.amount,
            gstRate: item.gst_rate,
            gstAmount: item.cgst_amount + item.sgst_amount + item.igst_amount,
            totalAmount: item.total_amount,
            isService: false
          })),
          totalAmount,
          gstAmount: cgstAmount + sgstAmount + igstAmount,
          netAmount
        });

        irnData = await gstApi.generateEInvoice(eInvoicePayload);
      } catch (gstError) {
        console.error('GST submission error:', gstError);
        // Continue without GST submission but log error
      }
    }

    // Create invoice in database
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const invoice = await tx.taxInvoice.create({
        data: {
          customer_id,
          invoice_date: new Date(invoice_date),
          invoice_number: invoiceNumber,
          place_of_supply,
          irn: irnData?.Irn,
          ack_number: irnData?.AckNo?.toString(),
          ack_date: irnData ? new Date(irnData.AckDt) : null,
          qr_code: irnData?.SignedQRCode,
          total_amount: totalAmount,
          cgst_amount: cgstAmount,
          sgst_amount: sgstAmount,
          igst_amount: igstAmount,
          net_amount: netAmount,
          is_submitted: !!irnData
        },
        include: {
          customer: true
        }
      });

      // Create invoice details
      await tx.taxInvoiceDetails.createMany({
        data: processedItems.map((item: any) => ({
          invoice_id: invoice.id,
          ...item
        }))
      });

      return invoice;
    });

    // Invalidate cache
    await RedisCache.delPattern('invoices:*');

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Invoice creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}