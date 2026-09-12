import * as THREE from "three";
import { EffectComposer } from "./vendor/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "./vendor/addons/postprocessing/GTAOPass.js";
import { ShaderPass } from "./vendor/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "./vendor/addons/postprocessing/OutputPass.js";

const W = 1000, H = 600;
const GROUND_TOP = -230;
const YAXIS = new THREE.Vector3(0, 1, 0);
const CAM_POS = { x: -300, y: 285, z: 1120 };
const CAM_LOOK = { x: 0, y: -55, z: 70 };

const FxShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.3 }
  },
  vertexShader: [
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}"
  ].join("\n"),
  fragmentShader: [
    "uniform sampler2D tDiffuse;",
    "uniform float vignette;",
    "varying vec2 vUv;",
    "void main() {",
    "  vec4 col = texture2D(tDiffuse, vUv);",
    "  float vd = distance(vUv, vec2(0.5));",
    "  col.rgb *= 1.0 - vignette * smoothstep(0.42, 0.9, vd);",
    "  gl_FragColor = col;",
    "}"
  ].join("\n")
};

let renderer, scene, camera, state = null;
let root, flashQuad;
let composer, bloomPass, gtaoPass, fxPass;
let frameStamp = 1;
const camSmooth = { x: 0, y: 0, fov: 0 };
let prevLaunched = false;

const blockMeshes = new Map();
const pigMeshes = new Map();
const birdMeshes = new Map();
const debrisMeshes = new Map();
const popupPool = [];
const ringPool = [];
const trajPool = [];
const particlePools = { dot: [], shard: [], splinter: [], rock: [], smoke: [] };
let cloudGroup, backdrop;
let slingGroup, bandL, bandR, powerBar, powerBarBg;
let queueGroup;

function wx(mx) { return mx - W / 2; }
function wy(my) { return H / 2 - my; }

function parseCss(s) {
  if (typeof s !== "string") return { color: new THREE.Color(1, 1, 1), alpha: 1 };
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    const hex = "#" + [p[0], p[1], p[2]].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
    const c = new THREE.Color().setStyle(hex);
    return { color: c, alpha: p.length > 3 ? p[3] : 1 };
  }
  return { color: new THREE.Color().setStyle(s), alpha: 1 };
}

function cv2d(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return { c: c, g: c.getContext("2d"), size: size };
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

function noiseOn(g, size, n, dark, light) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 0.6 + Math.random() * 2;
    g.fillStyle = Math.random() < 0.5 ? dark : light;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}

