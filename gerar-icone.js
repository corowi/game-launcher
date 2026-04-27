// gerar-icone.js
// Gera um icon.png válido de 512x512 sem dependências externas
// Usa apenas o módulo nativo 'fs' - funciona em qualquer Node.js

const fs = require("fs");
const path = require("path");

// PNG mínimo válido 1x1 pixel em base64 (padrão PNG spec)
// Vamos gerar um PNG 512x512 manualmente com cabeçalho correto

function createPNG(width, height, r, g, b) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcData = Buffer.concat([typeBuf, data]);
    const crc = crc32(crcData);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(crc);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  function crc32(buf) {
    let crc = 0xffffffff;
    const table = makeCRCTable();
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) | 0;
  }

  function makeCRCTable() {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // RGB color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Image data - simple gradient/icon
  const zlib = require("zlib");
  const rawRows = [];

  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter type none
    for (let x = 0; x < width; x++) {
      const cx = x - width / 2;
      const cy = y - height / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);
      const maxR = width / 2;

      // Draw a nice circular icon with gradient
      let pr, pg, pb;
      if (dist < maxR * 0.85) {
        // Inner circle - gradient from accent to dark
        const t = dist / (maxR * 0.85);
        // Dark blue to cyan gradient
        pr = Math.round(0 + t * 13);
        pg = Math.round(212 - t * 100);
        pb = Math.round(255 - t * 50);

        // Draw a simple "play" triangle in center
        const tx = x - width / 2;
        const ty = y - height / 2;
        const triSize = maxR * 0.3;
        if (tx > -triSize * 0.5 && tx < triSize &&
            Math.abs(ty) < (triSize - tx) * 0.8) {
          pr = 255; pg = 255; pb = 255;
        }
      } else if (dist < maxR * 0.95) {
        // Border ring
        pr = 0; pg = 212; pb = 255;
      } else {
        // Transparent-ish outer (dark bg)
        pr = 8; pg = 12; pb = 20;
      }

      row[1 + x * 3] = Math.min(255, Math.max(0, pr));
      row[2 + x * 3] = Math.min(255, Math.max(0, pg));
      row[3 + x * 3] = Math.min(255, Math.max(0, pb));
    }
    rawRows.push(row);
  }

  const raw = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw);

  const idat = chunk("IDAT", compressed);
  const iend = chunk("IEND", Buffer.alloc(0));
  const ihdrChunk = chunk("IHDR", ihdr);

  return Buffer.concat([sig, ihdrChunk, idat, iend]);
}

const assetsDir = path.join(__dirname, "src", "assets");
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

// Generate 512x512 PNG
const png512 = createPNG(512, 512, 0, 212, 255);
fs.writeFileSync(path.join(assetsDir, "icon.png"), png512);
console.log("✅ icon.png (512x512) gerado");

// Generate 256x256 PNG for ico
const png256 = createPNG(256, 256, 0, 212, 255);
fs.writeFileSync(path.join(assetsDir, "icon256.png"), png256);
console.log("✅ icon256.png (256x256) gerado");

// For Windows .ico: electron-builder can use the PNG directly if named icon.png
// But we also need icon.ico — create a minimal valid ICO wrapping the 256 PNG
function createICO(pngBuffer) {
  // ICO header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: ICO
  header.writeUInt16LE(1, 4);  // count: 1 image

  // Directory entry (16 bytes)
  const entry = Buffer.alloc(16);
  entry[0] = 0;   // width: 0 = 256
  entry[1] = 0;   // height: 0 = 256
  entry[2] = 0;   // color count
  entry[3] = 0;   // reserved
  entry.writeUInt16LE(1, 4);   // planes
  entry.writeUInt16LE(32, 6);  // bit count
  entry.writeUInt32LE(pngBuffer.length, 8);  // size of image data
  entry.writeUInt32LE(22, 12); // offset to image data (6 + 16)

  return Buffer.concat([header, entry, pngBuffer]);
}

const ico = createICO(png256);
fs.writeFileSync(path.join(assetsDir, "icon.ico"), ico);
console.log("✅ icon.ico gerado");

// For Mac: electron-builder accepts icon.png and converts automatically on Mac
// Create a copy named icon.icns placeholder (builder will warn but continue on non-Mac)
fs.copyFileSync(path.join(assetsDir, "icon.png"), path.join(assetsDir, "icon.icns"));
console.log("✅ icon.icns (placeholder) gerado");

console.log("");
console.log("🎮 Ícones prontos! Agora rode:");
console.log("   npx electron-builder --win");
console.log("");
console.log("💡 Para ícones personalizados, substitua src/assets/icon.png");
console.log("   por uma imagem 512x512 sua e rode este script novamente.");
