
export const config = {
  runtime: 'nodejs',
};
import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'INVENTORY', 'read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const godownId = searchParams.get('godown_id');

    const cacheKey = RedisCache.getCacheKey('stock', page, limit, godownId || 'all');
    const cachedData = await RedisCache.get(cacheKey);
    
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    let whereCondition = '';
    let whereParams: string[] = [];
    
    if (godownId) {
      whereCondition = 'WHERE gs.godown_id = ?';
      whereParams = [godownId];
    }

    const baseQuery = `
      SELECT 
        gs.godown_stock_id as id,
        gs.godown_id,
        gs.raw_material_id,
        gs.quantity,
        mg.godown_name,
        mg.godown_address,
        mg.contact_no,
        mrm.raw_material_name,
        mrm.raw_material_desc,
        mrmu.raw_material_unit_name as unit_name,
        mhsc.hsn_sac_code,
        mhsc.gst_rate,
        CURRENT_TIMESTAMP as created_at
      FROM godown_stock gs
      LEFT JOIN master_godown mg ON gs.godown_id = mg.godown_id
      LEFT JOIN master_raw_material mrm ON gs.raw_material_id = mrm.raw_material_id
      LEFT JOIN master_raw_material_unit mrmu ON mrm.raw_material_unit_id = mrmu.raw_material_unit_id
      LEFT JOIN master_hsn_sac_code mhsc ON mrm.hsn_sac_id = mhsc.hsn_sac_id
    `;

    const { sql, countSql, params } = Database.buildPaginationQuery(
      baseQuery, page, limit, whereCondition, whereParams
    );

    const [stockData, totalResult] = await Promise.all([
      Database.query(sql + ` ORDER BY gs.godown_stock_id DESC`, params),
      Database.queryFirst<{ total: number }>(countSql, params)
    ]);

    // Transform data to match expected structure
    const transformedData = stockData.map((item: any) => ({
      id: item.id,
      godown_id: item.godown_id,
      raw_material_id: item.raw_material_id,
      quantity: item.quantity,
      rate: 0, // Not stored in original schema
      amount: 0, // Not stored in original schema
      created_at: item.created_at,
      godown: {
        godown_id: item.godown_id,
        godown_name: item.godown_name,
        godown_address: item.godown_address,
        contact_no: item.contact_no
      },
      rawMaterial: item.raw_material_id ? {
        raw_material_id: item.raw_material_id,
        raw_material_name: item.raw_material_name,
        raw_material_desc: item.raw_material_desc,
        hsnSacCode: item.hsn_sac_code ? {
          hsn_sac_id: null,
          hsn_sac_code: item.hsn_sac_code,
          gst_rate: item.gst_rate
        } : null
      } : null,
      unit: {
        raw_material_unit_name: item.unit_name
      }
    }));

    const total = totalResult?.total || 0;

    const result = {
      data: transformedData,
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
    console.error('Stock GET error:', error);
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
    if (!user || !hasPermission(user, 'INVENTORY', 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { godown_id, raw_material_id, quantity } = body;

    if (!godown_id || !raw_material_id || !quantity) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Check if stock entry already exists
    const existingStock = await Database.queryFirst(
      'SELECT * FROM godown_stock WHERE godown_id = ? AND raw_material_id = ?',
      [godown_id, raw_material_id]
    );

    let stockId;
    if (existingStock) {
      // Update existing stock
      const newQuantity = parseFloat(existingStock.quantity) + parseFloat(quantity);
      await Database.execute(
        'UPDATE godown_stock SET quantity = ? WHERE godown_stock_id = ?',
        [newQuantity, existingStock.godown_stock_id]
      );
      stockId = existingStock.godown_stock_id;
    } else {
      // Insert new stock entry
      stockId = await Database.insert(
        'INSERT INTO godown_stock (godown_id, raw_material_id, quantity) VALUES (?, ?, ?)',
        [godown_id, raw_material_id, quantity]
      );
    }

    // Fetch the created/updated stock with related data
    const stockData = await Database.queryFirst(`
      SELECT 
        gs.*,
        mg.godown_name,
        mrm.raw_material_name,
        mrmu.raw_material_unit_name as unit_name
      FROM godown_stock gs
      LEFT JOIN master_godown mg ON gs.godown_id = mg.godown_id
      LEFT JOIN master_raw_material mrm ON gs.raw_material_id = mrm.raw_material_id
      LEFT JOIN master_raw_material_unit mrmu ON mrm.raw_material_unit_id = mrmu.raw_material_unit_id
      WHERE gs.godown_stock_id = ?
    `, [stockId]);

    // Invalidate cache
    await RedisCache.delPattern('stock:*');

    return NextResponse.json(stockData, { status: 201 });
  } catch (error) {
    console.error('Stock POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}