function normalFromCanvas(src, strength) {
  const w = src.width, h = src.height;
  const ctx = src.getContext("2d");
  const data = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const g = out.getContext("2d");
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + h) % h, yd = (y + 1) % h;
      const dx = (lum[y * w + xr] - lum[y * w + xl]) * strength;
      const dy = (lum[yd * w + x] - lum[yu * w + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const tex = {};
function buildTextures() {
  tex.wood = canvasTex(256, 256, (g, s) => {
    const grd = g.createLinearGradient(0, 0, s, 0);
    grd.addColorStop(0, "#e6b076"); grd.addColorStop(0.5, "#ca8b4d"); grd.addColorStop(1, "#a9713a");
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(120,70,25,0.35)"; g.lineWidth = 1.5;
    for (let i = 0; i < 22; i++) {
      const y = Math.random() * s;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3 + (Math.random() - 0.5) * 2);
      g.stroke();
    }
    g.strokeStyle = "rgba(90,50,15,0.5)"; g.lineWidth = 2;
    for (let k = 0; k < 2; k++) {
      const kx = 50 + k * 120, ky = 70 + k * 90;
      g.beginPath(); g.ellipse(kx, ky, 16, 9, 0.4, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.ellipse(kx, ky, 8, 4, 0.4, 0, Math.PI * 2); g.stroke();
    }
    noiseOn(g, s, 500, "rgba(70,40,10,0.10)", "rgba(255,225,180,0.10)");
  });

  tex.stone = canvasTex(256, 256, (g, s) => {
    g.fillStyle = "#9aa3ad"; g.fillRect(0, 0, s, s);
    noiseOn(g, s, 1600, "rgba(70,80,90,0.22)", "rgba(220,228,236,0.22)");
    g.fillStyle = "rgba(60,70,80,0.25)";
    for (let i = 0; i < 26; i++) { g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 0, 6.3); g.fill(); }
    g.strokeStyle = "rgba(70,78,88,0.30)"; g.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      g.beginPath(); const x = Math.random() * s, y = Math.random() * s;
      g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 70, y + (Math.random() - 0.5) * 70); g.stroke();
    }
  });

  tex.ice = canvasTex(256, 256, (g, s) => {
    const grd = g.createLinearGradient(0, 0, s, s);
    grd.addColorStop(0, "#e8faff"); grd.addColorStop(0.5, "#bdeaff"); grd.addColorStop(1, "#8fd6f5");
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 2;
    for (let i = 0; i < 14; i++) { g.beginPath(); const x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); g.lineTo(x + 30 + Math.random() * 50, y - 30 - Math.random() * 50); g.stroke(); }
    noiseOn(g, s, 250, "rgba(120,190,225,0.15)", "rgba(255,255,255,0.25)");
  });

  tex.glass = canvasTex(256, 256, (g, s) => {
    const grd = g.createLinearGradient(0, 0, s, s);
    grd.addColorStop(0, "#f0fff8"); grd.addColorStop(0.5, "#c7ecd9"); grd.addColorStop(1, "#8fd0b4");
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.fillStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 6; i++) { g.save(); g.rotate(-0.6); g.fillRect(-40, i * 52, s + 80, 7); g.restore(); }
    noiseOn(g, s, 120, "rgba(120,200,160,0.12)", "rgba(255,255,255,0.2)");
  });

  tex.metal = canvasTex(256, 256, (g, s) => {
    g.fillStyle = "#8f97a4"; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.10)" : "rgba(50,56,66,0.10)";
      g.lineWidth = 1 + Math.random();
      const y = Math.random() * s;
      g.beginPath(); g.moveTo(0, y); g.lineTo(s, y + (Math.random() - 0.5) * 6); g.stroke();
    }
    noiseOn(g, s, 500, "rgba(50,56,66,0.10)", "rgba(230,236,244,0.12)");
  });

  tex.sand = canvasTex(256, 256, (g, s) => {
    g.fillStyle = "#e3c88b"; g.fillRect(0, 0, s, s);
    noiseOn(g, s, 1800, "rgba(150,120,60,0.20)", "rgba(255,245,210,0.22)");
  });

  tex.tnt = canvasTex(256, 256, (g, s) => {
    g.fillStyle = "#d9463f"; g.fillRect(0, 0, s, s);
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, "rgba(255,255,255,0.25)"); grd.addColorStop(0.5, "rgba(255,255,255,0)"); grd.addColorStop(1, "rgba(0,0,0,0.2)");
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 6; g.strokeRect(14, 14, s - 28, s - 28);
    g.fillStyle = "#fff"; g.font = "bold 72px Trebuchet MS, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("TNT", s / 2, s / 2 + 4);
    noiseOn(g, s, 200, "rgba(120,20,20,0.15)", "rgba(255,180,180,0.12)");
  });

  tex.grass = canvasTex(256, 256, (g, s) => {
    g.fillStyle = "#63b83c"; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const x = Math.random() * s, y = Math.random() * s;
      const shade = Math.random();
      g.fillStyle = shade < 0.34 ? "rgba(70,150,40,0.55)" : shade < 0.68 ? "rgba(120,200,80,0.55)" : "rgba(160,225,110,0.5)";
      g.fillRect(x, y, 1.4, 3 + Math.random() * 4);
    }
  }, [45, 22]);

  tex.dirt = canvasTex(256, 256, (g, s) => {
    const grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, "#7a5a34"); grd.addColorStop(0.3, "#6b4c2a"); grd.addColorStop(1, "#46311e");
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    noiseOn(g, s, 1200, "rgba(40,28,15,0.30)", "rgba(160,130,90,0.25)");
    g.fillStyle = "rgba(30,20,10,0.35)";
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.5, 0, 6.3); g.fill(); }
  }, [40, 6]);

  tex.sky = canvasTex(1024, 512, (g, s) => {
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, "#3f8fd4"); grd.addColorStop(0.45, "#8ec9ef"); grd.addColorStop(1, "#dff2fc");
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
    const sun = g.createRadialGradient(820, 90, 8, 820, 90, 220);
    sun.addColorStop(0, "rgba(255,246,210,1)"); sun.addColorStop(0.25, "rgba(255,236,160,0.7)"); sun.addColorStop(1, "rgba(255,236,160,0)");
    g.fillStyle = sun; g.fillRect(560, -80, 464, 400);
  });

  tex.hills = canvasTex(2048, 512, (g, s) => {
    g.clearRect(0, 0, 2048, 512);
    function layer(baseY, amp, freq, color) {
      g.beginPath(); g.moveTo(0, 512);
      for (let x = 0; x <= 2048; x += 16) {
        const y = baseY - amp * (0.5 + 0.5 * Math.sin(x * 0.004 * freq)) - amp * 0.3 * Math.sin(x * 0.009 * freq);
        g.lineTo(x, y);
      }
      g.lineTo(2048, 512); g.closePath(); g.fillStyle = color; g.fill();
    }
    layer(300, 70, 0.5, "#a9d2e6");
    layer(360, 90, 1, "#6fa9c9");
    layer(420, 120, 2, "#5793b6");
  });

  tex.glow = canvasTex(128, 128, (g, s) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, "rgba(255,250,220,1)"); r.addColorStop(0.4, "rgba(255,230,150,0.55)"); r.addColorStop(1, "rgba(255,230,150,0)");
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });

  tex.soft = canvasTex(64, 64, (g, s) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,0.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });

  tex.vignette = canvasTex(256, 256, (g, s) => {
    const r = g.createRadialGradient(128, 128, 80, 128, 128, 210);
    r.addColorStop(0, "rgba(0,0,0,0)"); r.addColorStop(1, "rgba(6,12,20,0.42)");
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });

  tex.env = canvasTex(512, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#8fc3ee"); grd.addColorStop(0.42, "#dff2fc"); grd.addColorStop(0.52, "#cfe3c0"); grd.addColorStop(1, "#5c4630");
    g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
    const sun = g.createRadialGradient(380, 70, 4, 380, 70, 120);
    sun.addColorStop(0, "rgba(255,246,210,1)"); sun.addColorStop(0.3, "rgba(255,236,160,0.7)"); sun.addColorStop(1, "rgba(255,236,160,0)");
    g.fillStyle = sun; g.fillRect(220, 0, 320, 220);
  });
  tex.env.mapping = THREE.EquirectangularReflectionMapping;

  const normalSpec = [
    ["wood", tex.wood, 3.2, null],
    ["stone", tex.stone, 5, null],
    ["ice", tex.ice, 2.5, null],
    ["glass", tex.glass, 2, null],
    ["metal", tex.metal, 3, null],
    ["sand", tex.sand, 3.5, null],
    ["tnt", tex.tnt, 3.5, null]
  ];
  normalSpec.forEach((spec) => {
    const n = normalFromCanvas(spec[1].image, spec[2]);
    if (spec[3]) n.repeat.set(spec[3][0], spec[3][1]);
    tex[spec[0] + "Norm"] = n;
  });
}

