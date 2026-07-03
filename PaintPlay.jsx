import { useState, useRef, useEffect, useCallback } from "react";

// ===== 色定義 =====
const PAINTS = {
  white:      { label: "しろ",       hex: "#ffffff", border: "#ccc" },
  black:      { label: "くろ",       hex: "#222222", border: "#000" },
  red:        { label: "あか",       hex: "#e53935", border: "#b71c1c" },
  blue:       { label: "あお",       hex: "#1e88e5", border: "#0d47a1" },
  yellow:     { label: "きいろ",     hex: "#fdd835", border: "#f9a825" },
  green:      { label: "みどり",     hex: "#43a047", border: "#1b5e20" },
  orange:     { label: "だいだい",   hex: "#fb8c00", border: "#e65100" },
  purple:     { label: "むらさき",   hex: "#8e24aa", border: "#4a148c" },
  pink:       { label: "ぴんく",     hex: "#f48fb1", border: "#c2185b" },
  brown:      { label: "ちゃいろ",   hex: "#795548", border: "#3e2723" },
  lightBlue:  { label: "みずいろ",   hex: "#81d4fa", border: "#0288d1" },
  lightGreen: { label: "きみどり",   hex: "#aed581", border: "#558b2f" },
  gray:       { label: "はいいろ",   hex: "#9e9e9e", border: "#424242" },
  cream:      { label: "くりーむ",   hex: "#fff4b8", border: "#f9a825" },
  paleGreen:  { label: "うすきみどり",hex: "#d7f2b3", border: "#aed581" },
};

const TUBE_COLORS = ["red", "blue", "yellow", "white", "black", "lightBlue"];
const PAPER_COLOR = "#fdf8f0";
const WELL_COUNT = 5;
const ZUKAN_STORAGE_KEY = "paintplay.zukan.v1";

// ===== 混色テーブル =====
function mixKey(colors) { return [...colors].sort().join("+"); }

const pairMixMap = (() => {
  const pairs = [
    ["red","blue","purple"], ["red","yellow","orange"], ["blue","yellow","green"],
    ["red","white","pink"], ["blue","white","lightBlue"], ["green","white","lightGreen"],
    ["black","white","gray"], ["yellow","lightBlue","lightGreen"], ["red","lightBlue","purple"],
    ["black","red","brown"], ["black","yellow","brown"], ["black","orange","brown"],
    ["red","green","brown"], ["blue","orange","brown"],
  ];
  const map = {};
  for (const [a,b,r] of pairs) map[mixKey([a,b])] = r;
  return map;
})();

const exactMixMap = (() => {
  const exact = [
    [["white","yellow","lightBlue"],"paleGreen"], [["white","red","yellow"],"cream"],
    [["white","red","blue"],"purple"], [["black","red","yellow"],"brown"], [["red","blue","yellow"],"brown"],
  ];
  const map = {};
  for (const [ing,r] of exact) map[mixKey(ing)] = r;
  return map;
})();

function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}
function rgbToHex({r,g,b}) {
  return "#"+[r,g,b].map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("");
}
function lighten(hex, amt) {
  const {r,g,b} = hexToRgb(hex);
  return rgbToHex({ r:r+(255-r)*amt, g:g+(255-g)*amt, b:b+(255-b)*amt });
}
function darken(hex, amt) {
  const {r,g,b} = hexToRgb(hex);
  return rgbToHex({ r:r*(1-amt), g:g*(1-amt), b:b*(1-amt) });
}

function computeMix(ingredients) {
  if (!ingredients.length) return null;
  if (ingredients.length === 1) return ingredients[0];
  const key3 = mixKey(ingredients);
  if (exactMixMap[key3]) return exactMixMap[key3];
  if (ingredients.length === 2 && pairMixMap[mixKey(ingredients)]) return pairMixMap[mixKey(ingredients)];
  let current = ingredients[0];
  for (let i = 1; i < ingredients.length; i++) {
    const key = mixKey([current, ingredients[i]]);
    if (pairMixMap[key]) { current = pairMixMap[key]; continue; }
    const a = hexToRgb(PAINTS[current]?.hex || "#888");
    const b = hexToRgb(PAINTS[ingredients[i]]?.hex || "#888");
    const avg = { r:(a.r+b.r)/2, g:(a.g+b.g)/2, b:(a.b+b.b)/2 };
    let closest = current, minDist = Infinity;
    for (const [id, p] of Object.entries(PAINTS)) {
      const c = hexToRgb(p.hex);
      const dist = (c.r-avg.r)**2+(c.g-avg.g)**2+(c.b-avg.b)**2;
      if (dist < minDist) { minDist = dist; closest = id; }
    }
    current = closest;
  }
  return current;
}

function initWells() {
  return Array.from({length: WELL_COUNT}, () => ({ colorId: null, ingredients: [], amount: 0 }));
}

function loadDiscoveredColors() {
  const seeded = new Set(TUBE_COLORS);
  try {
    const raw = localStorage.getItem(ZUKAN_STORAGE_KEY);
    if (!raw) return seeded;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const colorId of parsed) {
        if (PAINTS[colorId]) seeded.add(colorId);
      }
    }
  } catch (e) {}
  return seeded;
}

function saveDiscoveredColors(discoveredSet) {
  try {
    localStorage.setItem(ZUKAN_STORAGE_KEY, JSON.stringify([...discoveredSet]));
  } catch (e) {}
}

// バイブレーション（対応端末のみ）
function buzz(ms = 12) {
  try { navigator.vibrate?.(ms); } catch(e) {}
}

// ===== 水彩紙テクスチャ（SVG turbulence） =====
const PAPER_TEXTURE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`;

// ===== 水彩描画エンジン =====
// wetness: 筆に残っている絵の具量 0〜1。使うほど薄れる

// ===== スタンプ方式ブラシエンジン =====
// 筆先スプライト：中心が濃く外縁に向けて溶けるラジアルグラデーション
const SPRITE_PX = 64;
function makeBrushSprite(hex) {
  const { r, g, b } = hexToRgb(hex);
  const c = document.createElement("canvas");
  c.width = SPRITE_PX; c.height = SPRITE_PX;
  const ctx = c.getContext("2d");
  const half = SPRITE_PX / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.42)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.26)`);
  grad.addColorStop(0.85, `rgba(${r},${g},${b},0.08)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  // 顔料ムラ：スプライト内に不均一な濃淡を焼き込む
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * half * 0.6;
    const px = half + Math.cos(a) * d;
    const py = half + Math.sin(a) * d;
    ctx.beginPath();
    ctx.arc(px, py, 2 + Math.random() * 5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r},${g},${b},${0.05 + Math.random() * 0.08})`;
    ctx.fill();
  }
  return c;
}

