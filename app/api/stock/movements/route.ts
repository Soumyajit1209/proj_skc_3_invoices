// app/api/stock/movements/route.ts
export const config = {
  runtime: 'nodejs',
};

import { NextRequest, NextResponse } from 'next/server';
import { Database } from '@/lib/db';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';

// GET /api/stock/movements - Get stock movement history
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
    const materialId = searchParams.get('material_id');
    const godownId = searchParams.get('godown_id');
    const movementType = searchParams.get('type'); // 'in', 'out', 'transfer'

    // Get stock-in movements from purchased_item_details
    const stockInQuery = `
      SELECT 
        'stock_in' as movement_type,
        pid.purchased_item_details_id as movement_id,
        pid.raw_material_id,
        pid.raw_material_quantity as quantity,
        pi.invoice_date as movement_date,
        pi.godown_id,
        pi.invoice_no as reference_no,
        'Purchase' as description,
        mrm.raw_material_name,
        mg.godown_name,
        mv.vendor_name as source_destination
      FROM purchased_item_details pid
      JOIN purchased_item pi ON pid.purchased_id = pi.purchased_id
      LEFT JOIN master_raw_material mrm ON pid.raw_material_id = mrm.raw_material_id
      LEFT JOIN master_godown mg ON pi.godown_id = mg.godown_id
      LEFT JOIN master_vendor mv ON pi.vendor_id = mv.vendor_id
    `;

    // Get stock-out movements from raw_material_stockout_details
    const stockOutQuery = `
      SELECT 
        'stock_out' as movement_type,
        rmsd.stockout_details_id as movement_id,
        rmsd.raw_material_id,
        rmsd.raw_material_quantity as quantity,
        rms.stockout_date as movement_date,
        rms.godown_id,
        CONCAT('SO-', rms.stockout_id) as reference_no,
        CONCAT('Stock Out - ', rms.remarks) as description,
        mrm.raw_material_name,
        mg.godown_name,
        apm.assign_person_name as source_destination
      FROM raw_material_stockout_details rmsd
      JOIN raw_material_stockout rms ON rmsd.stockout_id = rms.stockout_id
      LEFT JOIN master_raw_material mrm ON rmsd.raw_material_id = mrm.raw_material_id
      LEFT JOIN master_godown mg ON rms.godown_id = mg.godown_id
      LEFT JOIN assign_person_master apm ON rms.assign_person_id = apm.assign_person_id
    `;

    // Get return movements from raw_material_return_details
    const returnQuery = `
      SELECT 
        'stock_return' as movement_type,
        rmrd.return_details_id as movement_id,
        rmrd.raw_material_id,
        rmrd.raw_material_quantity as quantity,
        rmr.return_date as movement_date,
        rms.godown_id,
        CONCAT('RET-', rmr.stockout_return_id) as reference_no,
        CONCAT('Return - ', rmr.remarks) as description,
        mrm.raw_material_name,
        mg.godown_name,
        apm.assign_person_name as source_destination
      FROM raw_material_return_details rmrd
      JOIN raw_material_return rmr ON rmrd.stockout_return_id = rmr.stockout_return_id
      JOIN raw_material_stockout rms ON rmr.stockout_id = rms.stockout_id
      LEFT JOIN master_raw_material mrm ON rmrd.raw_material_id = mrm.raw_material_id
      LEFT JOIN master_godown mg ON rms.godown_id = mg.godown_id
      LEFT JOIN assign_person_master apm ON rms.assign_person_id = apm.assign_person_id
    `;

    let whereConditions: string[] = [];
    let whereParams: any[] = [];

    if (materialId) {
      whereConditions.push('raw_material_id = ?');
      whereParams.push(materialId);
    }

    if (godownId) {
      whereConditions.push('godown_id = ?');
      whereParams.push(godownId);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    let unionQuery = '';
    if (!movementType || movementType === 'in') {
      unionQuery += stockInQuery + (whereClause ? ' ' + whereClause : '');
    }

    if (!movementType || movementType === 'out') {
      if (unionQuery) unionQuery += ' UNION ALL ';
      unionQuery += stockOutQuery + (whereClause ? ' ' + whereClause : '');
    }

    if (!movementType || movementType === 'return') {
      if (unionQuery) unionQuery += ' UNION ALL ';
      unionQuery += returnQuery + (whereClause ? ' ' + whereClause : '');
    }

    const finalQuery = `
      SELECT * FROM (${unionQuery}) as movements
      ORDER BY movement_date DESC, movement_id DESC
      LIMIT ? OFFSET ?
    `;

    const offset = (page - 1) * limit;
    const params = [...whereParams, ...whereParams, ...whereParams, limit, offset];

    const movements = await Database.query(finalQuery, params);

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM (${unionQuery}) as movements`;
    const totalResult = await Database.queryFirst<{ total: number }>(countQuery, [...whereParams, ...whereParams, ...whereParams]);

    const result = {
      data: movements.map((movement: any) => ({
        ...movement,
        quantity: parseFloat(movement.quantity) || 0,
        movement_date: movement.movement_date
      })),
      pagination: {
        currentPage: page,
        totalPages: Math.ceil((totalResult?.total || 0) / limit),
        totalItems: totalResult?.total || 0,
        itemsPerPage: limit
      }
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Stock movements GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/stock/movements - Create manual stock movement
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
    const { 
      movement_type, // 'adjustment', 'transfer', 'damage', 'manual'
      raw_material_id,
      from_godown_id,
      to_godown_id,
      quantity,
      remarks
    } = body;

    if (!movement_type || !raw_material_id || !quantity) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (quantity <= 0) {
      return NextResponse.json({ error: 'Quantity must be greater than 0' }, { status: 400 });
    }

    // Handle different movement types
    if (movement_type === 'transfer') {
      if (!from_godown_id || !to_godown_id) {
        return NextResponse.json({ error: 'Both source and destination godowns required for transfer' }, { status: 400 });
      }

      if (from_godown_id === to_godown_id) {
        return NextResponse.json({ error: 'Source and destination godowns cannot be the same' }, { status: 400 });
      }

      // Check stock availability in source godown
      const sourceStock = await Database.queryFirst(`
        SELECT quantity FROM godown_stock 
        WHERE godown_id = ? AND raw_material_id = ?
      `, [from_godown_id, raw_material_id]);

      if (!sourceStock || parseFloat(sourceStock.quantity) < quantity) {
        return NextResponse.json({ error: 'Insufficient stock in source godown' }, { status: 400 });
      }

      // Reduce stock from source godown
      await Database.execute(`
        UPDATE godown_stock 
        SET quantity = quantity - ? 
        WHERE godown_id = ? AND raw_material_id = ?
      `, [quantity, from_godown_id, raw_material_id]);

      // Add stock to destination godown
      const destStock = await Database.queryFirst(`
        SELECT * FROM godown_stock 
        WHERE godown_id = ? AND raw_material_id = ?
      `, [to_godown_id, raw_material_id]);

      if (destStock) {
        await Database.execute(`
          UPDATE godown_stock 
          SET quantity = quantity + ? 
          WHERE godown_id = ? AND raw_material_id = ?
        `, [quantity, to_godown_id, raw_material_id]);
      } else {
        await Database.insert(`
          INSERT INTO godown_stock (godown_id, raw_material_id, quantity) 
          VALUES (?, ?, ?)
        `, [to_godown_id, raw_material_id, quantity]);
      }

      // Record the movement as stockout from source
      const stockoutId = await Database.insert(`
        INSERT INTO raw_material_stockout (stockout_date, godown_id, assign_person_id, remarks) 
        VALUES (CURDATE(), ?, 1, ?)
      `, [from_godown_id, `Transfer to godown ID ${to_godown_id}: ${remarks || 'Stock transfer'}`]);

      await Database.insert(`
        INSERT INTO raw_material_stockout_details (stockout_id, raw_material_id, raw_material_quantity) 
        VALUES (?, ?, ?)
      `, [stockoutId, raw_material_id, quantity]);

    } else if (movement_type === 'adjustment' || movement_type === 'damage' || movement_type === 'manual') {
      const godown_id = from_godown_id || to_godown_id;
      if (!godown_id) {
        return NextResponse.json({ error: 'Godown ID is required' }, { status: 400 });
      }

      // Update stock directly
      const existingStock = await Database.queryFirst(`
        SELECT * FROM godown_stock 
        WHERE godown_id = ? AND raw_material_id = ?
      `, [godown_id, raw_material_id]);

      if (existingStock) {
        const newQuantity = parseFloat(existingStock.quantity) + (movement_type === 'damage' ? -quantity : quantity);
        if (newQuantity < 0) {
          return NextResponse.json({ error: 'Adjustment would result in negative stock' }, { status: 400 });
        }

        await Database.execute(`
          UPDATE godown_stock SET quantity = ? 
          WHERE godown_id = ? AND raw_material_id = ?
        `, [newQuantity, godown_id, raw_material_id]);
      } else {
        if (movement_type === 'damage') {
          return NextResponse.json({ error: 'Cannot reduce stock for non-existent item' }, { status: 400 });
        }

        await Database.insert(`
          INSERT INTO godown_stock (godown_id, raw_material_id, quantity) 
          VALUES (?, ?, ?)
        `, [godown_id, raw_material_id, quantity]);
      }
    }

    // Clear cache
    await RedisCache.delPattern('stock:*');

    return NextResponse.json({ 
      success: true, 
      message: `${movement_type} completed successfully`,
      details: {
        movement_type,
        raw_material_id,
        quantity,
        from_godown_id,
        to_godown_id
      }
    });
  } catch (error) {
    console.error('Stock movement error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}