const outWood = new THREE.LineBasicMaterial({ color: 0x5a3a16, transparent: true, opacity: 0.30 });
const outStone = new THREE.LineBasicMaterial({ color: 0x3f4650, transparent: true, opacity: 0.30 });
const outIce = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 });
const outMetal = new THREE.LineBasicMaterial({ color: 0x333a44, transparent: true, opacity: 0.35 });

function blockMaterial(kind) {
  const nscale = new THREE.Vector2(0.45, 0.45);
  switch (kind) {
    case "stone": return new THREE.MeshStandardMaterial({ map: tex.stone, normalMap: tex.stoneNorm, normalScale: nscale, roughness: 0.92, metalness: 0.04, envMapIntensity: 0.55 });
    case "ice": return new THREE.MeshStandardMaterial({ map: tex.ice, normalMap: tex.iceNorm, normalScale: nscale, roughness: 0.08, metalness: 0.10, transparent: true, opacity: 0.66, emissive: 0x2a6b90, emissiveIntensity: 0.18, envMapIntensity: 1.35 });
    case "glass": return new THREE.MeshStandardMaterial({ map: tex.glass, normalMap: tex.glassNorm, normalScale: nscale, roughness: 0.05, metalness: 0.10, transparent: true, opacity: 0.55, emissive: 0x1f7a55, emissiveIntensity: 0.14, envMapIntensity: 1.35 });
    case "metal": return new THREE.MeshStandardMaterial({ map: tex.metal, normalMap: tex.metalNorm, normalScale: nscale, roughness: 0.34, metalness: 0.78, envMapIntensity: 1.5 });
    case "sand": return new THREE.MeshStandardMaterial({ map: tex.sand, normalMap: tex.sandNorm, normalScale: nscale, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.5 });
    case "tnt": return new THREE.MeshStandardMaterial({ map: tex.tnt, normalMap: tex.tntNorm, normalScale: nscale, roughness: 0.7, metalness: 0.05, envMapIntensity: 0.5, emissive: 0x3a0a08, emissiveIntensity: 0.25 });
    default: return new THREE.MeshStandardMaterial({ map: tex.wood, normalMap: tex.woodNorm, normalScale: nscale, roughness: 0.86, metalness: 0.03, envMapIntensity: 0.5 });
  }
}
function outlineFor(kind) {
  if (kind === "wood") return outWood;
  if (kind === "stone") return outStone;
  if (kind === "metal") return outMetal;
  if (kind === "ice" || kind === "glass") return outIce;
  return outWood;
}

function blockDepth(w, h) { return Math.max(30, Math.min(92, Math.min(w, h) * 1.7)); }

function createBlock(body) {
  const p = body.plugin;
  const depth = blockDepth(p.w, p.h);
  const geo = new THREE.BoxGeometry(p.w, p.h, depth);
  const mat = blockMaterial(p.kind);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), outlineFor(p.kind)));
  mesh.userData = { kind: p.kind, baseEmissive: mat.emissive.clone(), emissiveIntensity: mat.emissiveIntensity || 0 };
  return mesh;
}

