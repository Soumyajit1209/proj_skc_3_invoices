import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { RedisCache } from '@/lib/redis';
import { verifyToken, getTokenFromRequest, hasPermission } from '@/lib/auth';

const MASTER_MODELS = {
  'raw-materials': prisma.masterRawMaterial,
  'customers': prisma.masterCustomer,
  'vendors': prisma.masterVendor,
  'godowns': prisma.masterGodown,
  'hsn-codes': prisma.masterHsnSacCode,
  'units': prisma.masterRawMaterialUnit,
  'finished-products': prisma.masterFinishedProduct,
  'users': prisma.masterUser,
  'departments': prisma.masterUserDepartment,
} as const;

const INCLUDE_OPTIONS = {
  'raw-materials': { hsnSacCode: true },
  'finished-products': { hsnSacCode: true },
  'users': { departmentAccess: { include: { department: true } } },
} as const;

export async function GET(
  request: NextRequest,
  { params }: { params: { type: string } }
) {
  try {
    const token = getTokenFromRequest(request);
    if (!token) {
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

    const model = MASTER_MODELS[params.type as keyof typeof MASTER_MODELS];
    
    if (!model) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    await model.delete({
      where: { id: parseInt(id) }
    });

    // Invalidate cache
    await RedisCache.delPattern(`masters:${params.type}:*`);

    return NextResponse.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('Masters DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getSearchCondition(type: string, search: string) {
  switch (type) {
    case 'raw-materials':
      return {
        OR: [
          { raw_material_name: { contains: search } },
          { raw_material_code: { contains: search } }
        ]
      };
    case 'customers':
      return {
        OR: [
          { customer_name: { contains: search } },
          { customer_email: { contains: search } },
          { customer_gstin: { contains: search } }
        ]
      };
    case 'vendors':
      return {
        OR: [
          { vendor_name: { contains: search } },
          { vendor_email: { contains: search } },
          { vendor_gstin: { contains: search } }
        ]
      };
    case 'godowns':
      return {
        OR: [
          { godown_name: { contains: search } },
          { godown_code: { contains: search } }
        ]
      };
    case 'hsn-codes':
      return {
        OR: [
          { code: { contains: search } },
          { description: { contains: search } }
        ]
      };
    case 'users':
      return {
        OR: [
          { username: { contains: search } },
          { full_name: { contains: search } },
          { email: { contains: search } }
        ]
      };
    default:
      return {};
  }
}json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = verifyToken(token);
    if (!user || !hasPermission(user, 'MASTERS', 'read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const search = searchParams.get('search') || '';

    const cacheKey = RedisCache.getCacheKey('masters', params.type, page, limit, search);
    const cachedData = await RedisCache.get(cacheKey);
    
    if (cachedData) {
      return NextResponse.json(cachedData);
    }

    const model = MASTER_MODELS[params.type as keyof typeof MASTER_MODELS];
    if (!model) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    const skip = (page - 1) * limit;
    const includeOptions = INCLUDE_OPTIONS[params.type as keyof typeof INCLUDE_OPTIONS];

    // Build search condition based on master type
    const searchCondition = search ? getSearchCondition(params.type, search) : {};

    const [data, total] = await Promise.all([
      model.findMany({
        skip,
        take: limit,
        where: searchCondition,
        include: includeOptions,
        orderBy: { id: 'desc' }
      }),
      model.count({ where: searchCondition })
    ]);

    const result = {
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit
      }
    };

    await RedisCache.set(cacheKey, result, 3600); // 1 hour cache

    return NextResponse.json(result);
  } catch (error) {
    console.error('Masters GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
    const model = MASTER_MODELS[params.type as keyof typeof MASTER_MODELS];
    
    if (!model) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    const data = await model.create({
      data: body,
      include: INCLUDE_OPTIONS[params.type as keyof typeof INCLUDE_OPTIONS]
    });

    // Invalidate cache
    await RedisCache.delPattern(`masters:${params.type}:*`);

    return NextResponse.json(data, { status: 201 });
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
    const model = MASTER_MODELS[params.type as keyof typeof MASTER_MODELS];
    
    if (!model) {
      return NextResponse.json({ error: 'Invalid master type' }, { status: 400 });
    }

    const data = await model.update({
      where: { id: parseInt(id) },
      data: body,
      include: INCLUDE_OPTIONS[params.type as keyof typeof INCLUDE_OPTIONS]
    });

    // Invalidate cache
    await RedisCache.delPattern(`masters:${params.type}:*`);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Masters PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}