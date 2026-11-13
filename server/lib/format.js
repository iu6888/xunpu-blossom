'use strict';

/** 金额：分 → ¥ 文本（整元不显示小数） */
function money(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  if (fen === 0) return `${sign}¥${yuan}`;
  return `${sign}¥${yuan}.${String(fen).padStart(2, '0')}`;
}

/** 分 → 元（数值，便于前端二次计算） */
function toYuan(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

/* ------------------------------------------------------------------ */
/* 订单状态                                                            */
/* ------------------------------------------------------------------ */

const ORDER_STATUS = {
  pending: '待处理',
  confirmed: '已确认',
  producing: '生产中',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消'
};

const ORDER_FLOW = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['producing', 'shipped', 'cancelled'],
  producing: ['shipped', 'cancelled'],
  shipped: ['completed'],
  completed: [],
  cancelled: []
};

const INQUIRY_TYPES = {
  coop: '合作洽谈',
  batch: '批量定制',
  trial: '试戴预约',
  press: '媒体 / 图库授权'
};

const INQUIRY_STATUS = {
  new: '待跟进',
  following: '跟进中',
  done: '已完成',
  spam: '无效'
};

/* ------------------------------------------------------------------ */
/* 行 → 对外结构                                                        */
/* ------------------------------------------------------------------ */

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function variantOut(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    price: toYuan(row.price),
    priceCents: row.price,
    priceText: money(row.price),
    stock: row.stock,
    inStock: row.stock > 0,
    status: row.status
  };
}

function productOut(row, variants = []) {
  const list = variants.map(variantOut);
  const stock = list.reduce((n, v) => n + v.stock, 0);
  const active = list.filter((v) => v.status === 'active');
  const priceFrom = active.length ? Math.min(...active.map((v) => v.priceCents)) : row.price_from;

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    nameEn: row.name_en,
    category: row.category,
    categories: parseJson(row.categories, [row.category]),
    tagline: row.tagline,
    description: row.description,
    image: row.image,
    unit: row.unit,
    priceFrom: toYuan(priceFrom),
    priceFromCents: priceFrom,
    priceFromText: money(priceFrom),
    compareAt: row.compare_at ? toYuan(row.compare_at) : null,
    compareAtText: row.compare_at ? money(row.compare_at) : null,
    isLimited: !!row.is_limited,
    featured: !!row.featured,
    status: row.status,
    sortOrder: row.sort_order,
    specs: parseJson(row.specs, []),
    badges: parseJson(row.badges, []),
    stock,
    inStock: stock > 0,
    variants: list,
    url: `product-${row.slug}.html`,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function orderItemOut(row) {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    name: row.name,
    nameEn: row.name_en,
    variantName: row.variant_name,
    sku: row.sku,
    image: row.image,
    price: toYuan(row.price),
    priceCents: row.price,
    priceText: money(row.price),
    qty: row.qty,
    subtotal: toYuan(row.subtotal),
    subtotalCents: row.subtotal,
    subtotalText: money(row.subtotal)
  };
}

function orderOut(row, items = []) {
  return {
    id: row.id,
    orderNo: row.order_no,
    status: row.status,
    statusText: ORDER_STATUS[row.status] || row.status,
    customer: {
      name: row.customer_name,
      phone: row.phone,
      email: row.email || '',
      province: row.province || '',
      city: row.city || '',
      district: row.district || '',
      address: row.address || ''
    },
    note: row.note || '',
    adminNote: row.admin_note || '',
    channel: row.channel,
    payment: row.payment,
    itemsTotal: toYuan(row.items_total),
    itemsTotalCents: row.items_total,
    itemsTotalText: money(row.items_total),
    shippingFee: toYuan(row.shipping_fee),
    shippingFeeCents: row.shipping_fee,
    shippingFeeText: money(row.shipping_fee),
    total: toYuan(row.total),
    totalCents: row.total,
    totalText: money(row.total),
    paidAt: row.paid_at,
    day: row.day,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(orderItemOut)
  };
}

function inquiryOut(row) {
  return {
    id: row.id,
    type: row.type,
    typeText: INQUIRY_TYPES[row.type] || row.type,
    name: row.name,
    phone: row.phone,
    email: row.email || '',
    company: row.company || '',
    qty: row.qty,
    budget: row.budget || '',
    message: row.message || '',
    status: row.status,
    statusText: INQUIRY_STATUS[row.status] || row.status,
    adminNote: row.admin_note || '',
    day: row.day,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  money,
  toYuan,
  parseJson,
  ORDER_STATUS,
  ORDER_FLOW,
  INQUIRY_TYPES,
  INQUIRY_STATUS,
  productOut,
  variantOut,
  orderOut,
  orderItemOut,
  inquiryOut
};