function createDebris(body) {
  const p = body.plugin;
  const depth = Math.max(6, Math.min(40, Math.min(p.w, p.h) * 0.8));
  const geo = new THREE.BoxGeometry(p.w, p.h, depth);
  const mesh = new THREE.Mesh(geo, blockMaterial(p.kind));
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function makePigMesh(type) {
  const t = PIG_TYPES[type] || PIG_TYPES.small;
  const r = t.r;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.body), roughness: 0.5, metalness: 0.02 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);
  const snoutMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.snout), roughness: 0.55 });
  const snout = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 20, 14), snoutMat);
  snout.scale.set(1.05, 0.72, 0.62);
  snout.position.set(0, -r * 0.14, r * 0.78);
  g.add(snout);
  const noseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.dark), roughness: 0.6 });
  [-1, 1].forEach((s) => {
    const n = new THREE.Mesh(new THREE.SphereGeometry(r * 0.09, 10, 8), noseMat);
    n.position.set(s * r * 0.16, -r * 0.14, r * 1.12);
    g.add(n);
  });
  [0.62, -0.62].forEach((s) => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(r * 0.3, 14, 10), noseMat);
    ear.position.set(s * r, -r * 0.78, -r * 0.1);
    ear.scale.set(0.9, 0.9, 0.6);
    g.add(ear);
  });
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x1f2430 });
  [-1, 1].forEach((s) => {
    const ew = new THREE.Mesh(new THREE.SphereGeometry(r * 0.24, 14, 10), eyeWhite);
    ew.position.set(s * r * 0.33, r * 0.22, r * 0.72);
    g.add(ew);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 10, 8), pupil);
    pu.position.set(s * r * 0.30, r * 0.22, r * 0.90);
    g.add(pu);
  });
  if (t.armor) {
    const helmMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.3, metalness: 0.75 });
    const helm = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), helmMat);
    helm.position.set(0, r * 0.16, 0);
    helm.castShadow = true;
    g.add(helm);
  }
  return g;
}

function makeBirdMesh(type) {
  const t = BIRD_TYPES[type];
  const r = t.r;
  const g = new THREE.Group();
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.dark), roughness: 0.6 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color), roughness: 0.45, metalness: 0.03 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.belly), roughness: 0.5 });

  const tail = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, r * 1.3, 4), darkMat);
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -r * 1.15;
  g.add(tail);

  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(r * 0.62, 20, 14), bellyMat);
  belly.scale.set(0.85, 0.62, 0.55);
  belly.position.set(r * 0.05, -r * 0.34, r * 0.5);
  g.add(belly);

  const wing = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 18, 12), darkMat);
  wing.scale.set(2.0, 0.42, 0.7);
  wing.position.set(-r * 0.18, 0.02, r * 0.42);
  g.add(wing);

  const beakMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.beak), roughness: 0.4 });
  const beak = new THREE.Mesh(new THREE.ConeGeometry(r * 0.28, r * 0.85, 12), beakMat);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(r * 1.08, -r * 0.02, r * 0.5);
  beak.castShadow = true;
  g.add(beak);

  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x1f2430 });
  const ew = new THREE.Mesh(new THREE.SphereGeometry(r * 0.26, 14, 10), eyeWhite);
  ew.position.set(r * 0.34, r * 0.36, r * 0.62);
  g.add(ew);
  const pu = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 10, 8), pupil);
  pu.position.set(r * 0.42, r * 0.36, r * 0.80);
  g.add(pu);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 0.12, r * 0.12), new THREE.MeshStandardMaterial({ color: 0x2a2013, roughness: 0.8 }));
  brow.position.set(r * 0.36, r * 0.66, r * 0.6);
  brow.rotation.z = type === "red" || type === "black" ? -0.35 : 0.15;
  g.add(brow);

  if (type === "black") {
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 0.7, 6), darkMat);
    fuse.position.set(-r * 0.05, r * 1.2, 0);
    fuse.rotation.z = 0.3;
    g.add(fuse);
    const spark = new THREE.Mesh(new THREE.SphereGeometry(r * 0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    spark.position.set(-r * 0.22, r * 1.5, 0);
    spark.name = "spark";
    g.add(spark);
  }
  g.userData.wing = wing;
  return g;
}

function createSling() {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.85 });
  const postH = 190;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(8, 10, postH, 12), woodMat);
  post.position.set(wx(165), GROUND_TOP + postH / 2, 0);
  post.castShadow = true; post.receiveShadow = true;
  g.add(post);
  [-1, 1].forEach((s) => {
    const prong = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 46, 10), woodMat);
    prong.position.set(wx(165) + s * 15, GROUND_TOP + postH + 12, 0);
    prong.rotation.z = s * 0.35;
    prong.castShadow = true;
    g.add(prong);
  });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x5a3d20, roughness: 0.9 });
  bandL = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 1, 8), bandMat);
  bandR = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 1, 8), bandMat);
  bandL.castShadow = true; bandR.castShadow = true;
  g.add(bandL); g.add(bandR);
  return g;
}

