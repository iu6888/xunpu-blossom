'use strict';

const { badRequest } = require('./http');

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

/** 必填字符串：去空白、限长 */
function str(value, field, { min = 1, max = 200, required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw badRequest(`${field} 不能为空`, { field });
    return undefined;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw badRequest(`${field} 不能为空`, { field });
    return '';
  }
  if (text.length < min) throw badRequest(`${field} 至少 ${min} 个字符`, { field });
  if (text.length > max) throw badRequest(`${field} 不能超过 ${max} 个字符`, { field });
  return text;
}

/** 可选字符串 */
function optStr(value, field, opts = {}) {
  return str(value, field, { ...opts, required: false });
}

/** 手机号（中国大陆） */
function phone(value, field = '手机号') {
  const text = str(value, field, { min: 11, max: 20 });
  const digits = text.replace(/[\s-]/g, '');
  if (!PHONE_RE.test(digits)) throw badRequest(`${field}格式不正确`, { field });
  return digits;
}

/** 邮箱（可选） */
function email(value, field = '邮箱', { required = false } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw badRequest(`${field} 不能为空`, { field });
    return undefined;
  }
  const text = String(value).trim();
  if (!EMAIL_RE.test(text)) throw badRequest(`${field}格式不正确`, { field });
  return text;
}

/** 整数 */
function int(value, field, { min = -Infinity, max = Infinity, fallback } = {}) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field} 不能为空`, { field });
  }
  const n = Number(value);
  if (!Number.isInteger(n)) throw badRequest(`${field} 必须是整数`, { field });
  if (n < min) throw badRequest(`${field} 不能小于 ${min}`, { field });
  if (n > max) throw badRequest(`${field} 不能大于 ${max}`, { field });
  return n;
}

/** 枚举值 */
function oneOf(value, field, allowed, fallback) {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const text = String(value ?? '').trim();
  if (!allowed.includes(text)) {
    throw badRequest(`${field} 只能是 ${allowed.join(' / ')}`, { field, allowed });
  }
  return text;
}

/** 布尔 */
function boolean(value, field, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(String(value).toLowerCase())) return false;
  throw badRequest(`${field} 必须是布尔值`, { field });
}

/** 元 → 分（正则校验两位小数，避免浮点误差） */
function yuanToCents(value, field = '价格') {
  const text = String(value ?? '').trim().replace(/[¥￥,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw badRequest(`${field}格式不正确，应为最多两位小数的金额`, { field });
  const [yuan, frac = ''] = text.split('.');
  return Number(yuan) * 100 + Number(frac.padEnd(2, '0'));
}

/** 对象数组 */
function array(value, field, { min = 1, max = 100 } = {}) {
  if (!Array.isArray(value)) throw badRequest(`${field} 必须是数组`, { field });
  if (value.length < min) throw badRequest(`${field} 至少需要 ${min} 项`, { field });
  if (value.length > max) throw badRequest(`${field} 最多 ${max} 项`, { field });
  return value;
}

module.exports = {
  str,
  optStr,
  phone,
  email,
  int,
  oneOf,
  boolean,
  yuanToCents,
  array,
  PHONE_RE,
  EMAIL_RE
};
