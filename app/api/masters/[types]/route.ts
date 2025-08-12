export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';

const MASTER_TABLES = {
  'raw-materials': {
    table: 'master_raw_material',
    idField: 'raw_material_id',
    fields: ['raw_material_name', 'raw_material_unit_id', 'raw_material_desc', 'hsn_sac_id'],
    joins: 'LEFT JOIN master_hsn_sac_code h ON m.hsn_sac_id = h.hsn_sac_id LEFT JOIN master_raw_material_unit u ON m.raw_material_unit_id = u.raw_material_unit_id'
  },
  'customers': {
    table: 'master_customer',
    idField: 'customer_id',
    fields: [
      'customer_company_name', 'customer_name', 'customer_mob', 'customer_address', 
      'customer_state_name', 'customer_state_code', 'customer_gst_in',
      'customer_legal_name', 'customer_trade_name', 'customer_pin_code', 
      'customer_phone', 'customer_email', 'customer_type', 'customer_pan', 
      'is_sez', 'is_export'
    ],
    joins: ''
  },
  'vendors': {
    table: 'master_vendor',
    idField: 'vendor_id',
    fields: ['vendor_name', 'vendor_person_name', 'vendor_address', 'vendor_contact_no', 'vendor_state', 'vendor_state_code', 'vendor_gst'],
    joins: ''
  },
  'godowns': {
    table: 'master_godown',
    idField: 'godown_id',
    fields: ['godown_name', 'godown_address', 'contact_no'],
    joins: ''
  },
  'hsn-codes': {
    table: 'master_hsn_sac_code',
    idField: 'hsn_sac_id',
    fields: ['hsn_sac_code', 'gst_rate'],
    joins: ''
  },
  'units': {
    table: 'master_raw_material_unit',
    idField: 'raw_material_unit_id',
    fields: ['raw_material_unit_name'],
    joins: ''
  },
  'finished-products': {
    table: 'master_finished_product',
    idField: 'prod_id',
    fields: ['prod_name', 'hsn_sac_id'],
    joins: 'LEFT JOIN master_hsn_sac_code h ON m.hsn_sac_id = h.hsn_sac_id'
  },
  'users': {
    table: 'master_user',
    idField: 'user_id',
    fields: ['role', 'name_display', 'address', 'contact_no', 'designation', 'pan_no', 'date_of_join', 'salary', 'user_email', 'user_name', 'status', 'verify_otp'],
    joins: ''
  },
  'gst-settings': {
    table: 'gst_settings',
    idField: 'setting_id',
    fields: ['setting_key', 'setting_value', 'description', 'is_active'],
    joins: ''
  }
} as const;

interface SearchCondition {
  condition: string;
  params: string[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    // Authentication
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'MASTERS', 'read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Query parameters
    const urlObj = new URL(request.url);
    const searchParams = urlObj.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';

    // Validate master type
    const masterConfig = MASTER_TABLES[params.type as keyof typeof MASTER_TABLES];
    if (!masterConfig) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    // Check cache
    const cacheKey = RedisCache.getCacheKey('masters', params.type, page, limit, search);
    const cachedData = await RedisCache.get(cacheKey);
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    // Build query with proper joins for new schema
    let baseQuery;
    if (masterConfig.joins) {
      if (params.type === 'raw-materials') {
        baseQuery = `SELECT m.*, h.hsn_sac_code, h.gst_rate, u.raw_material_unit_name FROM ${masterConfig.table} m ${masterConfig.joins}`;
      } else if (params.type === 'finished-products') {
        baseQuery = `SELECT m.*, h.hsn_sac_code, h.gst_rate FROM ${masterConfig.table} m ${masterConfig.joins}`;
      } else {
        baseQuery = `SELECT m.* FROM ${masterConfig.table} m ${masterConfig.joins}`;
      }
    } else {
      baseQuery = `SELECT m.* FROM ${masterConfig.table} m`;
    }

    const searchCond = getSearchCondition(params.type, search);
    const { condition, params: searchParamsArr } = searchCond;
    
    const { sql, countSql, params: dbParams } = Database.buildPaginationQuery(
      baseQuery,
      page,
      limit,
      condition,
      searchParamsArr
    );

    // Execute queries
    const [data, totalResult] = await Promise.all([
      Database.query(sql + ` ORDER BY m.${masterConfig.idField} DESC`, dbParams),
      Database.queryFirst<{ total: number }>(countSql, dbParams),
    ]);

    const total = totalResult?.total || 0;
    const result = {
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit,
      },
    };

    // Cache result for 1 hour
    await RedisCache.set(cacheKey, result, 3600);