function clearMap(map) {
  map.forEach((m) => {
    m.parent && m.parent.remove(m);
    m.traverse && m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose && o.material.dispose(); });
  });
  map.clear();
}

export function init(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  buildTextures();
  scene.background = tex.sky;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromEquirectangular(tex.env).texture;
  pmrem.dispose();

  camera = new THREE.PerspectiveCamera(36, W / H, 1, 5000);
  camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
  camera.lookAt(CAM_LOOK.x, CAM_LOOK.y, CAM_LOOK.z);

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6b4c2a, 0.38));
  const key = new THREE.DirectionalLight(0xfff2d0, 2.2);
  key.position.set(520, 900, 760);
  key.target.position.set(0, -120, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -720; key.shadow.camera.right = 720;
  key.shadow.camera.top = 620; key.shadow.camera.bottom = -560;
  key.shadow.camera.near = 1; key.shadow.camera.far = 3200;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.3);
  fill.position.set(-600, 300, 400);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd9a0, 0.2);
  rim.position.set(0, 200, -800);
  scene.add(rim);

  root = new THREE.Group();
  scene.add(root);

  const groundGeo = new THREE.BoxGeometry(4200, 600, 2000);
  const topMat = new THREE.MeshStandardMaterial({ map: tex.grass, roughness: 1, metalness: 0, envMapIntensity: 0.45 });
  const sideMat = new THREE.MeshStandardMaterial({ map: tex.dirt, roughness: 1, metalness: 0, envMapIntensity: 0.35 });
  const ground = new THREE.Mesh(groundGeo, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  ground.position.set(0, GROUND_TOP - 300, 0);
  ground.receiveShadow = true;
  root.add(ground);

  const backGeo = new THREE.PlaneGeometry(2800, 900);
  const backMat = new THREE.MeshBasicMaterial({ map: tex.hills, transparent: true, depthWrite: false });
  backdrop = new THREE.Mesh(backGeo, backMat);
  backdrop.position.set(0, 220, -540);
  scene.add(backdrop);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  glow.position.set(430, 300, -700);
  glow.scale.set(300, 300, 1);
  scene.add(glow);
  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(38, 24, 18), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
  sunBall.position.set(430, 300, -720);
  scene.add(sunBall);

  cloudGroup = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, emissive: 0x9fc4e8, emissiveIntensity: 0.1 });
  for (let i = 0; i < 7; i++) {
    const gc = new THREE.Group();
    const n = 3 + (i % 2);
    for (let j = 0; j < n; j++) {
      const s = 26 + Math.random() * 22;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), cloudMat);
      puff.position.set((j - n / 2) * s * 0.9, Math.random() * 12, (Math.random() - 0.5) * 30);
      puff.scale.y = 0.7;
      gc.add(puff);
    }
    cloudGroup.add(gc);
  }
  scene.add(cloudGroup);

  slingGroup = createSling();
  root.add(slingGroup);

  const barBgMat = new THREE.MeshBasicMaterial({ color: 0x22303f });
  powerBarBg = new THREE.Mesh(new THREE.BoxGeometry(16, 70, 10), barBgMat);
  powerBarBg.position.set(wx(165 - 8), wy(70) - 40, 60);
  root.add(powerBarBg);
  powerBar = new THREE.Mesh(new THREE.BoxGeometry(16, 70, 12), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  root.add(powerBar);

  queueGroup = new THREE.Group();
  root.add(queueGroup);

  flashQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0xffeec8, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  flashQuad.frustumCulled = false;
  camera.add(flashQuad);
  flashQuad.position.set(0, 0, -2);
  scene.add(camera);

  composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));

  gtaoPass = new GTAOPass(scene, camera, W, H);
  gtaoPass.output = GTAOPass.OUTPUT.Default;
  gtaoPass.blendIntensity = 0.85;
  gtaoPass.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.0, scale: 1.0, samples: 16, glow: 0.0 });
  composer.addPass(gtaoPass);

  bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.42, 0.55, 0.9);
  composer.addPass(bloomPass);

  composer.addPass(new OutputPass());

  fxPass = new ShaderPass(FxShader);
  fxPass.renderToScreen = true;
  composer.addPass(fxPass);
}

function beginStamp() { frameStamp++; }

function seen(mesh) { mesh.userData.stamp = frameStamp; }
function isNew(mesh) { return mesh.userData.stamp !== frameStamp; }