// ストローク状態の初期化（一筆ごと）
function initStrokeState(size) {
  return {
    width: size * 0.45,   // 穂先は細く入る（taper-in）
    lastTime: performance.now(),
    // 穂先の毛：中心からの横ズレ・濃さ・太さを一筆ごとにランダム生成
    bristles: Array.from({ length: 4 }, () => ({
      off: (Math.random() - 0.5) * 0.8,
      alpha: 0.25 + Math.random() * 0.5,
      scale: 0.2 + Math.random() * 0.25,
      dryBias: Math.random(),
    })),
  };
}

function stampAt(ctx, sprite, x, y, w, alpha) {
  if (w < 0.8) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - w / 2, y - w / 2, w, w);
  ctx.globalAlpha = 1;
}

// スタンプ連打でセグメントを描く
function strokeSegment(ctx, sprite, from, to, state, size, wetness) {
  const wet = Math.max(0.22, wetness);
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;

  // 速度→目標幅：ゆっくり＝太い（筆を寝かせる）、速い＝細い（穂先が走る）
  const now = performance.now();
  const dt = Math.max(1, now - state.lastTime);
  state.lastTime = now;
  const speed = len / dt; // px/ms
  const speedFactor = Math.max(0.5, Math.min(1.25, 1.25 - speed * 0.38));
  const targetW = size * speedFactor;

  // 進行方向の法線（毛のオフセット用）
  const nx = -dy / len, ny = dx / len;

  const baseAlpha = 0.105 + 0.125 * wet; // 濡れた絵の具の濃さ
  const dryness = Math.max(0, 0.6 - wetness); // かすれ度

  let travelled = 0;
  while (travelled <= len) {
    const t = travelled / len;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;

    // 幅をなめらかに追従（急変しない＝筆のしなり）
    state.width += (targetW - state.width) * 0.12;
    const w = state.width;

    // かすれ：乾いた筆はスタンプが抜けて紙目が見える
    if (Math.random() > dryness * 1.5) {
      const jx = (Math.random() - 0.5) * w * 0.1;
      const jy = (Math.random() - 0.5) * w * 0.1;
      stampAt(ctx, sprite, cx + jx, cy + jy, w, baseAlpha);
    }

    // 穂先の毛：本体に沿って走る細いスジ
    for (const br of state.bristles) {
      if (Math.random() > 0.62 - dryness * br.dryBias * 0.4) continue;
      const bx = cx + nx * br.off * w * 0.5;
      const by = cy + ny * br.off * w * 0.5;
      stampAt(ctx, sprite, bx, by, w * br.scale, baseAlpha * br.alpha);
    }

    travelled += Math.max(1.5, w * 0.24);
  }
  return len;
}

// タップ（点置き）：穂先をポンと置いた表現
function strokeDot(ctx, sprite, x, y, size, wetness) {
  const wet = Math.max(0.22, wetness);
  const baseAlpha = 0.12 + 0.12 * wet;
  // 中心にぎゅっと重ね、外周に散らす
  for (let i = 0; i < 6; i++) {
    const d = Math.random() * size * 0.18;
    const a = Math.random() * Math.PI * 2;
    stampAt(ctx, sprite, x + Math.cos(a) * d, y + Math.sin(a) * d, size * (0.85 + Math.random() * 0.3), baseAlpha);
  }
  for (let i = 0; i < 4; i++) {
    const d = size * (0.2 + Math.random() * 0.3);
    const a = Math.random() * Math.PI * 2;
    stampAt(ctx, sprite, x + Math.cos(a) * d, y + Math.sin(a) * d, size * (0.25 + Math.random() * 0.2), baseAlpha * 0.6);
  }
}

