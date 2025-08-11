import mysql from 'mysql2/promise';

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'invoice_db',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

export class Database {
  // Execute a single query
  static async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    try {
      const [rows] = await pool.execute(sql, params || []);
      return rows as T[];
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }

  // Execute query and return first row
  static async queryFirst<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  // Execute multiple queries in a transaction
  static async transaction(queries: Array<{ sql: string; params?: any[] }>): Promise<any[]> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      const results = [];
      for (const query of queries) {
        const [rows] = await connection.execute(query.sql, query.params || []);
        results.push(rows);
      }
      
      await connection.commit();
      return results;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // Insert and return the inserted ID
  static async insert(sql: string, params?: any[]): Promise<number> {
    try {
      const [result] = await pool.execute(sql, params || []) as any;
      return result.insertId;
    } catch (error) {
      console.error('Database insert error:', error);
      throw error;
    }
  }

  // Update/Delete and return affected rows
  static async execute(sql: string, params?: any[]): Promise<number> {
    try {
      const [result] = await pool.execute(sql, params || []) as any;
      return result.affectedRows;
    } catch (error) {
      console.error('Database execute error:', error);
      throw error;
    }
  }

  // Build pagination queries
  static buildPaginationQuery(
    baseQuery: string, 
    page: number, 
    limit: number, 
    searchCondition?: string,
    searchParams?: any[]
  ): { sql: string; countSql: string; params: any[] } {
    const offset = (page - 1) * limit;
    
    let whereClause = '';
    let params = [...(searchParams || [])];
    
    if (searchCondition) {
      whereClause = `WHERE ${searchCondition}`;
    }
    
    const sql = `${baseQuery} ${whereClause} LIMIT ${limit} OFFSET ${offset}`;
    const countSql = `SELECT COUNT(*) as total FROM (${baseQuery.replace(/SELECT.*FROM/i, 'SELECT 1 FROM')}) as count_query ${whereClause}`;
    
    return { sql, countSql, params };
  }

  // Close the connection pool
  static async close(): Promise<void> {
    await pool.end();
  }
}

// Export the pool for direct access if needed
export { pool };

// Database models based on your schema
export interface Customer {
  customer_id: number;
  customer_company_name: string;
  customer_name: string;
  customer_mob: string;
  customer_address: string;
  customer_state_name: string;
  customer_state_code: string;
  customer_gst_in: string;
}

export interface Vendor {
  vendor_id: number;
  vendor_name: string;
  vendor_person_name: string;
  vendor_address: string;
  vendor_contact_no: string;
  vendor_state: string;
  vendor_state_code: string;
  vendor_gst: string;
}

export interface RawMaterial {
  raw_material_id: number;
  raw_material_unit_id: number;
  raw_material_name: string;
  raw_material_desc: string;
}

export interface FinishedProduct {
  prod_id: number;
  prod_name: string;
  hsn_sac_id: number;
}

export interface TaxInvoice {
  tax_invoice_id: number;
  customer_id: number;
  invoice_no: string;
  invoice_date: string;
  delivery_note: string;
  mode_terms_payment: string;
  ref_no_date: string;
  other_reference: string;
  buyer_order_no: string;
  buyer_order_date: string;
  dispatch_doc_no: string;
  delivery_note_date: string;
  dispatch_through: string;
  dispatch_destination: string;
  terms_delivery: string;
  consignee_name: string;
  consignee_address: string;
  consignee_gstin: string;
  consignee_state_name: string;
  buyer_name: string;
  buyer_address: string;
  buyer_gstin: string;
  buyer_state_name: string;
  place_supply: string;
  amount_chargeable_word: string;
  tax_amount_word: string;
  remarks: string;
  irn_no: string;
  ack_no: string;
  ack_date: string;
  grand_total_qty: string;
  grand_total_taxable_amt: string;
  grand_total_cgst_amt: string;
  grand_total_sgst_amt: string;
  grand_total_amt: string;
}

export interface TaxInvoiceDetails {
  tax_invoice_details_id: number;
  tax_invoice_id: number;
  prod_id: number;
  hsn_sac_code: string;
  qty: number;
  rate: number;
  per_id: number;
  taxable_amt: number;
  cgst_rate: number;
  cgst_amt: number;
  sgst_rate: number;
  sgst_amt: number;
  total_amount: number;
}

export interface GodownStock {
  godown_stock_id: number;
  godown_id: number;
  raw_material_id: number;
  quantity: number;
}

export interface HSNSACCode {
  hsn_sac_id: number;
  hsn_sac_code: string;
  gst_rate: string;
}

export interface MasterUser {
  user_id: number;
  role: string;
  name_display: string;
  address: string;
  contact_no: string;
  designation: string;
  pan_no: string;
  date_of_join: string;
  salary: string;
  user_email: string;
  user_name: string;
  password: string;
  profile_picture: string;
  status: number;
  verify_otp: number;
}