'use strict';

/**
 * 初始化数据：6 件城市礼物、分类、站点文案、管理员账号。
 *   node server/db/seed.js           幂等补齐（已存在的商品跳过）
 *   node server/db/seed.js --reset   清空业务数据后重建（保留结构）
 */

const fs = require('node:fs');
const { getDb, closeDb } = require('./index');
const config = require('../config');
const { hashPassword, dayKey } = require('../lib/security');
const log = require('../lib/logger');

/* ------------------------------------------------------------------ */
/* 分类                                                                */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  { key: 'wear', name: '可佩戴', nameEn: 'Wearable' },
  { key: 'scent', name: '香氛', nameEn: 'Fragrance' },
  { key: 'textile', name: '织物', nameEn: 'Textile' },
  { key: 'object', name: '器物', nameEn: 'Object' },
  { key: 'gift', name: '礼盒', nameEn: 'Gift Set' }
];

/* ------------------------------------------------------------------ */
/* 六件单品                                                            */
/* ------------------------------------------------------------------ */

const PRODUCTS = [
  {
    slug: 'garland',
    name: '花冠 · 头顶花园',
    name_en: 'Adjustable Flower Crown',
    category: 'wear',
    categories: ['wear'],
    tagline: '二十二簇真丝绢花，三点卡扣可拆可换。',
    description:
      '把蟳埔女的一顶花园，做成可以反复佩戴的日常饰物。二十二簇绢花沿发箍层层围戴，单簇三点卡扣，可拆、可换、可补。外圈大花定轮廓，中圈主花定节奏，内圈小花填缝隙。',
    image: 'assets/img/p-garland.svg',
    unit: '顶',
    specs: [
      { label: '外径', value: 'Φ 220 mm' },
      { label: '高度', value: '90 mm' },
      { label: '发箍内径', value: '160 — 185 mm 可调' },
      { label: '净重', value: '168 g ± 5 g' },
      { label: '材质', value: '真丝绢花、棉线缠花、铜镀金发箍、淡水珍珠' },
      { label: '模块', value: '花簇 22 簇，三点卡扣可替换' }
    ],
    badges: ['国家级非遗元素', '手工缠花', '可替换模块', '泉州本地工艺'],
    featured: 1,
    sort_order: 1,
    variants: [
      { sku: 'XB-GAR-SX', name: '素馨白', price: 39800, stock: 16 },
      { sku: 'XB-GAR-HX', name: '含笑金', price: 39800, stock: 14 },
      { sku: 'XB-GAR-CT', name: '刺桐红', price: 39800, stock: 11 },
      { sku: 'XB-GAR-GF', name: '礼盒版（硬质礼盒 + 编号卡）', price: 45800, stock: 7 }
    ]
  },
  {
    slug: 'incense',
    name: '花事三叠 · 香氛',
    name_en: 'Three-fold Fragrance Set',
    category: 'scent',
    categories: ['scent'],
    tagline: '素馨香膏、含笑线香、海风香囊，把清晨花市的气味收进骨瓷小盒。',
    description:
      '素馨—含笑—海盐的三段式香调：前调是花市清晨的素馨，中调含笑微甜，尾调落在海盐与木质感上。三件装在一只骨瓷小盒里，开盒即是泉州湾的风。',
    image: 'assets/img/p-incense.svg',
    unit: '套',
    specs: [
      { label: '内容', value: '素馨香膏 15g / 含笑线香 20 支 / 海风香囊 1 只' },
      { label: '香调', value: '素馨 — 含笑 — 海盐' },
      { label: '香膏基底', value: '乳木果油、蜂蜡、荷荷巴油' },
      { label: '线香', value: '天然沉香粉 + 含笑花萃取，燃烧约 25 分钟/支' },
      { label: '香囊', value: '棉麻囊体，内填干燥素馨与海盐' },
      { label: '包装', value: '骨瓷盒 + 再生纸礼盒 + 说明卡' }
    ],
    badges: ['天然香材', '骨瓷盒装', '三段式香调'],
    featured: 1,
    sort_order: 2,
    variants: [
      { sku: 'XB-INC-ST', name: '标准套', price: 26800, stock: 68 },
      { sku: 'XB-INC-DB', name: '双套礼赠装', price: 49800, stock: 24 }
    ]
  },
  {
    slug: 'scarf',
    name: '半城红 · 真丝方巾',
    name_en: 'Silk Scarf · Half City Red',
    category: 'textile',
    categories: ['textile'],
    tagline: '把花冠从头顶取下来，铺成一方九〇公分的图案。',
    description:
      '花冠俯视同心纹铺满整幅：三层花环是骨架，五瓣母题是最小单位。刺桐红与蚝壳白，是泉州的两句底色。16 姆米桑蚕丝，四边手工卷边。',
    image: 'assets/img/p-scarf.svg',
    unit: '条',
    specs: [
      { label: '尺寸', value: '900 × 900 mm' },
      { label: '材质', value: '16 姆米桑蚕丝（100% 桑蚕丝）' },
      { label: '工艺', value: '数码印花 + 四边手工卷边' },
      { label: '纹样', value: '花冠俯视同心纹 · 三层花环 + 五瓣母题' },
      { label: '配色', value: '刺桐红 / 蚝壳白 / 素馨金' },
      { label: '包装', value: '真丝束口袋 + 再生纸礼盒' }
    ],
    badges: ['100% 桑蚕丝', '手工卷边', '石狮织造'],
    featured: 1,
    sort_order: 3,
    variants: [
      { sku: 'XB-SCF-CT', name: '刺桐红', price: 36800, stock: 32 },
      { sku: 'XB-SCF-HK', name: '蚝壳白', price: 36800, stock: 28 },
      { sku: 'XB-SCF-SX', name: '素馨金', price: 36800, stock: 20 }
    ]
  },
  {
    slug: 'cup',
    name: '蚝壳月 · 骨瓷对杯',
    name_en: 'Bone China Cup Pair',
    category: 'object',
    categories: ['object'],
    tagline: '下半部浮雕蚝壳厝墙面肌理，上半部一轮花冠暗纹。',
    description:
      '德化骨瓷，透光温润。杯身下半部以浮雕还原蚝壳厝的墙面肌理，上半部压一轮花冠暗纹，口沿手工描金——一只手能握住的泉州。',
    image: 'assets/img/p-cup.svg',
    unit: '对',
    specs: [
      { label: '容量', value: '220 ml × 2' },
      { label: '材质', value: '德化骨瓷，透光温润' },
      { label: '工艺', value: '浮雕蚝壳肌理 + 釉下彩花冠纹 + 手工描金口沿' },
      { label: '尺寸', value: 'Φ 78 × H 92 mm（单杯）' },
      { label: '适用', value: '可微波（金边款建议手洗）' },
      { label: '包装', value: '双层绒布礼盒 + 说明卡' }
    ],
    badges: ['德化骨瓷', '浮雕工艺', '手工描金'],
    featured: 0,
    sort_order: 4,
    variants: [
      { sku: 'XB-CUP-SB', name: '素白（无金边）', price: 29800, stock: 26 },
      { sku: 'XB-CUP-MJ', name: '描金口沿', price: 32800, stock: 19 }
    ]
  },
  {
    slug: 'bookmark',
    name: '花签 · 黄铜书签',
    name_en: 'Brass Bookmark',
    category: 'object',
    categories: ['object', 'wear'],
    tagline: '五瓣花冠轮廓，顶端一枚朱红烤漆花心。',
    description:
      'H62 黄铜蚀刻，拉丝面处理，顶端一枚朱红烤漆花心，配真丝流苏。附同款冰箱贴，可单买，也可成对。39 元的入门礼物，最适合随手带走。',
    image: 'assets/img/p-bookmark.svg',
    unit: '件',
    specs: [
      { label: '尺寸', value: '32 × 128 × 0.8 mm' },
      { label: '材质', value: 'H62 黄铜，拉丝面' },
      { label: '工艺', value: '蚀刻 + 朱红烤漆 + 手工穿流苏' },
      { label: '配件', value: '真丝流苏，长 60 mm' },
      { label: '款式', value: '书签 / 冰箱贴（同纹样）' },
      { label: '包装', value: '纸质卡套 + 透明封袋' }
    ],
    badges: ['黄铜蚀刻', '39 元入门', '可配冰箱贴'],
    featured: 0,
    sort_order: 5,
    variants: [
      { sku: 'XB-BMK-BK', name: '书签', price: 3900, stock: 180 },
      { sku: 'XB-BMK-MG', name: '冰箱贴', price: 3900, stock: 120 },
      { sku: 'XB-BMK-SET', name: '书签 + 冰箱贴', price: 6900, stock: 96 }
    ]
  },
  {
    slug: 'giftbox',
    name: '头顶花园 · 典藏礼盒',
    name_en: "Collector's Gift Box",
    category: 'gift',
    categories: ['gift'],
    tagline: '花冠、香氛、方巾、花签四件成套，限量 500 套。',
    description:
      '四件成套，亚麻内衬硬质礼盒 320×320×120mm，附独立编号卡与手写祝福。可加企业 LOGO、腰封与祝福卡文案。限量 500 套，售完不补。',
    image: 'assets/img/p-giftbox.svg',
    unit: '套',
    specs: [
      { label: '内含', value: '花冠（含收纳袋）/ 花事三叠香氛 / 真丝方巾 / 黄铜花签' },
      { label: '礼盒', value: '硬质盒 320 × 320 × 120 mm，亚麻内衬' },
      { label: '限量', value: '500 套，附独立编号卡' },
      { label: '定制', value: '可加企业 LOGO、腰封与祝福卡文案' },
      { label: '交付', value: '现货 7 天 / 定制 30 天' }
    ],
    badges: ['限量 500 套', '四件成套', '编号卡'],
    featured: 1,
    is_limited: 1,
    sort_order: 6,
    variants: [
      { sku: 'XB-GBX-ST', name: '典藏版', price: 59800, stock: 9 },
      { sku: 'XB-GBX-BZ', name: '典藏版 + 企业定制', price: 69800, stock: 5 }
    ]
  }
];

