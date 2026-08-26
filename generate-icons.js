#!/usr/bin/env node
// Generate simple PNG icons for PWA
const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

const sizes = [192, 512];
const dir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

sizes.forEach(size => {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Background
  ctx.fillStyle = '#1e2335';
  roundRect(ctx, 0, 0, size, size, size * 0.22);
  ctx.fill();
  
  // Icon emoji substitute - simple document shape
  const pad = size * 0.2;
  const w = size - pad * 2;
  const h = w * 1.3;
  const x = pad;
  const y = (size - h) / 2;
  
  ctx.fillStyle = '#252a3d';
  roundRect(ctx, x, y, w, h, size * 0.06);
  ctx.fill();
  
  ctx.strokeStyle = '#3a4060';
  ctx.lineWidth = size * 0.02;
  roundRect(ctx, x, y, w, h, size * 0.06);
  ctx.stroke();
  
  // Lines
  ctx.fillStyle = '#5b8dee';
  const lx = x + w * 0.15;
  const lw = w * 0.7;
  const lh = size * 0.03;
  const r = lh / 2;
  [0.3, 0.45, 0.6, 0.75].forEach(frac => {
    const ly = y + h * frac;
    roundRect(ctx, lx, ly, frac === 0.3 ? lw : lw * 0.7, lh, r);
    ctx.fill();
  });
  
  // ฿ symbol
  ctx.fillStyle = '#4ade80';
  ctx.font = `bold ${size * 0.16}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('฿', size / 2, y + h * 0.18);

  const out = path.join(dir, `icon-${size}.png`);
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`Created ${out}`);
});

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