function syncBlocks() {
  const list = state.blocks;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    let mesh = blockMeshes.get(b.id);
    if (!mesh) {
      mesh = createBlock(b);
      root.add(mesh);
      blockMeshes.set(b.id, mesh);
    }
    mesh.position.set(wx(b.position.x), wy(b.position.y), 0);
    mesh.rotation.z = -b.angle;
    const mat = mesh.material;
    const ratio = b.plugin.hp / b.plugin.maxHp;
    if (ratio < 0.75) {
      mat.emissive.copy(mesh.userData.baseEmissive);
      mat.emissive.lerp(new THREE.Color(0x511), (1 - ratio) * 0.6);
      mat.emissiveIntensity = Math.max(mesh.userData.emissiveIntensity, (1 - ratio) * 0.5);
    }
    seen(mesh);
  }
  blockMeshes.forEach((mesh, id) => {
    if (mesh.userData.stamp !== frameStamp) {
      root.remove(mesh);
      mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      blockMeshes.delete(id);
    }
  });
}

function syncPigs() {
  const list = state.pigs;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    let mesh = pigMeshes.get(p.id);
    if (!mesh) {
      mesh = makePigMesh(p.plugin.type);
      root.add(mesh);
      pigMeshes.set(p.id, mesh);
    }
    mesh.position.set(wx(p.position.x), wy(p.position.y), 0);
    mesh.rotation.z = -p.angle;
    seen(mesh);
  }
  pigMeshes.forEach((mesh, id) => {
    if (mesh.userData.stamp !== frameStamp) {
      root.remove(mesh);
      mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      pigMeshes.delete(id);
    }
  });
}

function syncBirds() {
  const list = state.birds;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    let mesh = birdMeshes.get(b.id);
    if (!mesh) {
      mesh = makeBirdMesh(b.plugin.type);
      root.add(mesh);
      birdMeshes.set(b.id, mesh);
    }
    const speed = Math.hypot(b.velocity.x, b.velocity.y);
    const ang = speed > 0.6 ? Math.atan2(b.velocity.y, b.velocity.x) : b.angle;
    const stretch = 1 + Math.min(speed * 0.02, 0.3);
    mesh.position.set(wx(b.position.x), wy(b.position.y), 0);
    mesh.rotation.z = -ang;
    mesh.scale.set(stretch, 1 / stretch, 1);
    const wing = mesh.userData.wing;
    if (wing) wing.rotation.x = speed > 1 ? Math.sin(state.time * 0.02) * 0.6 : 0;
    const spark = mesh.getObjectByName("spark");
    if (spark) spark.material.color.setHex(Math.sin(state.time * 0.03) > 0 ? 0xffd166 : 0xff7a3d);
    seen(mesh);
  }
  birdMeshes.forEach((mesh, id) => {
    if (mesh.userData.stamp !== frameStamp) {
      root.remove(mesh);
      mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      birdMeshes.delete(id);
    }
  });
}

function syncDebris() {
  const list = state.debris;
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    let mesh = debrisMeshes.get(d.id);
    if (!mesh) {
      mesh = createDebris(d);
      root.add(mesh);
      debrisMeshes.set(d.id, mesh);
    }
    mesh.position.set(wx(d.position.x), wy(d.position.y), 0);
    mesh.rotation.z = -d.angle;
    const alpha = Math.max(0, Math.min(1, d.plugin.life / 800));
    mesh.material.transparent = alpha < 1;
    mesh.material.opacity = alpha;
    seen(mesh);
  }
  debrisMeshes.forEach((mesh, id) => {
    if (mesh.userData.stamp !== frameStamp) {
      root.remove(mesh);
      mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      debrisMeshes.delete(id);
    }
  });
}

function particleObject(type) {
  if (type === "dot" || type === "smoke") {
    const mat = new THREE.SpriteMaterial({
      map: tex.soft,
      transparent: true,
      depthWrite: false,
      blending: type === "smoke" ? THREE.NormalBlending : THREE.AdditiveBlending
    });
    return new THREE.Sprite(mat);
  }
  let geo;
  if (type === "shard") geo = new THREE.OctahedronGeometry(1, 0);
  else geo = new THREE.BoxGeometry(1.2, 0.7, 0.5);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
}

function syncParticles() {
  const counts = { dot: 0, shard: 0, splinter: 0, rock: 0, smoke: 0 };
  const list = state.particles;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    let type = p.type || "dot";
    if (!particlePools[type]) type = "dot";
    const pool = particlePools[type];
    let obj = pool[counts[type]];
    if (!obj) {
      obj = particleObject(type);
      pool[counts[type]] = obj;
      root.add(obj);
    }
    const c = parseCss(p.color);
    const life = Math.max(0, p.life);
    obj.material.color.copy(c.color);
    obj.material.opacity = life * c.alpha;
    obj.position.set(wx(p.x), wy(p.y), (Math.random() - 0.5) * 20);
    if (obj.isSprite) {
      const grow = type === "smoke" ? 1.7 - life * 0.7 : 1;
      obj.scale.setScalar(Math.max(0.1, p.r * (type === "smoke" ? 2.2 : 1.7) * grow));
      obj.material.rotation = p.rot || 0;
    } else {
      obj.rotation.set(p.rot, p.rot * 0.7, p.rot);
      obj.scale.setScalar(Math.max(0.1, p.r * 0.85));
    }
    obj.visible = true;
    counts[type]++;
  }
  Object.keys(particlePools).forEach((type) => {
    const pool = particlePools[type];
    for (let i = counts[type]; i < pool.length; i++) {
      if (pool[i].visible) pool[i].visible = false;
    }
  });
}