/* ------------------------------------------------------------------ */
/* 站点文案                                                            */
/* ------------------------------------------------------------------ */

const CONTENT = {
  'site.contact': {
    email: 'hello@xunpublossom.cn',
    phone: '0595-8888 0666',
    showroom: '泉州市丰泽区蟳埔社区 · 花事小院',
    hours: '每日 10:00 — 19:00（周一闭院）'
  },
  'site.stats': [
    { num: '04', unit: '季', label: '花材更替' },
    { num: '22', unit: '簇', label: '可替换花簇模块' },
    { num: '06', unit: '件', label: '城市礼物单品' },
    { num: '01', unit: '城', label: '刺桐城 · 泉州' }
  ],
  'site.timeline': [
    { year: '宋元', note: '11—14 世纪', title: '海舶载花来', text: '刺桐港帆樯如林。素馨与茉莉随商舶上岸，在泉州落户生根。相传「素馨」之名，来自一位波斯女子。' },
    { year: '明清', note: '渔村成形', title: '蚝壳砌成厝', text: '海蛎壳垒墙、红砖压脊，蟳埔的巷子由此有了海的样子。「千年砖，万年蚵」，说的就是这份耐得住海风的硬气。' },
    { year: '2008', note: '国家级名录', title: '蟳埔女习俗', text: '大裾衫、宽筒裤、丁香耳坠与簪花围，一同被列入第二批国家级非物质文化遗产名录。' },
    { year: '今日', note: '城市名片', title: '头顶的花园', text: '旅人排队来戴一顶花。簪花围从渔家日常，变成了泉州最生动的一张城市名片。' }
  ],
  'site.palette': [
    { name: '蚝壳白', hex: '#F3EEE4' },
    { name: '刺桐红', hex: '#A8342B' },
    { name: '素馨金', hex: '#C9A24A' },
    { name: '海青', hex: '#4C6157' },
    { name: '发髻墨', hex: '#241F1A' }
  ],
  'site.notice': {
    enabled: true,
    text: '典藏礼盒限量 500 套 · 现货 7 天内发出',
    link: 'product-giftbox.html'
  },
  'site.shipping': {
    freeThreshold: config.freeShippingThresholdCents,
    fee: config.shippingFeeCents,
    note: '全国顺丰包邮，满 ¥299 免运费；港澳台与海外另计。'
  }
};

