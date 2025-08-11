import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import QRCode from 'qrcode';

interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  irn: string;
  ackNumber: string;
  customer: {
    name: string;
    address: string;
    gstin: string;
  };
  items: Array<{
    name: string;
    hsnCode: string;
    quantity: number;
    unit: string;
    rate: number;
    amount: number;
    gstRate: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
  }>;
  totals: {
    totalAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    netAmount: number;
    amountInWords: string;
  };
  qrCode: string;
}

export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  let yPosition = height - 50;

  // Header
  page.drawText('TAX INVOICE', {
    x: width / 2 - 50,
    y: yPosition,
    size: 18,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  yPosition -= 40;

  // Invoice details
  page.drawText(`Invoice No: ${invoiceData.invoiceNumber}`, {
    x: 50,
    y: yPosition,
    size: 10,
    font: boldFont,
  });

  page.drawText(`Date: ${invoiceData.invoiceDate}`, {
    x: 350,
    y: yPosition,
    size: 10,
    font: boldFont,
  });

  yPosition -= 20;

  if (invoiceData.irn) {
    page.drawText(`IRN: ${invoiceData.irn}`, {
      x: 50,
      y: yPosition,
      size: 8,
      font: font,
    });
    yPosition -= 15;
  }

  if (invoiceData.ackNumber) {
    page.drawText(`Ack No: ${invoiceData.ackNumber}`, {
      x: 50,
      y: yPosition,
      size: 8,
      font: font,
    });
    yPosition -= 20;
  }

  // Customer details
  page.drawText('Bill To:', {
    x: 50,
    y: yPosition,
    size: 10,
    font: boldFont,
  });

  yPosition -= 15;

  page.drawText(invoiceData.customer.name, {
    x: 50,
    y: yPosition,
    size: 9,
    font: font,
  });

  yPosition -= 12;

  page.drawText(invoiceData.customer.address, {
    x: 50,
    y: yPosition,
    size: 8,
    font: font,
  });

  yPosition -= 12;

  page.drawText(`GSTIN: ${invoiceData.customer.gstin}`, {
    x: 50,
    y: yPosition,
    size: 8,
    font: font,
  });

  yPosition -= 30;

  // Items table header
  const tableStartY = yPosition;
  const rowHeight = 20;
  
  page.drawText('Item', { x: 50, y: yPosition, size: 8, font: boldFont });
  page.drawText('HSN', { x: 150, y: yPosition, size: 8, font: boldFont });
  page.drawText('Qty', { x: 200, y: yPosition, size: 8, font: boldFont });
  page.drawText('Rate', { x: 230, y: yPosition, size: 8, font: boldFont });
  page.drawText('Amount', { x: 270, y: yPosition, size: 8, font: boldFont });
  page.drawText('GST%', { x: 320, y: yPosition, size: 8, font: boldFont });
  page.drawText('GST Amt', { x: 360, y: yPosition, size: 8, font: boldFont });
  page.drawText('Total', { x: 420, y: yPosition, size: 8, font: boldFont });

  yPosition -= 20;

  // Items
  invoiceData.items.forEach((item) => {
    page.drawText(item.name.substring(0, 20), { x: 50, y: yPosition, size: 7, font: font });
    page.drawText(item.hsnCode, { x: 150, y: yPosition, size: 7, font: font });
    page.drawText(item.quantity.toString(), { x: 200, y: yPosition, size: 7, font: font });
    page.drawText(item.rate.toFixed(2), { x: 230, y: yPosition, size: 7, font: font });
    page.drawText(item.amount.toFixed(2), { x: 270, y: yPosition, size: 7, font: font });
    page.drawText(item.gstRate.toString() + '%', { x: 320, y: yPosition, size: 7, font: font });
    page.drawText((item.cgstAmount + item.sgstAmount + item.igstAmount).toFixed(2), { x: 360, y: yPosition, size: 7, font: font });
    page.drawText(item.totalAmount.toFixed(2), { x: 420, y: yPosition, size: 7, font: font });
    
    yPosition -= 15;
  });

  yPosition -= 20;

  // Totals
  page.drawText(`Total Amount: ₹${invoiceData.totals.totalAmount.toFixed(2)}`, {
    x: 350,
    y: yPosition,
    size: 9,
    font: boldFont,
  });

  yPosition -= 15;

  page.drawText(`CGST: ₹${invoiceData.totals.cgstAmount.toFixed(2)}`, {
    x: 350,
    y: yPosition,
    size: 9,
    font: font,
  });

  yPosition -= 15;

  page.drawText(`SGST: ₹${invoiceData.totals.sgstAmount.toFixed(2)}`, {
    x: 350,
    y: yPosition,
    size: 9,
    font: font,
  });

  yPosition -= 15;

  page.drawText(`IGST: ₹${invoiceData.totals.igstAmount.toFixed(2)}`, {
    x: 350,
    y: yPosition,
    size: 9,
    font: font,
  });

  yPosition -= 20;

  page.drawText(`Net Amount: ₹${invoiceData.totals.netAmount.toFixed(2)}`, {
    x: 350,
    y: yPosition,
    size: 10,
    font: boldFont,
  });

  yPosition -= 30;

  // Amount in words
  page.drawText(`Amount in words: ${invoiceData.totals.amountInWords}`, {
    x: 50,
    y: yPosition,
    size: 8,
    font: font,
  });

  // QR Code
  if (invoiceData.qrCode) {
    try {
      const qrCodeBuffer = await QRCode.toBuffer(invoiceData.qrCode, {
        type: 'png',
        width: 100,
        margin: 1
      });
      
      const qrImage = await pdfDoc.embedPng(qrCodeBuffer);
      page.drawImage(qrImage, {
        x: 480,
        y: 50,
        width: 80,
        height: 80,
      });
    } catch (error) {
      console.error('QR Code generation error:', error);
    }
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

export function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertHundreds(n: number): string {
    let result = '';
    
    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    
    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    } else if (n >= 10) {
      result += teens[n - 10] + ' ';
      return result;
    }
    
    if (n > 0) {
      result += ones[n] + ' ';
    }
    
    return result;
  }

  if (num === 0) return 'Zero Rupees Only';

  const crores = Math.floor(num / 10000000);
  const lakhs = Math.floor((num % 10000000) / 100000);
  const thousands = Math.floor((num % 100000) / 1000);
  const hundreds = num % 1000;

  let result = '';

  if (crores > 0) {
    result += convertHundreds(crores) + 'Crore ';
  }

  if (lakhs > 0) {
    result += convertHundreds(lakhs) + 'Lakh ';
  }

  if (thousands > 0) {
    result += convertHundreds(thousands) + 'Thousand ';
  }

  if (hundreds > 0) {
    result += convertHundreds(hundreds);
  }

  return result.trim() + ' Rupees Only';
}