function syncRings() {
  const list = state.rings;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    let mesh = ringPool[i];
    if (!mesh) {
      mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      ringPool[i] = mesh;
      root.add(mesh);
    }
    const c = parseCss(r.color);
    mesh.material.color.copy(c.color);
    mesh.material.opacity = Math.max(0, r.life);
    mesh.material.blending = r.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
    mesh.position.set(wx(r.x), wy(r.y), 40 + i);
    mesh.scale.setScalar(Math.max(1, r.r));
    mesh.visible = true;
  }
  for (let i = list.length; i < ringPool.length; i++) if (ringPool[i].visible) ringPool[i].visible = false;
}

function popupTexture(text, color) {
  const c = document.createElement("canvas");
  c.width = 320; c.height = 96;
  const g = c.getContext("2d");
  g.font = "bold 58px Trebuchet MS, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 8; g.strokeStyle = "rgba(0,0,0,0.55)";
  g.strokeText(text, 160, 50);
  g.fillStyle = color;
  g.fillText(text, 160, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function syncPopups() {
  const list = state.popups;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    let sprite = popupPool[i];
    if (!sprite) {
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false }));
      sprite.userData.text = "";
      popupPool[i] = sprite;
      root.add(sprite);
    }
    if (sprite.userData.text !== p.text || sprite.userData.color !== p.color) {
      if (sprite.material.map) sprite.material.map.dispose();
      sprite.material.map = popupTexture(p.text, p.color);
      sprite.material.needsUpdate = true;
      sprite.userData.text = p.text;
      sprite.userData.color = p.color;
    }
    sprite.material.opacity = Math.max(0, p.life);
    sprite.position.set(wx(p.x), wy(p.y), 120);
    sprite.scale.set(190, 57, 1);
    sprite.visible = true;
  }
  for (let i = list.length; i < popupPool.length; i++) if (popupPool[i].visible) popupPool[i].visible = false;
}

function syncTrajectory() {
  const s = state;
  const show = s.dragging && s.bird;
  let count = 0;
  if (show) {
    const pull = Math.hypot(s.pullVec.x, s.pullVec.y);
    if (pull >= 8) {
      let vx = -s.pullVec.x * s.launch, vy = -s.pullVec.y * s.launch;
      let x = s.slingX, y = s.slingY;
      const gStep = s.gravityStep;
      for (let i = 0; i < 200 && count < 60; i++) {
        x += vx; y += vy; vy += gStep;
        if (y > s.groundY || x > W + 60) break;
        if (i % 4 === 0) {
          let dot = trajPool[count];
          if (!dot) {
            dot = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
            trajPool[count] = dot;
            root.add(dot);
          }
          dot.position.set(wx(x), wy(y), 30);
          dot.material.opacity = 0.55 * (1 - i / 200);
          dot.visible = true;
          count++;
        }
      }
    }
  }
  for (let i = count; i < trajPool.length; i++) if (trajPool[i].visible) trajPool[i].visible = false;

  const t = Math.min(1, Math.hypot(s.pullVec.x, s.pullVec.y) / s.maxPull);
  const barTop = wy(s.slingY + 40);
  const barH = 70;
  powerBarBg.position.set(wx(s.slingX - 8), barTop - barH / 2, 60);
  powerBarBg.visible = show && t > 0;
  powerBar.scale.y = Math.max(0.001, t);
  powerBar.position.set(wx(s.slingX - 8), barTop - (barH * t) / 2, 62);
  powerBar.material.color.setHex(t > 0.8 ? 0xff5a4d : 0xffd166);
  powerBar.visible = show && t > 0;
}

function orientBand(mesh, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.set(1, Math.max(0.01, len), 1);
  mesh.quaternion.setFromUnitVectors(YAXIS, dir.normalize());
}

function syncSling() {
  const s = state;
  const ready = !!s.bird && !s.launched;
  bandL.visible = ready; bandR.visible = ready;
  if (ready) {
    const birdPos = new THREE.Vector3(wx(s.bird.position.x), wy(s.bird.position.y), 0);
    const topL = new THREE.Vector3(wx(s.slingX) - 15, GROUND_TOP + 190 + 30, 0);
    const topR = new THREE.Vector3(wx(s.slingX) + 15, GROUND_TOP + 190 + 30, 0);
    orientBand(bandL, topL, birdPos);
    orientBand(bandR, topR, birdPos);
  }
}