// ===== 滲みブロブエンジン =====
// 不定形の輪郭を持つ「にじみ」の形状を事前生成
function makeBlobShape(pointCount = 9) {
  const shape = [];
  for (let i = 0; i < pointCount; i++) {
    shape.push({
      angle: (i / pointCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35,
      radiusScale: 0.7 + Math.random() * 0.6,
      wobbleAmp: 0.05 + Math.random() * 0.08,
      wobbleSpeed: 2 + Math.random() * 4,
      wobblePhase: Math.random() * Math.PI * 2,
    });
  }
  return shape;
}

// なめらかな閉曲線でブロブを描く（中点quadratic法）
function drawBlob(ctx, x, y, radius, shape, hex, alpha, time) {
  const { r, g, b } = hexToRgb(hex);
  const pts = shape.map(p => {
    const wobble = 1 + Math.sin(time * p.wobbleSpeed + p.wobblePhase) * p.wobbleAmp;
    const rr = radius * p.radiusScale * wobble;
    return { x: x + Math.cos(p.angle) * rr, y: y + Math.sin(p.angle) * rr };
  });
  ctx.beginPath();
  const n = pts.length;
  let mid = { x: (pts[0].x + pts[n-1].x) / 2, y: (pts[0].y + pts[n-1].y) / 2 };
  ctx.moveTo(mid.x, mid.y);
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    const m = { x: (pts[i].x + next.x) / 2, y: (pts[i].y + next.y) / 2 };
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  ctx.fill();
}

// ===== 点滅アニメ =====
function useBlinkAnimation(active) {
  const [bright, setBright] = useState(false);
  const raf = useRef(null);
  useEffect(() => {
    if (!active) { setBright(false); return; }
    let start = null;
    const tick = (ts) => {
      if (!start) start = ts;
      setBright(Math.floor((ts - start) / 300) % 2 === 0);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [active]);
  return bright;
}

// ===== PaintTube =====
function PaintTube({ colorId, onPress, selected }) {
  const paint = PAINTS[colorId];
  const isLight = colorId === "white" || colorId === "yellow" || colorId === "cream";
  return (
    <button
      onClick={() => { buzz(); onPress(colorId); }}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        background: selected ? "rgba(255,255,255,0.25)" : "none",
        border: selected ? "2px solid #ffe082" : "2px solid transparent",
        borderRadius: 10,
        padding: "3px 1px",
        cursor: "pointer", userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        flex: "1 1 0", minWidth: 0, maxWidth: 56, minHeight: 64,
        transform: selected ? "translateY(-5px) scale(1.08)" : "none",
        transition: "transform 0.15s, background 0.15s, border 0.15s",
        boxShadow: selected ? "0 4px 12px rgba(0,0,0,0.3)" : "none",
      }}
    >
      <div style={{ position: "relative", width: 26, height: 48 }}>
        <div style={{
          position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: 21, height: 39,
          background: `linear-gradient(135deg, ${lighten(paint.hex,0.3)} 0%, ${paint.hex} 50%, ${darken(paint.hex,0.2)} 100%)`,
          border: `2px solid ${paint.border}`,
          borderRadius: "3px 3px 8px 8px",
          boxShadow: "2px 2px 4px rgba(0,0,0,0.25)",
        }} />
        <div style={{
          position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
          width: 11, height: 13,
          background: isLight ? "#aaa" : darken(paint.hex, 0.3),
          border: `2px solid ${paint.border}`,
          borderRadius: "3px 3px 0 0",
        }} />
        <div style={{
          position: "absolute", bottom: 5, left: "50%", transform: "translateX(-50%) translateX(-3px)",
          width: 4, height: 15,
          background: "rgba(255,255,255,0.35)",
          borderRadius: 3,
        }} />
      </div>
      <span style={{
        fontSize: 9, marginTop: 2, fontWeight: "bold",
        color: "#4a3728", whiteSpace: "nowrap",
        fontFamily: "'Hiragino Maru Gothic ProN', 'BIZ UDGothic', sans-serif",
      }}>{paint.label}</span>
    </button>
  );
}

// ===== PaletteWell =====
function PaletteWell({ well, index, selected, onSelect, blinkActive, pendingColor, justFilled, mixing }) {
  const bright = useBlinkAnimation(blinkActive);
  const color = well.colorId ? PAINTS[well.colorId]?.hex : "#e8ddd0";
  const glowHex = pendingColor
    ? PAINTS[pendingColor]?.hex
    : well.colorId ? PAINTS[well.colorId]?.hex : "#ffe082";
  const amount = Math.max(0, Math.min(1, well.amount ?? 0));
  const blobSize = `${(0.45 + 0.55 * amount) * 100}%`;
  const blobColor = amount === 0 ? lighten(color, 0.62) : color;

  return (
    <button
      onClick={() => onSelect(index)}
      style={{
        width: 42, height: 42,
        borderRadius: "50%",
        background: well.colorId ? lighten(color, 0.82) : color,
        border: blinkActive
          ? bright ? `3px solid #fff` : `3px solid ${glowHex}`
          : selected ? "3px solid #f4a261" : "2px solid #b8977e",
        boxShadow: blinkActive
          ? bright
            ? `0 0 0 4px ${glowHex}, 0 0 20px 8px ${glowHex}99, inset 0 3px 8px rgba(0,0,0,0.2)`
            : `0 0 8px 2px ${glowHex}55, inset 0 3px 8px rgba(0,0,0,0.2)`
          : selected
            ? `0 0 0 3px #f4a261, inset 0 3px 8px rgba(0,0,0,0.25)`
            : "inset 0 3px 8px rgba(0,0,0,0.25)",
        cursor: "pointer",
        outline: "none",
        WebkitTapHighlightColor: "transparent",
        transition: bright ? "box-shadow 0.05s, border 0.05s" : "box-shadow 0.2s, border 0.2s",
        position: "relative",
        flexShrink: 0,
        animation: justFilled ? "wellPop 0.35s ease" : "none",
        overflow: "hidden",
      }}
    >
      {well.colorId && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: blobSize,
          height: blobSize,
          transform: "translate(-50%, -50%)",
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, ${lighten(blobColor, 0.25)}, ${blobColor} 62%, ${darken(blobColor, 0.12)})`,
          opacity: amount === 0 ? 0.72 : 1,
          boxShadow: "inset 0 2px 5px rgba(255,255,255,0.3)",
          transition: "width 0.18s, height 0.18s, opacity 0.18s",
        }} />
      )}
      {mixing && (
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          overflow: "hidden", pointerEvents: "none", zIndex: 2,
        }}>
          {/* もとの色が下地 */}
          <div style={{ position: "absolute", inset: 0, background: mixing.fromHex }} />
          {/* 足した色がぐるぐる混ざっていく渦 */}
          <div style={{
            position: "absolute", inset: "-30%",
            background: `conic-gradient(${mixing.fromHex}, ${mixing.addedHex} 22%, ${mixing.fromHex} 46%, ${mixing.addedHex} 72%, ${mixing.fromHex})`,
            filter: "blur(1.5px)",
            animation: "mixSwirl 0.75s ease-out forwards",
          }} />
          {/* 混ざり終わった色がふわっと現れる */}
          <div style={{
            position: "absolute", inset: 0,
            background: `radial-gradient(circle at 35% 30%, ${lighten(mixing.toHex, 0.25)}, ${mixing.toHex} 62%, ${darken(mixing.toHex, 0.12)})`,
            opacity: 0,
            animation: "mixReveal 0.32s ease 0.5s forwards",
          }} />
        </div>
      )}
      {selected && !blinkActive && (
        <div style={{
          position: "absolute", bottom: -15, left: "50%", transform: "translateX(-50%)",
          fontSize: 10, color: "#f4a261", pointerEvents: "none",
        }}>▲</div>
      )}
    </button>
  );
}

// ===== Brush（筆表示＋太さ切替） =====
const BRUSH_SIZES = { thin: 10, normal: 18, thick: 30 };

function BrushPanel({ brushHex, wetness, brushSize, onSizeChange }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
      padding: "2px 4px",
    }}>
      {/* 筆先プレビュー：色と残量 */}
      <div style={{
        width: 34, height: 34, borderRadius: "50%",
        background: brushHex
          ? `radial-gradient(circle at 35% 30%, ${lighten(brushHex, 0.3)}, ${brushHex})`
          : "#e0e0e0",
        border: "2px solid #aaa",
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.15)",
        position: "relative", overflow: "hidden",
      }}>
        {/* 残量：下から減っていく表現 */}
        {brushHex && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0,
            height: `${(1 - Math.max(0.25, wetness)) * 100}%`,
            background: "rgba(255,255,255,0.55)",
            transition: "height 0.2s",
          }} />
        )}
      </div>
      {/* 太さ切替 */}
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {Object.entries(BRUSH_SIZES).map(([key, px]) => (
          <button
            key={key}
            onClick={() => { buzz(); onSizeChange(key); }}
            style={{
              width: 20, height: 20, borderRadius: "50%",
              background: brushSize === key ? "#f4a261" : "rgba(255,255,255,0.3)",
              border: brushSize === key ? "2px solid #fff" : "2px solid rgba(255,255,255,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", padding: 0,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <div style={{
              width: 4 + (px/30)*10, height: 4 + (px/30)*10,
              borderRadius: "50%",
              background: brushSize === key ? "#fff" : "rgba(255,255,255,0.7)",
            }} />
          </button>
        ))}
      </div>
      <span style={{ fontSize: 8, color: "#f0e6d3", fontFamily: "sans-serif" }}>ふで</span>
    </div>
  );
}

// ===== WaterCup =====
function WaterCup({ dirtiness, onWash }) {
  const waterColor = dirtiness === 0
    ? "#b3e5fc" : dirtiness < 3 ? "#89c8d8" : dirtiness < 6 ? "#6b9ea8" : "#4a7a85";
  return (
    <button onClick={() => { buzz(); onWash(); }} style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      background: "none", border: "none", cursor: "pointer", padding: 2,
      WebkitTapHighlightColor: "transparent",
    }}>
      <div style={{
        width: 34, height: 32, background: "rgba(255,255,255,0.85)",
        borderRadius: "3px 3px 8px 8px", border: "2px solid #bdbdbd",
        overflow: "hidden", position: "relative",
        boxShadow: "1px 2px 4px rgba(0,0,0,0.2)",
      }}>
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, height: "65%",
          background: waterColor, transition: "background 0.5s",
        }} />
        {/* 水面のゆらぎ */}
        <div style={{
          position: "absolute", top: "32%", left: 0, right: 0, height: 2,
          background: "rgba(255,255,255,0.5)",
        }} />
      </div>
      <span style={{ fontSize: 8, color: "#f0e6d3", marginTop: 2, fontFamily: "sans-serif" }}>みずいれ</span>
    </button>
  );
}

// ===== Cloth =====
function Cloth({ onWipe }) {
  return (
    <button onClick={() => { buzz(); onWipe(); }} style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      background: "none", border: "none", cursor: "pointer", padding: 2,
      WebkitTapHighlightColor: "transparent",
    }}>
      <div style={{
        width: 36, height: 28,
        background: "repeating-linear-gradient(45deg,#efebe9,#efebe9 4px,#d7ccc8 4px,#d7ccc8 8px)",
        borderRadius: 5, border: "2px solid #bcaaa4",
        boxShadow: "1px 2px 3px rgba(0,0,0,0.15)",
      }} />
      <span style={{ fontSize: 8, color: "#f0e6d3", marginTop: 2, fontFamily: "sans-serif" }}>ぞうきん</span>
    </button>
  );
}

// ===== UndoButton =====
function UndoButton({ onUndo, disabled }) {
  return (
    <button onClick={() => { if(!disabled){ buzz(); onUndo(); } }} style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      background: "none", border: "none",
      cursor: disabled ? "default" : "pointer", padding: 2,
      opacity: disabled ? 0.4 : 1,
      WebkitTapHighlightColor: "transparent",
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9,
        background: "#fff8e1", border: "2px solid #ffb300",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 17,
        boxShadow: "1px 2px 4px rgba(0,0,0,0.2)",
      }}>↩️</div>
      <span style={{ fontSize: 8, color: "#f0e6d3", marginTop: 2, fontFamily: "sans-serif" }}>もどる</span>
    </button>
  );
}

// ===== ClearButton（長押し） =====
function ClearButton({ onClear }) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const animRef = useRef(null);
  const startRef = useRef(null);
  const HOLD_MS = 1200;

  const startHold = () => {
    setHolding(true);
    startRef.current = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - startRef.current) / HOLD_MS);
      setProgress(p);
      if (p < 1) { animRef.current = requestAnimationFrame(tick); }
      else { buzz(30); onClear(); setHolding(false); setProgress(0); }
    };
    animRef.current = requestAnimationFrame(tick);
  };
  const cancelHold = () => {
    cancelAnimationFrame(animRef.current);
    setHolding(false); setProgress(0);
  };

  return (
    <button
      onPointerDown={startHold} onPointerUp={cancelHold} onPointerLeave={cancelHold}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        background: "none", border: "none", cursor: "pointer", padding: 2,
        userSelect: "none", WebkitTapHighlightColor: "transparent",
        touchAction: "none",
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 9,
        background: holding
          ? `conic-gradient(#e53935 ${progress*360}deg, #ffcdd2 ${progress*360}deg)`
          : "#ffcdd2",
        border: "2px solid #e53935",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 17,
        boxShadow: holding ? "0 0 0 3px #f48fb1" : "1px 2px 4px rgba(0,0,0,0.2)",
      }}>🗑️</div>
      <span style={{ fontSize: 8, color: "#ffcdd2", marginTop: 2, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>
        {holding ? "もうちょい" : "ながおし"}
      </span>
    </button>
  );
}

function ToolButton({ icon, label, onClick }) {
  return (
    <button onClick={() => { buzz(); onClick(); }} style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      background: "none", border: "none", cursor: "pointer", padding: 2,
      minWidth: 44, minHeight: 44,
      WebkitTapHighlightColor: "transparent",
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 9,
        background: "#fff3e0", border: "2px solid #f4a261",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
        boxShadow: "1px 2px 4px rgba(0,0,0,0.2)",
      }}>{icon}</div>
      <span style={{ fontSize: 8, color: "#f0e6d3", marginTop: 2, fontFamily: "sans-serif", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

// ===== メインアプリ =====
export default function PaintPlayApp() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [wells, setWells] = useState(initWells);
  const [selectedWell, setSelectedWell] = useState(0);
  const [brushColor, setBrushColor] = useState(null);
  const [brushSize, setBrushSize] = useState("normal");
  const [waterDirt, setWaterDirt] = useState(0);
  const [pendingColor, setPendingColor] = useState(null);
  const [paletteBlinking, setPaletteBlinking] = useState(false);
  const [toast, setToast] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [discoveredColors, setDiscoveredColors] = useState(loadDiscoveredColors);
  const [zukanOpen, setZukanOpen] = useState(false);
  const [savedArtworks, setSavedArtworks] = useState([]);
  const [justFilledIndex, setJustFilledIndex] = useState(null);
  const [canUndo, setCanUndo] = useState(false);

  const toastTimer = useRef(null);
  const celebrationTimer = useRef(null);
  const popTimer = useRef(null);
  const undoStack = useRef([]);
  const isDrawing = useRef(false);
  const lastPos = useRef(null);
  const wetnessRef = useRef(1);
  const strokeStartWetnessRef = useRef(1);
  const [mixingWell, setMixingWell] = useState(null); // {index, fromHex, addedHex, toHex}
  const mixAnimTimer = useRef(null);
  const mixNotifyTimer = useRef(null);
  const [wetnessUI, setWetnessUI] = useState(1);

  // 滲み拡散システム：描いた後にじわっと広がる
  const bleedsRef = useRef([]);       // アクティブな滲み
  const bleedRafRef = useRef(null);   // 拡散ループのrAF
  const bleedDistRef = useRef(0);     // 前回の滲み発生からの移動距離

  const brushHex = brushColor ? PAINTS[brushColor]?.hex : null;
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  // ブラシスプライト（色が変わったら作り直し）とストローク状態
  const spriteRef = useRef(null);
  const strokeStateRef = useRef(null);

  useEffect(() => {
    spriteRef.current = brushHex ? makeBrushSprite(brushHex) : null;
  }, [brushHex]);

  useEffect(() => {
    saveDiscoveredColors(discoveredColors);
  }, [discoveredColors]);

  useEffect(() => () => {
    clearTimeout(toastTimer.current);
    clearTimeout(celebrationTimer.current);
    clearTimeout(popTimer.current);
  }, []);

  // ===== Canvas 初期化・リサイズ（DPR対応） =====
  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    // 既存描画のバックアップ
    let snapshot = null;
    if (canvas.width > 0 && canvas.height > 0) {
      snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext("2d").drawImage(canvas, 0, 0);
    }

    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (snapshot) {
      ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, canvas.width, canvas.height);
    }
    ctx.scale(dpr, dpr);
  }, [dpr]);

  useEffect(() => {
    setupCanvas();
    const ro = new ResizeObserver(() => setupCanvas());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [setupCanvas]);

  // ===== Undo =====
  const pushUndo = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const snap = document.createElement("canvas");
      snap.width = canvas.width;
      snap.height = canvas.height;
      snap.getContext("2d").drawImage(canvas, 0, 0);
      undoStack.current.push(snap);
      if (undoStack.current.length > 10) undoStack.current.shift();
      setCanUndo(true);
    } catch(e) {}
  };

  const handleUndo = () => {
    cancelBleeds();
    const snap = undoStack.current.pop();
    if (!snap) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(snap, 0, 0);
    ctx.scale(dpr, dpr);
    setCanUndo(undoStack.current.length > 0);
  };

  // ===== 滲み拡散 =====
  const runBleedLoop = useCallback(() => {
    if (bleedRafRef.current) return; // すでに稼働中
    const loop = () => {
      const canvas = canvasRef.current;
      if (!canvas) { bleedRafRef.current = null; return; }
      const ctx = canvas.getContext("2d");
      const now = performance.now();
      const alive = [];
      for (const bl of bleedsRef.current) {
        const t = (now - bl.start) / bl.dur;
        if (t >= 1) continue;
        // ease-out：最初は速く、あとはゆっくり広がる（水が繊維を伝う感じ）
        const eased = 1 - Math.pow(1 - t, 3.0);
        const radius = bl.r0 + (bl.r1 - bl.r0) * eased;
        // 広がるほど薄く。毎フレーム微量ずつ塗り重ねて「染み込み」を作る
        const alpha = bl.baseAlpha * (1 - t);
        drawBlob(ctx, bl.x, bl.y, radius, bl.shape, bl.hex, alpha, now / 1000);
        alive.push(bl);
      }
      bleedsRef.current = alive;
      if (alive.length > 0) {
        bleedRafRef.current = requestAnimationFrame(loop);
      } else {
        bleedRafRef.current = null;
      }
    };
    bleedRafRef.current = requestAnimationFrame(loop);
  }, []);

  const spawnBleed = useCallback((x, y, hex, size, strength = 1) => {
    if (bleedsRef.current.length > 24) return; // モバイル負荷対策
    const s = Math.min(strength, 1.35); // 暴走防止の上限
    const bl = {
      x: x + (Math.random() - 0.5) * size * 0.4,
      y: y + (Math.random() - 0.5) * size * 0.4,
      hex,
      shape: makeBlobShape(),
      r0: size * 0.55,
      r1: size * (0.7 + Math.random() * 0.5) * s,
      start: performance.now(),
      dur: 380 + Math.random() * 340,
      baseAlpha: 0.010 + Math.random() * 0.006,
    };
    bleedsRef.current.push(bl);
    // 触れた瞬間から滲みが見えるよう、濡れハローを一度だけ即時に置く
    // （累積アルファ方式は視認できるまで時間がかかるため）
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      drawBlob(ctx, bl.x, bl.y, bl.r0 * 0.9, bl.shape, hex, 0.03 * Math.min(1, s), performance.now() / 1000);
    }
    runBleedLoop();
  }, [runBleedLoop]);

  const cancelBleeds = useCallback(() => {
    bleedsRef.current = [];
    if (bleedRafRef.current) {
      cancelAnimationFrame(bleedRafRef.current);
      bleedRafRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelBleeds(), [cancelBleeds]);

  // ===== 座標取得（CSSピクセル座標） =====
  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ===== 描画ハンドラ =====
  const handlePointerDown = (e) => {
    if (!brushHex || !spriteRef.current) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    pushUndo();
    isDrawing.current = true;
    strokeStartWetnessRef.current = wetnessRef.current;
    const pos = getPos(e);
    lastPos.current = pos;
    bleedDistRef.current = 0;
    const size = BRUSH_SIZES[brushSize];
    // 一筆ごとに穂先の毛を再生成（スジのパターンが毎回変わる）
    strokeStateRef.current = initStrokeState(size);
    const ctx = canvasRef.current.getContext("2d");
    strokeDot(ctx, spriteRef.current, pos.x, pos.y, size, wetnessRef.current);
    // 置いた瞬間にじわっ：芯の滲み＋外周のふわっとした水の輪の二段
    spawnBleed(pos.x, pos.y, brushHex, size, 1.2 * wetnessRef.current + 0.4);
    spawnBleed(pos.x, pos.y, brushHex, size * 1.5, 0.7 * wetnessRef.current + 0.3);
  };

  const handlePointerMove = (e) => {
    if (!isDrawing.current || !brushHex || !spriteRef.current || !strokeStateRef.current) return;
    e.preventDefault();
    const pos = getPos(e);
    if (lastPos.current) {
      const ctx = canvasRef.current.getContext("2d");
      const size = BRUSH_SIZES[brushSize];
      const state = strokeStateRef.current;
      // 中間点補間でなめらかに
      const mid = {
        x: (lastPos.current.x + pos.x) / 2,
        y: (lastPos.current.y + pos.y) / 2,
      };
      const len1 = strokeSegment(ctx, spriteRef.current, lastPos.current, mid, state, size, wetnessRef.current);
      const len2 = strokeSegment(ctx, spriteRef.current, mid, pos, state, size, wetnessRef.current);
      const moved = len1 + len2;
      // 最後の進行方向を記録（筆離れの払い用）
      if (moved > 0.5) {
        state.lastDir = { x: (pos.x - lastPos.current.x) / moved, y: (pos.y - lastPos.current.y) / moved };
      }
      // 絵の具消費：描いた距離に応じて薄くなる
      wetnessRef.current = Math.max(0, wetnessRef.current - moved / 2200);
      setWetnessUI(wetnessRef.current);
      // 一定距離ごとにストローク沿いへ滲みを発生
      bleedDistRef.current += moved;
      const interval = size * 1.25;
      while (bleedDistRef.current > interval) {
        bleedDistRef.current -= interval;
        if (Math.random() < 0.9) {
          spawnBleed(pos.x, pos.y, brushHex, size, 0.7 + wetnessRef.current * 0.9);
        }
      }
    }
    lastPos.current = pos;
  };

  const handlePointerUp = (e) => {
    if (isDrawing.current && brushHex && lastPos.current) {
      const size = BRUSH_SIZES[brushSize];
      const state = strokeStateRef.current;
      const ctx = canvasRef.current.getContext("2d");
      // 筆離れの払い（テーパーアウト）：最後の方向へスッと細く抜ける
      if (state?.lastDir && spriteRef.current) {
        let cur = { ...lastPos.current };
        let w = state.width;
        const steps = 5;
        const tailLen = size * (0.7 + Math.random() * 0.6);
        for (let i = 0; i < steps; i++) {
          cur = {
            x: cur.x + state.lastDir.x * (tailLen / steps) + (Math.random() - 0.5) * 1.2,
            y: cur.y + state.lastDir.y * (tailLen / steps) + (Math.random() - 0.5) * 1.2,
          };
          w *= 0.58;
          if (w < 1) break;
          stampAt(ctx, spriteRef.current, cur.x, cur.y, w, (0.1 + 0.08 * wetnessRef.current) * (1 - i / steps));
        }
      }
      // 筆を離した場所は水が溜まって強く滲む（水彩のバックラン）
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        spawnBleed(lastPos.current.x, lastPos.current.y, brushHex, size, 1.2 + wetnessRef.current * 0.9);
      }
      const usedPaint = Math.max(0, strokeStartWetnessRef.current - wetnessRef.current);
      if (usedPaint > 0) {
        setWells(prev => prev.map((well, i) => (
          i === selectedWell
            ? { ...well, amount: Math.max(0, (well.amount ?? 0) - usedPaint * 0.35) }
            : well
        )));
      }
    }
    isDrawing.current = false;
    lastPos.current = null;
    strokeStateRef.current = null;
    try { canvasRef.current?.releasePointerCapture?.(e.pointerId); } catch(err) {}
  };

  // ===== トースト表示 =====
  const showToast = (text, hex) => {
    setCelebration(null);
    setToast({ text, hex });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  };

  const showCelebration = (colorId) => {
    setToast(null);
    clearTimeout(celebrationTimer.current);
    setCelebration({ colorId });
    celebrationTimer.current = setTimeout(() => setCelebration(null), 2200);
  };

  // ===== チューブ =====
  const handleTube = (colorId) => {
    setPendingColor(colorId);
    setPaletteBlinking(true);
  };

  // ===== パレット穴 =====
  const handleWellSelect = (index) => {
    buzz();
    setSelectedWell(index);

    if (pendingColor) {
      const before = wells[index].colorId;
      const newIng = [...wells[index].ingredients, pendingColor];
      const after = computeMix(newIng);
      const isNewDiscovery = Boolean(after && !discoveredColors.has(after));

      setWells(prev => prev.map((w, i) => {
        if (i !== index) return w;
        return { colorId: after, ingredients: newIng, amount: 1 };
      }));
      setBrushColor(after);
      // 図鑑への登録は即時（連打しても二重登録しない）
      if (after && isNewDiscovery) {
        const nextDiscovered = new Set(discoveredColors);
        nextDiscovered.add(after);
        setDiscoveredColors(nextDiscovered);
        saveDiscoveredColors(nextDiscovered);
      }
      // 色が変わる混色なら、穴の上で「ぐるぐる混ざる」アニメを先に見せる
      const mixed = Boolean(before && after && before !== after);
      if (mixed) {
        setMixingWell({
          index,
          fromHex: PAINTS[before].hex,
          addedHex: PAINTS[pendingColor].hex,
          toHex: PAINTS[after].hex,
        });
        clearTimeout(mixAnimTimer.current);
        mixAnimTimer.current = setTimeout(() => setMixingWell(null), 900);
      }
      // お知らせは混ざり終わってから（混ぜている過程→結果、の順に見せる）
      const notifyDelay = mixed ? 700 : 0;
      clearTimeout(mixNotifyTimer.current);
      if (after && isNewDiscovery) {
        mixNotifyTimer.current = setTimeout(() => {
          buzz(60);
          showCelebration(after);
        }, notifyDelay);
      } else if (mixed) {
        mixNotifyTimer.current = setTimeout(() => {
          showToast(`${PAINTS[after].label} できた！`, PAINTS[after].hex);
          buzz(25);
        }, notifyDelay);
      }
      setPendingColor(null);
      setPaletteBlinking(false);
      // 筆に新しい絵の具→たっぷり
      wetnessRef.current = 1;
      setWetnessUI(1);
      // 穴のポップアニメ
      setJustFilledIndex(index);
      clearTimeout(popTimer.current);
      popTimer.current = setTimeout(() => setJustFilledIndex(null), 400);
    } else {
      const well = wells[index];
      if (well.colorId) {
        setBrushColor(well.colorId);
        const nextWetness = well.amount > 0 ? Math.min(1, well.amount * 1.5 + 0.2) : 0;
        wetnessRef.current = nextWetness;
        setWetnessUI(nextWetness);
      }
    }
  };

  // ===== 水洗い =====
  const handleWash = () => {
    setBrushColor(null);
    setWaterDirt(d => Math.min(8, d+1));
    wetnessRef.current = 1;
    setWetnessUI(1);
  };

  // ===== 雑巾 =====
  const handleWipe = () => {
    setWells(prev => prev.map((w,i) => i===selectedWell ? {colorId:null,ingredients:[],amount:0} : w));
    setBrushColor(null);
  };

  // ===== 全消し =====
  const handleClear = () => {
    cancelBleeds();
    pushUndo();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
  };

  const handleSaveArtwork = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      const now = new Date();
      const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      ].join("-") + "-" + [
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
      ].join("");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `さくひん-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setSavedArtworks(prev => [dataUrl, ...prev.filter(item => item !== dataUrl)].slice(0, 12));
      showToast("のこしたよ！", "#f4a261");
    } catch (e) {}
  };

  const discoveredCount = Object.keys(PAINTS).filter(colorId => discoveredColors.has(colorId)).length;
  const allDiscovered = discoveredCount === Object.keys(PAINTS).length;
  const celebrationPaint = celebration ? PAINTS[celebration.colorId] : null;
  const confettiColors = ["#f4a261", "#f6bd60", "#84a59d", "#f28482", "#90caf9", "#cdb4db", "#bde0a3", "#ffd6a5"];

  return (
    <div style={{
      width: "100%", height: "100dvh",
      display: "flex", flexDirection: "column",
      background: "#f5e6d0",
      fontFamily: "'Hiragino Maru Gothic ProN','BIZ UDGothic',sans-serif",
      overflow: "hidden", userSelect: "none",
    }}>
      <style>{`
        @keyframes mixSwirl {
          0% { transform: rotate(0deg) scale(0.55); opacity: 0.95; }
          100% { transform: rotate(660deg) scale(1.25); opacity: 0.9; }
        }
        @keyframes mixReveal {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes wellPop {
          0% { transform: scale(1); }
          40% { transform: scale(1.25); }
          100% { transform: scale(1); }
        }
        @keyframes toastIn {
          0% { transform: translate(-50%, 12px); opacity: 0; }
          15% { transform: translate(-50%, 0); opacity: 1; }
          85% { transform: translate(-50%, 0); opacity: 1; }
          100% { transform: translate(-50%, -6px); opacity: 0; }
        }
        @keyframes confettiPop {
          0% { transform: translateY(0) scale(0.7); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateY(-34px) scale(1.15); opacity: 0; }
        }
      `}</style>

      {/* スケッチブック */}
      <div style={{
        flex: 1, margin: "8px 8px 4px 8px",
        borderRadius: 12, background: PAPER_COLOR,
        border: "4px solid #c9aa88",
        boxShadow: "0 4px 12px rgba(0,0,0,0.18), inset 0 0 30px rgba(0,0,0,0.03)",
        overflow: "hidden", position: "relative", touchAction: "none",
        minHeight: 0,
      }}>
        {/* リング穴 */}
        {[...Array(6)].map((_,i) => (
          <div key={i} style={{
            position: "absolute", top: 6, left: `${10+i*16}%`,
            width: 10, height: 10, borderRadius: "50%",
            background: "#c9aa88", border: "2px solid #a07850", zIndex: 3,
            pointerEvents: "none",
          }} />
        ))}
        <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
          <canvas
            ref={canvasRef}
            style={{ display: "block", touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        </div>
        {/* 水彩紙テクスチャ */}
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: PAPER_TEXTURE,
          opacity: 0.045,
          mixBlendMode: "multiply",
          pointerEvents: "none",
          zIndex: 2,
        }} />
        {/* ガイドメッセージ */}
        {!brushColor && (
          <div style={{
            position: "absolute", inset: 0, display: "flex",
            alignItems: "center", justifyContent: "center", pointerEvents: "none",
            zIndex: 2,
          }}>
            <span style={{
              fontSize: 17, color: "#c9aa88", fontWeight: "bold",
              textAlign: "center", opacity: 0.7, lineHeight: 1.7,
            }}>
              {pendingColor
                ? "✨ ひかってる おさらを タップ！"
                : "🎨 えのぐを えらんでね"}
            </span>
          </div>
        )}
        {/* 混色トースト */}
        {toast && (
          <div style={{
            position: "absolute", bottom: 14, left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(255,255,255,0.95)",
            border: `3px solid ${toast.hex}`,
            borderRadius: 999,
            padding: "8px 18px",
            display: "flex", alignItems: "center", gap: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
            animation: "toastIn 1.8s ease forwards",
            zIndex: 4,
            whiteSpace: "nowrap",
          }}>
            <div style={{
              width: 18, height: 18, borderRadius: "50%",
              background: toast.hex, border: "2px solid rgba(0,0,0,0.15)",
            }} />
            <span style={{ fontSize: 15, fontWeight: "bold", color: "#4a3728" }}>{toast.text}</span>
          </div>
        )}
        {celebrationPaint && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(255,248,238,0.35)",
            zIndex: 5,
            pointerEvents: "none",
          }}>
            <div style={{
              position: "relative",
              minWidth: 250,
              maxWidth: "82%",
              background: "rgba(255,255,255,0.96)",
              border: `4px solid ${celebrationPaint.hex}`,
              borderRadius: 26,
              padding: "24px 24px 20px",
              boxShadow: "0 10px 28px rgba(0,0,0,0.24)",
              textAlign: "center",
            }}>
              {confettiColors.slice(0, 8).map((confettiColor, i) => (
                <div key={i} style={{
                  position: "absolute",
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: confettiColor,
                  left: `${10 + (i % 4) * 24}%`,
                  top: i < 4 ? 14 : 58,
                  animation: `confettiPop ${1.1 + i * 0.08}s ease-out forwards`,
                  animationDelay: `${i * 0.05}s`,
                }} />
              ))}
              <div style={{
                width: 78, height: 78, borderRadius: "50%",
                margin: "0 auto 14px",
                background: `radial-gradient(circle at 35% 30%, ${lighten(celebrationPaint.hex, 0.25)}, ${celebrationPaint.hex} 62%, ${darken(celebrationPaint.hex, 0.12)})`,
                border: "4px solid rgba(0,0,0,0.12)",
              }} />
              <div style={{ fontSize: 28, fontWeight: "bold", color: "#8b6347", marginBottom: 8 }}>あたらしいいろ！</div>
              <div style={{ fontSize: 20, fontWeight: "bold", color: "#4a3728", lineHeight: 1.5 }}>
                {celebrationPaint.label} が できた！
              </div>
            </div>
          </div>
        )}
        {zukanOpen && (
          <div
            onClick={() => setZukanOpen(false)}
            style={{
              position: "absolute", inset: 0,
              background: "rgba(70,46,27,0.45)",
              zIndex: 6,
              padding: 12,
              display: "flex",
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: "#fff8ef",
                borderRadius: 24,
                border: "4px solid #f4a261",
                boxShadow: "0 14px 32px rgba(0,0,0,0.28)",
                width: "100%",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                position: "relative",
              }}
            >
              <button
                onClick={() => setZukanOpen(false)}
                style={{
                  position: "absolute", top: 10, right: 10,
                  width: 44, height: 44, borderRadius: "50%",
                  border: "2px solid #f4a261", background: "#fff",
                  color: "#8b6347", fontSize: 26, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  WebkitTapHighlightColor: "transparent",
                  zIndex: 1,
                }}
              >×</button>
              <div style={{
                padding: "18px 18px 12px",
                borderBottom: "2px solid #f1d3b2",
                background: "linear-gradient(180deg, #fffaf2 0%, #fff3e3 100%)",
              }}>
                <div style={{ fontSize: 28, fontWeight: "bold", color: "#8b6347" }}>いろずかん</div>
                <div style={{ fontSize: 18, fontWeight: "bold", color: "#a06a3b", marginTop: 4 }}>
                  {discoveredCount} / {Object.keys(PAINTS).length}
                </div>
                {allDiscovered && (
                  <div style={{
                    marginTop: 10,
                    background: "#fff0c2",
                    border: "2px solid #f6bd60",
                    borderRadius: 999,
                    padding: "8px 14px",
                    display: "inline-block",
                    fontSize: 18,
                    fontWeight: "bold",
                    color: "#8b6347",
                  }}>ぜんぶ あつめたね！すごい！</div>
                )}
              </div>
              <div style={{ padding: 16, overflowY: "auto", minHeight: 0 }}>
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
                  gap: 12,
                }}>
                  {Object.entries(PAINTS).map(([colorId, paint]) => {
                    const discovered = discoveredColors.has(colorId);
                    return (
                      <div key={colorId} style={{
                        background: discovered ? "#fff" : "#f3ece3",
                        border: `2px solid ${discovered ? paint.border : "#d6c5b5"}`,
                        borderRadius: 18,
                        padding: "12px 8px",
                        textAlign: "center",
                      }}>
                        <div style={{
                          width: 46, height: 46, borderRadius: "50%",
                          margin: "0 auto 8px",
                          background: discovered
                            ? `radial-gradient(circle at 35% 30%, ${lighten(paint.hex, 0.25)}, ${paint.hex} 62%, ${darken(paint.hex, 0.12)})`
                            : "#d4d4d4",
                          border: "3px solid rgba(0,0,0,0.12)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: "#7a6a59", fontSize: 22, fontWeight: "bold",
                        }}>
                          {discovered ? "" : "？"}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: "bold", color: "#4a3728", minHeight: 20 }}>
                          {discovered ? paint.label : "？？？"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 22 }}>
                  <div style={{ fontSize: 24, fontWeight: "bold", color: "#8b6347", marginBottom: 10 }}>
                    きょうのさくひん
                  </div>
                  {savedArtworks.length > 0 ? (
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
                      gap: 10,
                    }}>
                      {savedArtworks.map((src, index) => (
                        <div key={`${src.slice(0, 24)}-${index}`} style={{
                          background: "#fff",
                          borderRadius: 14,
                          padding: 6,
                          border: "2px solid #e7ccb0",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
                        }}>
                          <img
                            src={src}
                            alt={`さくひん ${index + 1}`}
                            style={{
                              width: "100%",
                              aspectRatio: "1 / 1",
                              objectFit: "cover",
                              borderRadius: 10,
                              display: "block",
                              background: PAPER_COLOR,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{
                      background: "#fff",
                      border: "2px dashed #e7ccb0",
                      borderRadius: 18,
                      padding: "18px 14px",
                      color: "#9a7a5f",
                      fontSize: 16,
                      fontWeight: "bold",
                      textAlign: "center",
                    }}>
                      まだ ないよ
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 道具箱 */}
      <div style={{
        background: "linear-gradient(180deg, #8b6347 0%, #6d4c37 100%)",
        borderRadius: "14px 14px 0 0",
        padding: "6px 6px calc(8px + env(safe-area-inset-bottom, 0px))",
        boxShadow: "0 -2px 12px rgba(0,0,0,0.3)",
        border: "3px solid #5d3d2a", borderBottom: "none",
        flexShrink: 0,
      }}>
        {/* チューブ列 */}
        <div style={{
          display: "flex", justifyContent: "center", gap: 1,
          background: "rgba(0,0,0,0.15)",
          borderRadius: 10, padding: "3px 2px 5px", marginBottom: 5,
        }}>
          {TUBE_COLORS.map(id => (
            <PaintTube key={id} colorId={id} onPress={handleTube} selected={pendingColor === id} />
          ))}
        </div>

        {/* 下段：パレット＋ツール（wrapで狭い画面にも対応） */}
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          justifyContent: "center", flexWrap: "wrap",
        }}>
          {/* パレット */}
          <div style={{
            background: "linear-gradient(135deg, #f0e6d3, #e8d5b0)",
            borderRadius: 10, padding: "5px 6px",
            border: "2px solid #c9aa88",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.2)",
          }}>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              {wells.map((well, i) => (
                <PaletteWell
                  key={i}
                  well={well}
                  index={i}
                  selected={selectedWell === i}
                  onSelect={handleWellSelect}
                  blinkActive={paletteBlinking}
                  pendingColor={pendingColor}
                  justFilled={justFilledIndex === i}
                  mixing={mixingWell && mixingWell.index === i ? mixingWell : null}
                />
              ))}
            </div>
          </div>

          {/* ツール群 */}
          <div style={{
            display: "flex", gap: 2, alignItems: "center",
            background: "rgba(0,0,0,0.1)", borderRadius: 10, padding: "2px 4px",
          }}>
            <BrushPanel
              brushHex={brushHex}
              wetness={wetnessUI}
              brushSize={brushSize}
              onSizeChange={setBrushSize}
            />
            <WaterCup dirtiness={waterDirt} onWash={handleWash} />
            <Cloth onWipe={handleWipe} />
            <UndoButton onUndo={handleUndo} disabled={!canUndo} />
            <ClearButton onClear={handleClear} />
            <ToolButton icon="📖" label="ずかん" onClick={() => setZukanOpen(true)} />
            <ToolButton icon="⭐" label="のこす" onClick={handleSaveArtwork} />
          </div>
        </div>
      </div>
    </div>
  );
}
