/* 花间游戏 · 共享花朵 SVG 生成（拼图 / 找不同 / 翻卡片共用） */

/* 一朵五瓣花，返回 SVG 片段字符串 */
function flowerSVG(cx, cy, r, color, center, rot) {
  rot = rot || 0;
  let petals = '';
  for (let i = 0; i < 5; i++) {
    const a = (72 * i) * Math.PI / 180;
    // 花瓣：从花心向外伸的椭圆
    const px = Math.sin(a) * r * 0.62;
    const py = -Math.cos(a) * r * 0.62;
    petals += '<ellipse cx="' + px.toFixed(2) + '" cy="' + py.toFixed(2) + '" rx="' +
      (r * 0.34).toFixed(2) + '" ry="' + (r * 0.62).toFixed(2) +
      '" transform="rotate(' + (72 * i) + ' ' + px.toFixed(2) + ' ' + py.toFixed(2) + ')"/>';
  }
  return '<g transform="translate(' + cx + ',' + cy + ') rotate(' + rot + ')">' +
    '<g fill="' + color + '" stroke="rgba(36,31,26,.12)" stroke-width="1">' + petals + '</g>' +
    '<circle r="' + (r * 0.22).toFixed(2) + '" fill="' + center + '"/>' +
    '</g>';
}

/* 一片叶子 */
function leafSVG(cx, cy, l, rot, color) {
  return '<g transform="translate(' + cx + ',' + cy + ') rotate(' + rot + ')">' +
    '<path d="M0,0 C' + l * 0.3 + ',' + -l * 0.3 + ' ' + l * 0.24 + ',' + -l * 0.72 + ' 0,' + -l +
    ' C' + -l * 0.24 + ',' + -l * 0.72 + ' ' + -l * 0.3 + ',' + -l * 0.3 + ' 0,0 Z" fill="' + color + '"/>' +
    '</g>';
}

/* 拼图用：完整花冠图（300×300），返回 SVG 字符串 */
function crownArtSVG() {
  const colors = ['#A8342B', '#C9A24A', '#C4624E', '#E3C882', '#4C6157', '#7C231D'];
  let s = '<rect width="300" height="300" fill="#FBF7EF"/>';
  // 叶托
  for (let i = 0; i < 12; i++) {
    const a = i * 30 * Math.PI / 180;
    s += leafSVG(150 + Math.sin(a) * 108, 150 - Math.cos(a) * 108, 34, i * 30 + 180, '#7D8C6B');
  }
  // 外环 8 朵
  for (let i = 0; i < 8; i++) {
    const a = i * 45 * Math.PI / 180;
    s += flowerSVG(150 + Math.sin(a) * 100, 150 - Math.cos(a) * 100, 34,
      colors[i % colors.length], '#E3C882', i * 25);
  }
  // 内环 5 朵
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 + 20) * Math.PI / 180;
    s += flowerSVG(150 + Math.sin(a) * 56, 150 - Math.cos(a) * 56, 26,
      colors[(i + 2) % colors.length], '#C9A24A', i * 40);
  }
  // 中心大花
  s += flowerSVG(150, 150, 34, '#A8342B', '#E3C882', -18);
  // 细线圆环装饰
  s += '<circle cx="150" cy="150" r="136" fill="none" stroke="#C9A24A" stroke-width="1.5"/>';
  s += '<circle cx="150" cy="150" r="128" fill="none" stroke="rgba(36,31,26,.12)" stroke-width="1"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' + s + '</svg>';
}

/* 把 SVG 字符串转为可用作背景图的 data URI */
function svgToDataURI(svg) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* 找不同用：花园场景（300×300）
   variant = null      原图
   variant = 'diff'    改 3 处：外环1号花变色 / 外环5号花消失 / 中心花变小
   差异点坐标（供点击判定）：
     A (150, 44)   外环0号正上方 → 用 idx1 在 (230.5, 74.4) 附近，见下方数组
*/
const SPOT_FLOWERS = (function () {
  // 外环 8 朵的位置与颜色（固定，保证两图一致）
  const arr = [];
  const colors = ['#A8342B', '#C9A24A', '#C4624E', '#E3C882', '#4C6157', '#A8342B', '#C9A24A', '#C4624E'];
  for (let i = 0; i < 8; i++) {
    const a = i * 45 * Math.PI / 180;
    arr.push({
      x: 150 + Math.sin(a) * 104,
      y: 150 - Math.cos(a) * 104,
      r: 32, color: colors[i]
    });
  }
  return arr;
})();

const SPOT_DIFFS = [
  { x: SPOT_FLOWERS[1].x, y: SPOT_FLOWERS[1].y, r: 40 },  // 变色
  { x: SPOT_FLOWERS[5].x, y: SPOT_FLOWERS[5].y, r: 40 },  // 消失
  { x: 150, y: 150, r: 36 }                                // 中心变小
];

function gardenSceneSVG(isDiff) {
  let s = '<rect width="300" height="300" fill="#FBF7EF"/>';
  s += '<circle cx="150" cy="150" r="138" fill="none" stroke="#C9A24A" stroke-width="1.5"/>';
  // 叶托
  for (let i = 0; i < 8; i++) {
    const a = (i * 45 + 22) * Math.PI / 180;
    s += leafSVG(150 + Math.sin(a) * 112, 150 - Math.cos(a) * 112, 30, i * 45 + 202, '#7D8C6B');
  }
  // 外环 8 朵
  SPOT_FLOWERS.forEach(function (f, i) {
    if (isDiff && i === 5) return;                       // 差异2：消失
    const color = (isDiff && i === 1) ? '#7D8C6B' : f.color; // 差异1：变色
    s += flowerSVG(f.x, f.y, f.r, color, '#E3C882', i * 25);
  });
  // 内环 4 朵海青
  for (let i = 0; i < 4; i++) {
    const a = (i * 90 + 45) * Math.PI / 180;
    s += flowerSVG(150 + Math.sin(a) * 52, 150 - Math.cos(a) * 52, 22, '#4C6157', '#C9A24A', i * 40);
  }
  // 中心花（差异3：变小）
  s += flowerSVG(150, 150, isDiff ? 18 : 32, '#A8342B', '#E3C882', -18);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' + s + '</svg>';
}