/* ------------------------------------------------------------------ */
/* 执行                                                                */
/* ------------------------------------------------------------------ */

function nowIso() {
  return new Date().toISOString();
}

function seed({ reset = false } = {}) {
  const db = getDb();
  const now = nowIso();
  const day = dayKey(new Date(), config.timezone);

  if (reset) {
    db.tx(() => {
      db.exec(`
        DELETE FROM order_items; DELETE FROM orders;
        DELETE FROM cart_items; DELETE FROM carts;
        DELETE FROM inquiries; DELETE FROM events;
        DELETE FROM customer_sessions; DELETE FROM customers;
        DELETE FROM variants; DELETE FROM products;
        DELETE FROM content; DELETE FROM counters;
        DELETE FROM sessions;
      `);
    });
    log.warn('已清空业务数据（--reset）');
  }

  // 管理员
  const userCount = db.get('SELECT COUNT(*) AS n FROM users').n;
  if (userCount === 0) {
    db.run(
      'INSERT INTO users (username, password_hash, name, role, created_at) VALUES (?, ?, ?, ?, ?)',
      config.adminUser,
      hashPassword(config.adminPassword),
      config.adminName,
      'owner',
      now
    );
    log.ready(`管理员账号已创建：${config.adminUser}`);
  }

  // 商品
  let created = 0;
  db.tx(() => {
    for (const p of PRODUCTS) {
      const exists = db.get('SELECT id FROM products WHERE slug = ?', p.slug);
      if (exists) continue;

      const priceFrom = Math.min(...p.variants.map((v) => v.price));
      const res = db.run(
        `INSERT INTO products
          (slug, name, name_en, category, categories, tagline, description, specs, badges,
           image, unit, price_from, compare_at, is_limited, featured, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        p.slug,
        p.name,
        p.name_en,
        p.category,
        JSON.stringify(p.categories || [p.category]),
        p.tagline,
        p.description,
        JSON.stringify(p.specs || []),
        JSON.stringify(p.badges || []),
        p.image,
        p.unit,
        priceFrom,
        p.compare_at || null,
        p.is_limited ? 1 : 0,
        p.featured ? 1 : 0,
        p.sort_order,
        now,
        now
      );

      p.variants.forEach((v, i) => {
        db.run(
          'INSERT INTO variants (product_id, sku, name, price, stock, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
          res.lastInsertRowid,
          v.sku,
          v.name,
          v.price,
          v.stock,
          i
        );
      });
      created++;
    }
  });
  if (created) log.ready(`已写入 ${created} 件商品 / ${PRODUCTS.reduce((n, p) => n + p.variants.length, 0)} 个 SKU`);

  // 站点文案
  db.tx(() => {
    for (const [key, value] of Object.entries(CONTENT)) {
      const exists = db.get('SELECT key FROM content WHERE key = ?', key);
      if (exists) continue;
      db.run('INSERT INTO content (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now);
    }
  });

  return { products: db.get('SELECT COUNT(*) AS n FROM products').n, day };
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  const result = seed({ reset });
  log.ready(`初始化完成：${result.products} 件商品，日期 ${result.day}`);
  if (config.adminPassword === 'xunpu2026') {
    log.warn('当前使用默认管理员密码，上线前请通过 ADMIN_PASSWORD 环境变量修改');
  }
  closeDb();
}

module.exports = { seed, PRODUCTS, CATEGORIES, CONTENT };
