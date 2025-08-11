import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

    const skip = (page - 1) * limit;
    
    const whereCondition = godownId ? { godown_id: parseInt(godownId) } : {};

    const [stockData, total] = await Promise.all([
      prisma.godownStock.findMany({
        skip,
        take: limit,
        where: whereCondition,
        include: {
          godown: true,
          rawMaterial: {
            include: {
              hsnSacCode: true
            }
          },
          finishedProduct: {
            include: {
              hsnSacCode: true
            }
          },
          unit: true
        },
        orderBy: { id: 'desc' }
      }),
      prisma.godownStock.count({ where: whereCondition })
    ]);

    const result = {
      data: stockData,
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
    const { godown_id, raw_material_id, finished_product_id, quantity, unit_id, rate } = body;

    if (!godown_id || !unit_id || !quantity || !rate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!raw_material_id && !finished_product_id) {
      return NextResponse.json({ error: 'Either raw_material_id or finished_product_id is required' }, { status: 400 });
    }

    const amount = parseFloat(quantity) * parseFloat(rate);

    const stockData = await prisma.godownStock.create({
      data: {
        godown_id: parseInt(godown_id),
        raw_material_id: raw_material_id ? parseInt(raw_material_id) : null,
        finished_product_id: finished_product_id ? parseInt(finished_product_id) : null,
        quantity: parseFloat(quantity),
        unit_id: parseInt(unit_id),
        rate: parseFloat(rate),
        amount
      },
      include: {
        godown: true,
        rawMaterial: {
          include: {
            hsnSacCode: true
          }
        },
        finishedProduct: {
          include: {
            hsnSacCode: true
          }
        },
        unit: true
      }
    });

    // Invalidate cache
    await RedisCache.delPattern('stock:*');

    return NextResponse.json(stockData, { status: 201 });
  } catch (error) {
    console.error('Stock POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}