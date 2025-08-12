// app/api/stock/route.ts
export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';

// GET /api/stock - Get all stock with pagination and filtering
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
    const materialId = searchParams.get('material_id');
    const search = searchParams.get('search') || '';

    const cacheKey = RedisCache.getCacheKey('stock', page, limit, godownId || 'all', materialId || 'all', search);
    const cachedData = await RedisCache.get(cacheKey);
    
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    let whereConditions: string[] = [];
    let whereParams: any[] = [];
    
    if (godownId) {
      whereConditions.push('gs.godown_id = ?');
      whereParams.push(godownId);
    }

    if (materialId) {
      whereConditions.push('gs.raw_material_id = ?');
      whereParams.push(materialId);
    }

    if (search) {
      whereConditions.push('(mrm.raw_material_name LIKE ? OR mg.godown_name LIKE ? OR mhsc.hsn_sac_code LIKE ?)');
      const searchPattern = `%${search}%`;
      whereParams.push(searchPattern, searchPattern, searchPattern);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const baseQuery = `
      SELECT 
        gs.godown_stock_id as id,
        gs.godown_id,
        gs.raw_material_id,
        gs.quantity,
        mg.godown_name,
        mg.godown_address,
        mg.contact_no as godown_contact,
        mrm.raw_material_name,
        mrm.raw_material_desc,
        mrmu.raw_material_unit_name as unit_name,
        mhsc.hsn_sac_code,
        mhsc.gst_rate,
        CURRENT_TIMESTAMP as last_updated
      FROM godown_stock gs
      LEFT JOIN master_godown mg ON gs.godown_id = mg.godown_id
      LEFT JOIN master_raw_material mrm ON gs.raw_material_id = mrm.raw_material_id
      LEFT JOIN master_raw_material_unit mrmu ON mrm.raw_material_unit_id = mrmu.raw_material_unit_id
      LEFT JOIN master_hsn_sac_code mhsc ON mrm.hsn_sac_id = mhsc.hsn_sac_id
    `;

    const { sql, countSql, params } = Database.buildPaginationQuery(
      baseQuery, page, limit, whereClause, whereParams
    );

    const [stockData, totalResult] = await Promise.all([
      Database.query(sql + ` ORDER BY gs.godown_stock_id DESC`, params),
      Database.queryFirst<{ total: number }>(countSql, params)
    ]);

    // Transform data
    const transformedData = stockData.map((item: any) => ({
      id: item.id,
      godown_id: item.godown_id,
      raw_material_id: item.raw_material_id,
      quantity: parseFloat(item.quantity) || 0,
      last_updated: item.last_updated,
      godown: {
        godown_id: item.godown_id,
        godown_name: item.godown_name,
        godown_address: item.godown_address,
        contact_no: item.godown_contact
      },
      rawMaterial: {
        raw_material_id: item.raw_material_id,
        raw_material_name: item.raw_material_name,
        raw_material_desc: item.raw_material_desc,
        unit_name: item.unit_name,
        hsnSacCode: {
          hsn_sac_code: item.hsn_sac_code,
          gst_rate: item.gst_rate
        }
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

// POST /api/stock - Add new stock entry
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
    const { godown_id, raw_material_id, quantity, operation = 'add' } = body;

    if (!godown_id || !raw_material_id || !quantity) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (quantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be greater than 0' }, { status: 400 });
    }

    // Verify godown and material exist
    const [godown, material] = await Promise.all([
      Database.queryFirst('SELECT * FROM master_godown WHERE godown_id = ?', [godown_id]),
      Database.queryFirst('SELECT * FROM master_raw_material WHERE raw_material_id = ?', [raw_material_id])
    ]);

    if (!godown) {
      return NextResponse.json({ error: 'Godown not found' }, { status: 404 });
    }

    if (!material) {
      return NextResponse.json({ error: 'Raw material not found' }, { status: 404 });
    }

    // Check if stock entry already exists
    const existingStock = await Database.queryFirst(`
      SELECT * FROM godown_stock 
      WHERE godown_id = ? AND raw_material_id = ?
    `, [godown_id, raw_material_id]);

    let stockId;
    let newQuantity = parseFloat(quantity);

    if (existingStock) {
      // Update existing stock
      const currentQuantity = parseFloat(existingStock.quantity) || 0;
      
      if (operation === 'add') {
        newQuantity = currentQuantity + newQuantity;
      } else if (operation === 'subtract') {
        newQuantity = currentQuantity - newQuantity;
        if (newQuantity < 0) {
          return NextResponse.json({ error: 'Insufficient stock' }, { status: 400 });
        }
      } else if (operation === 'set') {
        // newQuantity remains as is
      }

      await Database.execute(`
        UPDATE godown_stock SET quantity = ? 
        WHERE godown_stock_id = ?
      `, [newQuantity, existingStock.godown_stock_id]);
      
      stockId = existingStock.godown_stock_id;
    } else {
      // Insert new stock entry
      if (operation === 'subtract') {
        return NextResponse.json({ error: 'Cannot subtract from non-existent stock' }, { status: 400 });
      }

      stockId = await Database.insert(`
        INSERT INTO godown_stock (godown_id, raw_material_id, quantity) 
        VALUES (?, ?, ?)
      `, [godown_id, raw_material_id, newQuantity]);
    }

    // Fetch the updated stock with all details
    const stockData = await Database.queryFirst(`
      SELECT 
        gs.*,
        mg.godown_name,
        mg.godown_address,
        mg.contact_no as godown_contact,
        mrm.raw_material_name,
        mrm.raw_material_desc,
        mrmu.raw_material_unit_name as unit_name,
        mhsc.hsn_sac_code,
        mhsc.gst_rate
      FROM godown_stock gs
      LEFT JOIN master_godown mg ON gs.godown_id = mg.godown_id
      LEFT JOIN master_raw_material mrm ON gs.raw_material_id = mrm.raw_material_id
      LEFT JOIN master_raw_material_unit mrmu ON mrm.raw_material_unit_id = mrmu.raw_material_unit_id
      LEFT JOIN master_hsn_sac_code mhsc ON mrm.hsn_sac_id = mhsc.hsn_sac_id
      WHERE gs.godown_stock_id = ?
    `, [stockId]);

    // Invalidate cache
    await RedisCache.delPattern('stock:*');

    return NextResponse.json({
      success: true,
      data: {
        id: stockData.godown_stock_id,
        godown_id: stockData.godown_id,
        raw_material_id: stockData.raw_material_id,
        quantity: parseFloat(stockData.quantity),
        operation: operation,
        godown: {
          godown_name: stockData.godown_name,
          godown_address: stockData.godown_address
        },
        rawMaterial: {
          raw_material_name: stockData.raw_material_name,
          unit_name: stockData.unit_name
        }
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Stock POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT /api/stock - Update stock quantity
export async function PUT(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'INVENTORY', 'write')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const stockId = searchParams.get('id');

    if (!stockId) {
      return NextResponse.json({ error: 'Stock ID is required' }, { status: 400 });
    }

    const body = await request.json();
    const { quantity } = body;

    if (!quantity || quantity < 0) {
      return NextResponse.json({ error: 'Valid quantity is required' }, { status: 400 });
    }

    const affectedRows = await Database.execute(`
      UPDATE godown_stock SET quantity = ? WHERE godown_stock_id = ?
    `, [quantity, stockId]);

    if (affectedRows === 0) {
      return NextResponse.json({ error: 'Stock record not found' }, { status: 404 });
    }

    // Invalidate cache
    await RedisCache.delPattern('stock:*');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Stock PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/stock - Delete stock entry
export async function DELETE(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'INVENTORY', 'delete')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const stockId = searchParams.get('id');

    if (!stockId) {
      return NextResponse.json({ error: 'Stock ID is required' }, { status: 400 });
    }

    const affectedRows = await Database.execute(`
      DELETE FROM godown_stock WHERE godown_stock_id = ?
    `, [stockId]);

    if (affectedRows === 0) {
      return NextResponse.json({ error: 'Stock record not found' }, { status: 404 });
    }

    // Invalidate cache
    await RedisCache.delPattern('stock:*');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Stock DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}