function birdPreview(type, scale) {
  const t = BIRD_TYPES[type];
  const g = new THREE.Group();
  const r = t.r;
  const body = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color), roughness: 0.5 }));
  body.castShadow = true;
  g.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 14, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color(t.belly), roughness: 0.6 }));
  belly.position.set(0, -r * 0.3, r * 0.5);
  belly.scale.set(1, 0.8, 0.6);
  g.add(belly);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(r * 0.26, r * 0.8, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color(t.beak), roughness: 0.5 }));
  beak.rotation.z = -Math.PI / 2;
  beak.position.x = r * 1.05;
  g.add(beak);
  g.scale.setScalar(scale);
  return g;
}

function syncQueue() {
  const q = state.birdQueue || [];
  while (queueGroup.children.length > q.length) {
    const m = queueGroup.children.pop();
    m.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  for (let i = 0; i < q.length; i++) {
    let g = queueGroup.children[i];
    if (!g || g.userData.type !== q[i]) {
      if (g) { queueGroup.remove(g); g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
      g = birdPreview(q[i], 1);
      g.userData.type = q[i];
      queueGroup.add(g);
    }
    const bob = Math.sin(state.time * 0.004 + i) * 2;
    g.position.set(wx(state.slingX - 60 - i * 34), GROUND_TOP + BIRD_TYPES[q[i]].r + 2 + bob, 0);
    g.rotation.z = 0;
  }
}

function syncClouds() {
  for (let i = 0; i < cloudGroup.children.length; i++) {
    const cl = state.clouds[i];
    const gc = cloudGroup.children[i];
    if (!cl) { gc.visible = false; continue; }
    gc.visible = true;
    gc.position.set(wx(cl.x), wy(cl.y), -260 - i * 20);
    gc.scale.setScalar(cl.s);
  }
}

export function render() {
  if (!renderer || !state) return;
  const s = state;
  beginStamp();

  syncBlocks();
  syncPigs();
  syncBirds();
  syncDebris();
  syncParticles();
  syncRings();
  syncPopups();
  syncTrajectory();
  syncSling();
  syncQueue();
  syncClouds();

  let followX = 0, followY = 0;
  if (s.activeFlight && s.birds && s.birds.length) {
    let lead = s.birds[0];
    for (let i = 1; i < s.birds.length; i++) if (s.birds[i].position.x > lead.position.x) lead = s.birds[i];
    followX = THREE.MathUtils.clamp((wx(lead.position.x) - 40) * 0.5, -160, 320);
    followY = THREE.MathUtils.clamp((wy(lead.position.y) - 40) * 0.16, -50, 80);
  }
  camSmooth.x += (followX - camSmooth.x) * 0.08;
  camSmooth.y += (followY - camSmooth.y) * 0.08;
  if (s.launched && !prevLaunched) camSmooth.fov = 1;
  prevLaunched = !!s.launched;
  camSmooth.fov *= 0.9;

  const slow = s.slowmo || 0;
  const fov = 36 + camSmooth.fov * 9 - slow * 4;
  if (Math.abs(camera.fov - fov) > 0.005) { camera.fov = fov; camera.updateProjectionMatrix(); }

  const shake = s.shake || 0;
  camera.position.set(
    CAM_POS.x + camSmooth.x + (Math.random() - 0.5) * shake,
    CAM_POS.y + camSmooth.y + (Math.random() - 0.5) * shake,
    CAM_POS.z
  );
  camera.lookAt(CAM_LOOK.x + camSmooth.x * 0.5, CAM_LOOK.y + camSmooth.y * 0.5, CAM_LOOK.z);

  flashQuad.material.opacity = Math.max(0, Math.min(1, s.flash || 0)) * 0.6;

  fxPass.uniforms.vignette.value = 0.3;
  bloomPass.strength = 0.42 + slow * 0.14;

  composer.render();
}

export function setState(s) { state = s; }

const PIG_TYPES = {
  small: { r: 17, body: "#7ec850", dark: "#4f8f2c", snout: "#a2e06f" },
  medium: { r: 23, body: "#74c247", dark: "#4a8828", snout: "#98d963" },
  big: { r: 31, body: "#69b83f", dark: "#427d22", snout: "#8ccf5a" },
  helmet: { r: 23, body: "#7ec850", dark: "#4f8f2c", snout: "#a2e06f", armor: 0.3 }
};
const BIRD_TYPES = {
  red: { r: 18, color: "#e5484d", dark: "#a52d31", belly: "#f3d2a6", beak: "#ffa41b" },
  yellow: { r: 17, color: "#ffc93c", dark: "#cf9300", belly: "#fff0c2", beak: "#ff8c1a" },
  blue: { r: 15, color: "#4aa8ff", dark: "#256db0", belly: "#d6ecff", beak: "#ffb020" },
  black: { r: 20, color: "#3b4049", dark: "#1c2026", belly: "#5a6270", beak: "#f5a623" }
};