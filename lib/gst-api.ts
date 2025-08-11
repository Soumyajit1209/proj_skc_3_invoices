import axios from 'axios';

interface GSTAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface EInvoicePayload {
  Version: string;
  TranDtls: {
    TaxSch: string;
    SupTyp: string;
    RegRev?: string;
    EcmGstin?: string;
    IgstOnIntra?: string;
  };
  DocDtls: {
    Typ: string;
    No: string;
    Dt: string;
  };
  SellerDtls: {
    Gstin: string;
    LglNm: string;
    TrdNm?: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
    Ph?: string;
    Em?: string;
  };
  BuyerDtls: {
    Gstin: string;
    LglNm: string;
    TrdNm?: string;
    Pos: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
    Ph?: string;
    Em?: string;
  };
  DispDtls?: {
    Nm: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  ShipDtls?: {
    Gstin?: string;
    LglNm?: string;
    TrdNm?: string;
    Addr1: string;
    Addr2?: string;
    Loc: string;
    Pin: number;
    Stcd: string;
  };
  ItemList: Array<{
    SlNo: string;
    PrdDesc: string;
    IsServc: string;
    HsnCd: string;
    Barcde?: string;
    Qty?: number;
    FreeQty?: number;
    Unit?: string;
    UnitPrice: number;
    TotAmt: number;
    Discount?: number;
    PreTaxVal?: number;
    AssAmt: number;
    GstRt: number;
    IgstAmt?: number;
    CgstAmt?: number;
    SgstAmt?: number;
    CesRt?: number;
    CesAmt?: number;
    CesNonAdvlAmt?: number;
    StateCesRt?: number;
    StateCesAmt?: number;
    StateCesNonAdvlAmt?: number;
    OthChrg?: number;
    TotItemVal: number;
    OrdLineRef?: string;
    OrgCntry?: string;
    PrdSlNo?: string;
    BchDtls?: {
      Nm?: string;
      ExpDt?: string;
      WrDt?: string;
    };
    AttribDtls?: Array<{
      Nm: string;
      Val: string;
    }>;
  }>;
  ValDtls: {
    AssVal: number;
    CgstVal?: number;
    SgstVal?: number;
    IgstVal?: number;
    CesVal?: number;
    StCesVal?: number;
    Discount?: number;
    OthChrg?: number;
    RndOffAmt?: number;
    TotInvVal: number;
    TotInvValFc?: number;
  };
  PayDtls?: {
    Nm?: string;
    AccDet?: string;
    Mode?: string;
    FinInsBr?: string;
    PayTerm?: string;
    PayInstr?: string;
    CrTrn?: string;
    DirDr?: string;
    CrDay?: number;
    PaidAmt?: number;
    PaymtDue?: number;
  };
  RefDtls?: {
    InvRm?: string;
    DocPerdDtls?: {
      InvStDt?: string;
      InvEndDt?: string;
    };
    PrecDocDtls?: Array<{
      InvNo?: string;
      InvDt?: string;
      OthRefNo?: string;
    }>;
    ContrDtls?: Array<{
      RecAdvRefr?: string;
      RecAdvDt?: string;
      TendRefr?: string;
      ContrRefr?: string;
      ExtRefr?: string;
      ProjRefr?: string;
      PORefr?: string;
      PORefDt?: string;
    }>;
  };
  AddlDocDtls?: Array<{
    Url?: string;
    Docs?: string;
    Info?: string;
  }>;
  ExpDtls?: {
    ShipBNo?: string;
    ShipBDt?: string;
    Port?: string;
    RefClm?: string;
    ForCur?: string;
    CntCode?: string;
    ExpDuty?: number;
  };
  EwbDtls?: {
    TransId?: string;
    TransName?: string;
    Distance?: number;
    TransDocNo?: string;
    TransDocDt?: string;
    VehNo?: string;
    VehType?: string;
    TransMode?: string;
  };
}

interface EInvoiceResponse {
  Success: string;
  AckNo: number;
  AckDt: string;
  Irn: string;
  SignedInvoice: string;
  SignedQRCode: string;
  Status: string;
  EwbNo?: number;
  EwbDt?: string;
  EwbValidTill?: string;
  InfoDtls?: Array<{
    InfCd: string;
    Desc: string;
  }>;
}

export class GSTEInvoiceAPI {
  private baseUrl: string;
  private username: string;
  private password: string;
  private gstin: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor() {
    this.baseUrl = process.env.GST_API_BASE_URL!;
    this.username = process.env.GST_API_USERNAME!;
    this.password = process.env.GST_API_PASSWORD!;
    this.gstin = process.env.GST_API_GSTIN!;
    this.clientId = process.env.GST_API_CLIENT_ID!;
    this.clientSecret = process.env.GST_API_CLIENT_SECRET!;
  }