    return NextResponse.json(result);
  } catch (error) {
    console.error(`Masters GET error (${params.type}):`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Internal server error: ${errorMsg}` }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'MASTERS', 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const masterConfig = MASTER_TABLES[params.type as keyof typeof MASTER_TABLES];
    
    if (!masterConfig) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    // Build insert query
    const fields = Object.keys(body).filter(key => 
      (masterConfig.fields as readonly string[]).includes(key) || key === masterConfig.idField
    );
    const values = fields.map(field => body[field]);
    
    const placeholders = fields.map(() => '?').join(', ');
    const fieldNames = fields.join(', ');
    
    const insertSql = `INSERT INTO ${masterConfig.table} (${fieldNames}) VALUES (${placeholders})`;
    
    const insertedId = await Database.insert(insertSql, values);

    // Fetch the created record
    let createdRecord;
    if (masterConfig.joins) {
      if (params.type === 'raw-materials') {
        createdRecord = await Database.queryFirst(`
          SELECT m.*, h.hsn_sac_code, h.gst_rate, u.raw_material_unit_name 
          FROM ${masterConfig.table} m 
          ${masterConfig.joins}
          WHERE m.${masterConfig.idField} = ?
        `, [insertedId]);
      } else if (params.type === 'finished-products') {
        createdRecord = await Database.queryFirst(`
          SELECT m.*, h.hsn_sac_code, h.gst_rate 
          FROM ${masterConfig.table} m 
          ${masterConfig.joins}
          WHERE m.${masterConfig.idField} = ?
        `, [insertedId]);
      } else {
        createdRecord = await Database.queryFirst(
          `SELECT * FROM ${masterConfig.table} WHERE ${masterConfig.idField} = ?`,
          [insertedId]
        );
      }
    } else {
      createdRecord = await Database.queryFirst(
        `SELECT * FROM ${masterConfig.table} WHERE ${masterConfig.idField} = ?`,
        [insertedId]
      );
    }

    // Invalidate cache
    await RedisCache.delPattern(`masters:${params.type}:*`);

    return NextResponse.json(createdRecord, { status: 201 });
  } catch (error) {
    console.error('Masters POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'MASTERS', 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const masterConfig = MASTER_TABLES[params.type as keyof typeof MASTER_TABLES];
    
    if (!masterConfig) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    // Build update query
    const fields = Object.keys(body).filter(key => 
      (masterConfig.fields as readonly string[]).includes(key)
    );
    
    if (fields.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }
    
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = [...fields.map(field => body[field]), id];
    
    const updateSql = `UPDATE ${masterConfig.table} SET ${setClause} WHERE ${masterConfig.idField} = ?`;
    
    const affectedRows = await Database.execute(updateSql, values);
    
    if (affectedRows === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    // Fetch the updated record
    let updatedRecord;
    if (masterConfig.joins) {
      if (params.type === 'raw-materials') {
        updatedRecord = await Database.queryFirst(`
          SELECT m.*, h.hsn_sac_code, h.gst_rate, u.raw_material_unit_name 
          FROM ${masterConfig.table} m 
          ${masterConfig.joins}
          WHERE m.${masterConfig.idField} = ?
        `, [id]);
      } else if (params.type === 'finished-products') {
        updatedRecord = await Database.queryFirst(`
          SELECT m.*, h.hsn_sac_code, h.gst_rate 
          FROM ${masterConfig.table} m 
          ${masterConfig.joins}
          WHERE m.${masterConfig.idField} = ?
        `, [id]);
      } else {
        updatedRecord = await Database.queryFirst(
          `SELECT * FROM ${masterConfig.table} WHERE ${masterConfig.idField} = ?`,
          [id]
        );
      }
    } else {
      updatedRecord = await Database.queryFirst(
        `SELECT * FROM ${masterConfig.table} WHERE ${masterConfig.idField} = ?`,
        [id]
      );
    }

    // Invalidate cache
    await RedisCache.delPattern(`masters:${params.type}:*`);

    return NextResponse.json(updatedRecord);
  } catch (error) {
    console.error('Masters PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'MASTERS', 'delete')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const masterConfig = MASTER_TABLES[params.type as keyof typeof MASTER_TABLES];
    
    if (!masterConfig) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    const deleteSql = `DELETE FROM ${masterConfig.table} WHERE ${masterConfig.idField} = ?`;
    const affectedRows = await Database.execute(deleteSql, [id]);
    
    if (affectedRows === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    // Invalidate cache
    await RedisCache.delPattern(`masters:${params.type}:*`);

    return NextResponse.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('Masters DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getSearchCondition(type: string, search: string): SearchCondition {
  if (!search.trim()) {
    return { condition: '', params: [] };
  }
  
  const searchPattern = `%${search}%`;
  switch (type) {
    case 'raw-materials':
      return {
        condition: '(m.raw_material_name LIKE ? OR m.raw_material_desc LIKE ? OR h.hsn_sac_code LIKE ?)',
        params: [searchPattern, searchPattern, searchPattern],
      };
    case 'customers':
      return {
        condition: '(m.customer_name LIKE ? OR m.customer_company_name LIKE ? OR m.customer_gst_in LIKE ? OR m.customer_legal_name LIKE ?)',
        params: [searchPattern, searchPattern, searchPattern, searchPattern],
      };
    case 'vendors':
      return {
        condition: '(m.vendor_name LIKE ? OR m.vendor_person_name LIKE ? OR m.vendor_gst LIKE ?)',
        params: [searchPattern, searchPattern, searchPattern],
      };
    case 'godowns':
      return {
        condition: '(m.godown_name LIKE ? OR m.godown_address LIKE ?)',
        params: [searchPattern, searchPattern],
      };
    case 'hsn-codes':
      return {
        condition: '(m.hsn_sac_code LIKE ?)',
        params: [searchPattern],
      };
    case 'users':
      return {
        condition: '(m.user_name LIKE ? OR m.name_display LIKE ? OR m.user_email LIKE ?)',
        params: [searchPattern, searchPattern, searchPattern],
      };
    case 'gst-settings':
      return {
        condition: '(m.setting_key LIKE ? OR m.setting_value LIKE ? OR m.description LIKE ?)',
        params: [searchPattern, searchPattern, searchPattern],
      };
    default:
      return { condition: '', params: [] };
  }
}