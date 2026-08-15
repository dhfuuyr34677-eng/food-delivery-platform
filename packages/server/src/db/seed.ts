import { db } from './index.js';
import { admins, shops, categories, products, deliveryProviders } from './schema.js';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('[Seed] Starting...');

  // Create default admin
  const pwd = await bcrypt.hash('admin123', 10);
  await db.insert(admins).values({
    username: 'admin',
    passwordHash: pwd,
    role: 'super_admin',
  }).onConflictDoNothing();
  console.log('[Seed] Admin created (admin / admin123)');

  // Create demo shops
  const shopList = [
    { name: '老街味道', description: '地道川菜，传承30年味道', lat: 30.5728, lng: 104.0668 },
    { name: '幸福烘焙坊', description: '新鲜烘焙，每日现做', lat: 30.5740, lng: 104.0680 },
    { name: '粤港茶餐厅', description: '正宗港式茶餐厅', lat: 30.5715, lng: 104.0650 },
  ];

  for (const s of shopList) {
    const [row] = await db
      .insert(shops)
      .values({
        name: s.name,
        description: s.description,
        address: `${s.name}地址XXX号`,
        phone: '1380000xxxx',
        status: 'active',
        // PostGIS geometry: ST_SetSRID(ST_MakePoint(lng, lat), 4326)
        // We'll use raw SQL for the geometry column
      })
      .returning({ id: shops.id });

    // Update location with raw SQL (PostGIS)
    await db.execute(
      `UPDATE shops SET location = ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326) WHERE id = '${row.id}'`,
    );

    // Create default category and products for each shop
    const cat = await db.insert(categories).values({
      shopId: row.id,
      name: '招牌推荐',
      sortOrder: 0,
    }).returning({ id: categories.id });

    const items = [
      { name: `${s.name}招牌菜`, price: 2800 },
      { name: '经典小炒', price: 1800 },
      { name: '特色饮品', price: 800 },
    ];

    for (const item of items) {
      await db.insert(products).values({
        shopId: row.id,
        categoryId: cat[0].id,
        name: item.name,
        price: item.price,
        isAvailable: true,
      });
    }

    console.log(`[Seed] Shop "${s.name}" created with 3 products`);
  }

  // Create default Dada delivery provider (mock mode — real credentials needed for production)
  await db.insert(deliveryProviders).values({
    name: 'dada',
    displayName: '达达秒送',
    config: {
      appKey: 'mock_app_key',
      appSecret: 'mock_app_secret',
      sourceId: 'mock_source_id',
      baseUrl: 'http://newopen.qa.imdada.cn', // Dada test environment
    },
    isActive: true,
  }).onConflictDoNothing();
  console.log('[Seed] Dada delivery provider created (mock mode)');

  console.log('[Seed] Done.');
  process.exit(0);
}

seed().catch((e) => {
  console.error('[Seed] Error:', e);
  process.exit(1);
});