  private async authenticate(): Promise<void> {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return;
    }

    try {
      const response = await axios.post<GSTAuthResponse>(
        `${this.baseUrl}/auth`,
        {
          username: this.username,
          password: this.password,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'password'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'client_id': this.clientId,
            'client_secret': this.clientSecret,
            'Gstin': this.gstin
          }
        }
      );

      this.accessToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 minute buffer
    } catch (error) {
      console.error('GST API authentication failed:', error);
      throw new Error('Failed to authenticate with GST API');
    }
  }

  async generateEInvoice(payload: EInvoicePayload): Promise<EInvoiceResponse> {
    await this.authenticate();

    try {
      const response = await axios.post<EInvoiceResponse>(
        `${this.baseUrl}/invoice`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'user_name': this.username,
            'Gstin': this.gstin,
            'requestid': Date.now().toString(),
            'ip': '127.0.0.1'
          }
        }
      );

      if (response.data.Success !== 'Y') {
        throw new Error(`E-Invoice generation failed: ${response.data.InfoDtls?.[0]?.Desc || 'Unknown error'}`);
      }

      return response.data;
    } catch (error: any) {
      console.error('E-Invoice generation failed:', error);
      throw new Error(error.response?.data?.message || 'Failed to generate e-invoice');
    }
  }

  async cancelEInvoice(irn: string, cancelReason: string): Promise<any> {
    await this.authenticate();

    try {
      const response = await axios.post(
        `${this.baseUrl}/invoice/cancel`,
        {
          Irn: irn,
          CnlRsn: cancelReason,
          CnlRem: 'Invoice cancelled'
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            'user_name': this.username,
            'Gstin': this.gstin
          }
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('E-Invoice cancellation failed:', error);
      throw new Error(error.response?.data?.message || 'Failed to cancel e-invoice');
    }
  }
}

export function buildEInvoicePayload(invoiceData: any): EInvoicePayload {
  // Get state code from GSTIN (first 2 digits)
  const sellerStateCode = invoiceData.sellerGstin.substring(0, 2);
  const buyerStateCode = invoiceData.buyerGstin.substring(0, 2);
  const isInterState = sellerStateCode !== buyerStateCode;

  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: 'B2B',
    },
    DocDtls: {
      Typ: 'INV',
      No: invoiceData.invoiceNumber,
      Dt: invoiceData.invoiceDate,
    },
    SellerDtls: {
      Gstin: invoiceData.sellerGstin,
      LglNm: invoiceData.sellerName,
      Addr1: invoiceData.sellerAddress,
      Loc: invoiceData.sellerCity,
      Pin: parseInt(invoiceData.sellerPincode),
      Stcd: sellerStateCode,
    },
    BuyerDtls: {
      Gstin: invoiceData.buyerGstin,
      LglNm: invoiceData.buyerName,
      Pos: buyerStateCode,
      Addr1: invoiceData.buyerAddress,
      Loc: invoiceData.buyerCity,
      Pin: parseInt(invoiceData.buyerPincode),
      Stcd: buyerStateCode,
    },
    ItemList: invoiceData.items.map((item: any, index: number) => ({
      SlNo: (index + 1).toString(),
      PrdDesc: item.name,
      IsServc: item.isService ? 'Y' : 'N',
      HsnCd: item.hsnCode,
      Qty: item.quantity,
      Unit: item.unit,
      UnitPrice: item.rate,
      TotAmt: item.amount,
      AssAmt: item.amount,
      GstRt: item.gstRate,
      IgstAmt: isInterState ? item.gstAmount : 0,
      CgstAmt: isInterState ? 0 : item.gstAmount / 2,
      SgstAmt: isInterState ? 0 : item.gstAmount / 2,
      TotItemVal: item.totalAmount,
    })),
    ValDtls: {
      AssVal: invoiceData.totalAmount,
      CgstVal: isInterState ? 0 : invoiceData.gstAmount / 2,
      SgstVal: isInterState ? 0 : invoiceData.gstAmount / 2,
      IgstVal: isInterState ? invoiceData.gstAmount : 0,
      TotInvVal: invoiceData.netAmount,
    },
  };
}