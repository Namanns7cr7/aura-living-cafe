import * as THREE from "three";

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(ix: number, iy: number, seed: number): number {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * smoothNoise(x * freq, y * freq, seed + i * 19);
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

/** Periodic seamless noise horizontally (wraps cleanly around u = 0..1 on LatheGeometry). */
function cylindricalFbm(u: number, v: number, radiusFreq: number, vFreq: number, seed: number): number {
  const theta = u * Math.PI * 2;
  const cx = Math.cos(theta) * radiusFreq + 12.3;
  const cy = Math.sin(theta) * radiusFreq + v * vFreq;
  return fbm(cx, cy, seed, 3);
}

export interface PBRTextureSet {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates dark oiled walnut wood grain PBR textures (512x512).
 */
export function createWalnutTextures(): PBRTextureSet {
  const size = 256;
  const albedoCanvas = document.createElement("canvas");
  const roughCanvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  albedoCanvas.width = roughCanvas.width = bumpCanvas.width = size;
  albedoCanvas.height = roughCanvas.height = bumpCanvas.height = size;

  const aCtx = albedoCanvas.getContext("2d")!;
  const rCtx = roughCanvas.getContext("2d")!;
  const bCtx = bumpCanvas.getContext("2d")!;

  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const ny = y / size;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const warp = fbm(nx * 2.8, ny * 1.4, 11, 3) * 1.7;
      const grainCoord = ny * 24.0 + warp * 4.8 + Math.sin(nx * Math.PI * 2.0) * 0.4;
      const ring = 0.5 + 0.5 * Math.sin(grainCoord * Math.PI);
      const fineFiber = fbm(nx * 96.0, ny * 14.0, 37, 3);
      const pore = smoothNoise(nx * 140.0, ny * 22.0, 71);
      const poreDip = pore > 0.85 ? (pore - 0.85) * 4.4 : 0.0;

      const tone = Math.min(1, Math.max(0, ring * 0.62 + fineFiber * 0.38 - poreDip * 0.45));
      // Warm rich dark walnut (#1C100A -> #563220)
      const r = Math.round(28 + tone * 58);
      const g = Math.round(16 + tone * 34);
      const b = Math.round(10 + tone * 21);

      const rough = Math.round((0.36 + (1 - tone) * 0.18 + poreDip * 0.25) * 255);
      const bump = Math.round((0.52 + (ring - 0.5) * 0.26 - poreDip * 0.42) * 255);

      const idx = (y * size + x) * 4;
      aImg.data[idx] = r;
      aImg.data[idx + 1] = g;
      aImg.data[idx + 2] = b;
      aImg.data[idx + 3] = 255;

      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = Math.min(255, Math.max(0, rough));
      rImg.data[idx + 3] = 255;

      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = Math.min(255, Math.max(0, bump));
      bImg.data[idx + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);

  map.colorSpace = THREE.SRGBColorSpace;
  [map, roughnessMap, bumpMap].forEach((tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(7.5, 4.2);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  });

  return {
    map,
    roughnessMap,
    bumpMap,
    dispose: () => {
      map.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
    },
  };
}

/**
 * Horizontally seamless dark charcoal stoneware ceramic maps (no LatheGeometry seam!).
 */
export function createStonewareTextures(): PBRTextureSet {
  const size = 256;
  const albedoCanvas = document.createElement("canvas");
  const roughCanvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  albedoCanvas.width = roughCanvas.width = bumpCanvas.width = size;
  albedoCanvas.height = roughCanvas.height = bumpCanvas.height = size;

  const aCtx = albedoCanvas.getContext("2d")!;
  const rCtx = roughCanvas.getContext("2d")!;
  const bCtx = bumpCanvas.getContext("2d")!;

  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);

  const rand = mulberry32(9021);
  const speckles: Array<{ x: number; y: number; r: number; warm: boolean }> = [];
  for (let i = 0; i < 720; i++) {
    speckles.push({
      x: rand() * size,
      y: rand() * size,
      r: 0.55 + rand() * 1.15,
      warm: rand() > 0.5,
    });
  }

  for (let y = 0; y < size; y++) {
    const ny = y / size;
    const wheelLine = Math.sin(ny * 150) * 0.016 + fbm(0.5, ny * 28, 5, 2) * 0.035;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      // Cylindrical seamless noise avoids any vertical seam at u = 0 / 1
      const clayVar = cylindricalFbm(nx, ny, 3.5, 10.0, 19);
      const base = 0.22 + clayVar * 0.06 + wheelLine;
      const r = Math.round(base * 195);
      const g = Math.round(base * 158);
      const b = Math.round(base * 138);

      const rough = Math.round((0.68 + clayVar * 0.14) * 255);
      const bump = Math.round((0.5 + wheelLine * 1.3 + (clayVar - 0.5) * 0.14) * 255);

      const idx = (y * size + x) * 4;
      aImg.data[idx] = Math.min(255, Math.max(0, r));
      aImg.data[idx + 1] = Math.min(255, Math.max(0, g));
      aImg.data[idx + 2] = Math.min(255, Math.max(0, b));
      aImg.data[idx + 3] = 255;

      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = Math.min(255, Math.max(0, rough));
      rImg.data[idx + 3] = 255;

      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = Math.min(255, Math.max(0, bump));
      bImg.data[idx + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  // Wrap kiln mineral flecks cleanly across horizontal seam
  for (const sp of speckles) {
    for (const dx of [0, -size, size]) {
      const sx = sp.x + dx;
      if (sx < -4 || sx > size + 4) continue;
      aCtx.fillStyle = sp.warm ? "rgba(135, 102, 74, 0.28)" : "rgba(18, 12, 9, 0.42)";
      aCtx.beginPath();
      aCtx.arc(sx, sp.y, sp.r, 0, Math.PI * 2);
      aCtx.fill();

      bCtx.fillStyle = "rgba(95, 95, 95, 0.28)";
      bCtx.beginPath();
      bCtx.arc(sx, sp.y, sp.r, 0, Math.PI * 2);
      bCtx.fill();
    }
  }

  const map = new THREE.CanvasTexture(albedoCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);

  map.colorSpace = THREE.SRGBColorSpace;
  [map, roughnessMap, bumpMap].forEach((tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  });

  return {
    map,
    roughnessMap,
    bumpMap,
    dispose: () => {
      map.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
    },
  };
}

/**
 * Generates warm glazed ceramic interior texture (#E8DAC4 Milk Foam glaze).
 */
export function createGlazeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#EADCC6";
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(441);
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(145, 114, 86, 0.14)" : "rgba(250, 243, 232, 0.28)";
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, 0.5 + rand() * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates realistic medium-dark roasted Arabica bean PBR textures.
 * UV.x = 0.5 corresponds to the ventral crease / chaff line.
 */
export function createBeanTextures(): PBRTextureSet {
  const size = 128;
  const albedoCanvas = document.createElement("canvas");
  const roughCanvas = document.createElement("canvas");
  const bumpCanvas = document.createElement("canvas");
  albedoCanvas.width = roughCanvas.width = bumpCanvas.width = size;
  albedoCanvas.height = roughCanvas.height = bumpCanvas.height = size;

  const aCtx = albedoCanvas.getContext("2d")!;
  const rCtx = roughCanvas.getContext("2d")!;
  const bCtx = bumpCanvas.getContext("2d")!;

  const aImg = aCtx.createImageData(size, size);
  const rImg = rCtx.createImageData(size, size);
  const bImg = bCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const ny = y / size;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const roastNoise = fbm(nx * 14, ny * 14, 101, 4);
      const microPore = smoothNoise(nx * 54, ny * 54, 213);

      const creaseDist = Math.abs(nx - 0.5);
      const chaffMask = Math.exp(-Math.pow(creaseDist / 0.042, 2.0)) * (0.55 + 0.45 * roastNoise);

      // Rich warm mahogany roast so beans read distinctly against dark walnut
      const roastR = 74 + roastNoise * 32;
      const roastG = 42 + roastNoise * 20;
      const roastB = 24 + roastNoise * 12;

      const r = Math.round(roastR * (1 - chaffMask * 0.65) + 185 * chaffMask * 0.65);
      const g = Math.round(roastG * (1 - chaffMask * 0.65) + 144 * chaffMask * 0.65);
      const b = Math.round(roastB * (1 - chaffMask * 0.65) + 96 * chaffMask * 0.65);

      const rough = Math.round((0.32 + microPore * 0.14 + chaffMask * 0.25) * 255);
      const bump = Math.round((0.48 + roastNoise * 0.22 - microPore * 0.16) * 255);

      const idx = (y * size + x) * 4;
      aImg.data[idx] = Math.min(255, Math.max(0, r));
      aImg.data[idx + 1] = Math.min(255, Math.max(0, g));
      aImg.data[idx + 2] = Math.min(255, Math.max(0, b));
      aImg.data[idx + 3] = 255;

      rImg.data[idx] = rImg.data[idx + 1] = rImg.data[idx + 2] = Math.min(255, Math.max(0, rough));
      rImg.data[idx + 3] = 255;

      bImg.data[idx] = bImg.data[idx + 1] = bImg.data[idx + 2] = Math.min(255, Math.max(0, bump));
      bImg.data[idx + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  rCtx.putImageData(rImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  const map = new THREE.CanvasTexture(albedoCanvas);
  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  const bumpMap = new THREE.CanvasTexture(bumpCanvas);

  map.colorSpace = THREE.SRGBColorSpace;
  [map, roughnessMap, bumpMap].forEach((tex) => {
    tex.anisotropy = 4;
    tex.needsUpdate = true;
  });

  return {
    map,
    roughnessMap,
    bumpMap,
    dispose: () => {
      map.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
    },
  };
}

/**
 * Generates radial tiger-stripe noise map for realistic espresso crema.
 */
export function createCremaNoiseTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    const dy = y / size - 0.5;
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2.0;
      const angle = Math.atan2(dy, dx);
      const swirl = fbm(Math.cos(angle + r * 2.5) * 3.2 + 4, Math.sin(angle + r * 2.5) * 3.2 + 4, 88, 4);
      const bubbles = fbm(x * 0.28, y * 0.28, 15, 3);
      const val = Math.min(1, Math.max(0, swirl * 0.65 + bubbles * 0.35));

      const idx = (y * size + x) * 4;
      const c = Math.round(val * 255);
      img.data[idx] = c;
      img.data[idx + 1] = Math.round(bubbles * 255);
      img.data[idx + 2] = Math.round(swirl * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Lightweight 64x32 warm café studio equirectangular reflection texture.
 * Replaces multi-pass CubeCamera baking with instant warm window & caramel rim reflections.
 */
export function createStudioEnvTexture(): THREE.DataTexture {
  const w = 64;
  const h = 32;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 bottom .. 1 top
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      // Warm dark umber base
      let r = 28;
      let g = 18;
      let b = 12;

      // Soft warm ceiling bounce
      const topGlow = Math.pow(Math.max(0, v - 0.45) / 0.55, 1.6);
      r += topGlow * 95;
      g += topGlow * 78;
      b += topGlow * 58;

      // Left-front morning window softbox
      const duWin = Math.abs(u - 0.22);
      const dvWin = Math.abs(v - 0.64);
      const win = Math.exp(-duWin * duWin * 48) * Math.exp(-dvWin * dvWin * 26);
      r += win * 215;
      g += win * 195;
      b += win * 165;

      // Subtle right caramel rim strip
      const duRim = Math.abs(u - 0.78);
      const dvRim = Math.abs(v - 0.55);
      const rim = Math.exp(-duRim * duRim * 60) * Math.exp(-dvRim * dvRim * 28);
      r += rim * 120;
      g += rim * 76;
      b += rim * 38;

      const idx = (y * w + x) * 4;
      data[idx] = Math.min(255, Math.round(r));
      data[idx + 1] = Math.min(255, Math.round(g));
      data[idx + 2] = Math.min(255, Math.round(b));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
