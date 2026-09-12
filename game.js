import { init as init3D, setState as setState3D, render as render3D } from "./render3d.js";

(function () {
  "use strict";

  var M = Matter;
  var Engine = M.Engine, World = M.World, Bodies = M.Bodies, Body = M.Body,
      Events = M.Events, Vector = M.Vector, Query = M.Query, Composite = M.Composite;

  var W = 1000, H = 600;
  var GROUND_Y = H - 70;
  var SLING_X = 165, SLING_Y = GROUND_Y - 155;
  var MAX_PULL = 110;
  var LAUNCH = 0.185;
  var STEP = 1000 / 60;

  var canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game"));

  var MATERIALS = {
    wood:  { density: 0.0016, friction: 0.62, frictionStatic: 0.92, restitution: 0.04, hp: 19,  score: 120, fill: "#ca8b4d", dark: "#95612c", light: "#e6b076" },
    stone: { density: 0.0038, friction: 0.72, frictionStatic: 1.00, restitution: 0.02, hp: 56,  score: 190, fill: "#9aa3ad", dark: "#69727d", light: "#c6cdd5" },
    ice:   { density: 0.0011, friction: 0.10, frictionStatic: 0.20, restitution: 0.10, hp: 11,  score: 100, fill: "#a9e6ff", dark: "#63bde6", light: "#e8faff", icy: true },
    glass: { density: 0.0013, friction: 0.28, frictionStatic: 0.50, restitution: 0.12, hp: 8,   score: 130, fill: "#c7ecd9", dark: "#78bfa4", light: "#f0fff8", icy: true, brittle: true },
    metal: { density: 0.0060, friction: 0.50, frictionStatic: 0.85, restitution: 0.04, hp: 240, score: 260, fill: "#8f97a4", dark: "#575e6b", light: "#c9cfd9" },
    sand:  { density: 0.0019, friction: 0.85, frictionStatic: 1.00, restitution: 0.00, hp: 13,  score: 90,  fill: "#e3c88b", dark: "#b0913f", light: "#f6e4b5" },
    tnt:   { density: 0.0017, friction: 0.55, frictionStatic: 0.85, restitution: 0.03, hp: 9,   score: 160, fill: "#d9463f", dark: "#8f2a25", light: "#f28a84", explodes: true }
  };

  var BIRD_TYPES = {
    red:    { r: 18, density: 0.0068, color: "#e5484d", dark: "#a52d31", belly: "#f3d2a6", beak: "#ffa41b", ability: "none",   power: 1.0 },
    yellow: { r: 17, density: 0.0062, color: "#ffc93c", dark: "#cf9300", belly: "#fff0c2", beak: "#ff8c1a", ability: "dash",   power: 1.1 },
    blue:   { r: 15, density: 0.0052, color: "#4aa8ff", dark: "#256db0", belly: "#d6ecff", beak: "#ffb020", ability: "split",  power: 0.7 },
    black:  { r: 20, density: 0.0090, color: "#3b4049", dark: "#1c2026", belly: "#5a6270", beak: "#f5a623", ability: "bomb",   power: 1.3 }
  };

  var PIG_TYPES = {
    small:  { r: 17, hp: 16,  score: 800,  body: "#7ec850", dark: "#4f8f2c", snout: "#a2e06f" },
    medium: { r: 23, hp: 24,  score: 1000, body: "#74c247", dark: "#4a8828", snout: "#98d963" },
    big:    { r: 31, hp: 40,  score: 1500, body: "#69b83f", dark: "#427d22", snout: "#8ccf5a" },
    helmet: { r: 23, hp: 32,  score: 2000, body: "#7ec850", dark: "#4f8f2c", snout: "#a2e06f", armor: 0.3 }
  };

  var engine = Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  var world = engine.world;

  var CAT = { ground: 0x0001, block: 0x0002, pig: 0x0004, bird: 0x0008, debris: 0x0010 };

  var ground = Bodies.rectangle(W / 2, GROUND_Y + 40, W + 800, 80, {
    isStatic: true, label: "ground",
    friction: 0.9, frictionStatic: 1,
    collisionFilter: { category: CAT.ground }
  });
  var ceiling = Bodies.rectangle(W / 2, -60, W + 800, 80, { isStatic: true, label: "wall" });
  var leftWall = Bodies.rectangle(-60, H / 2, 80, H * 4, { isStatic: true, label: "wall" });
  var rightWall = Bodies.rectangle(W + 60, H / 2, 80, H * 4, { isStatic: true, label: "wall" });
  World.add(world, [ground, ceiling, leftWall, rightWall]);

  var blocks = [], pigs = [], debris = [], birds = [], particles = [], popups = [], rings = [];
  var bird = null, dragging = false, pulling = false, pullVec = { x: 0, y: 0 };
  var launched = false, abilityUsed = false, activeFlight = false;
  var settleTimer = 0, levelDone = false, losePending = false;
  var score = 0, bestScore = 0;
  var shake = 0, time = 0;
  var flash = 0, blinking = 0, blinkTimer = 2400;
  var slowmo = 0, impact = null, trailTick = 0;
  var birdQueue = [];
  var currentLevel = 0;
  var currentWorld = 0;
  var starsByLevel = {};
  var LEVELS_PER_WORLD = 6;
  var muted = false;
  var simMode = false;
  var gen = 0;

  var clouds = [];
  for (var ci = 0; ci < 7; ci++) {
    clouds.push({ x: Math.random() * W, y: 40 + Math.random() * 180, s: 0.55 + Math.random() * 0.9, v: 0.06 + Math.random() * 0.12 });
  }
  var bgBirds = [];
  for (var bi = 0; bi < 3; bi++) {
    bgBirds.push({ x: Math.random() * W, y: 70 + Math.random() * 100, v: 0.25 + Math.random() * 0.2, p: Math.random() * 6 });
  }

  var audioCtx = null;
  function ac() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }
  function unlock() { var c = ac(); if (c && c.state === "suspended") c.resume(); }
  function tone(freq, dur, type, vol, slideTo) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "square";
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0008, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }
  function noise(dur, vol) {
    if (muted) return;
    var c = ac();
    if (!c) return;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = c.createBufferSource(); s.buffer = buf;
    var g = c.createGain(); g.gain.value = vol || 0.1;
    s.connect(g); g.connect(c.destination); s.start();
  }
  function sfxLaunch() { tone(300, 0.22, "sawtooth", 0.13, 90); noise(0.12, 0.06); }
  function sfxThud(v) { tone(90 + Math.random() * 30, 0.09, "square", Math.min(0.1, 0.03 + v * 0.006)); }
  function sfxBreak(kind) {
    if (kind === "glass" || kind === "ice") { noise(0.18, 0.1); tone(1400, 0.12, "triangle", 0.06, 2400); }
    else if (kind === "stone") { tone(70, 0.18, "square", 0.11, 40); noise(0.14, 0.09); }
    else { tone(180, 0.12, "sawtooth", 0.09, 70); noise(0.1, 0.07); }
  }
  function sfxPop() { tone(520, 0.08, "square", 0.13); setTimeout(function () { tone(880, 0.12, "square", 0.1); }, 55); }
  function sfxBoom() { noise(0.5, 0.22); tone(70, 0.5, "sawtooth", 0.18, 30); }
  function sfxWin() { [523, 659, 784, 1046].forEach(function (f, i) { setTimeout(function () { tone(f, 0.2, "triangle", 0.14); }, i * 110); }); }
  function sfxLose() { [420, 320, 220].forEach(function (f, i) { setTimeout(function () { tone(f, 0.28, "sawtooth", 0.12); }, i * 150); }); }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  var rngState = 0x2545f491;
  function rnd() {
    rngState ^= rngState << 13; rngState |= 0;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5; rngState |= 0;
    return (rngState >>> 0) / 4294967296;
  }

  function makeBlock(x, y, w, h, kind, angle) {
    var m = MATERIALS[kind] || MATERIALS.wood;
    var opts = {
      label: "block",
      density: m.density, friction: m.friction, frictionStatic: m.frictionStatic,
      restitution: m.restitution, angle: angle || 0,
      collisionFilter: { category: CAT.block, mask: CAT.ground | CAT.block | CAT.pig | CAT.bird | CAT.debris }
    };
    var b = Bodies.rectangle(x, y, w, h, opts);
    b.plugin = { kind: kind, hp: m.hp, maxHp: m.hp, w: w, h: h };
    blocks.push(b); World.add(world, b);
    return b;
  }

  function makePig(x, y, type) {
    var t = PIG_TYPES[type] || PIG_TYPES.small;
    var p = Bodies.circle(x, y, t.r, {
      label: "pig",
      density: 0.0015, friction: 0.55, restitution: 0.16,
      collisionFilter: { category: CAT.pig, mask: CAT.ground | CAT.block | CAT.pig | CAT.bird | CAT.debris }
    });
    p.plugin = { type: type, r: t.r, hp: t.hp, maxHp: t.hp, alive: true, armor: t.armor || 0 };
    pigs.push(p); World.add(world, p);
    return p;
  }

  function makeBird(x, y, type) {
    var t = BIRD_TYPES[type];
    var b = Bodies.circle(x, y, t.r, {
      label: "bird",
      density: t.density, friction: 0.5, frictionAir: 0.002, restitution: 0.32,
      collisionFilter: { category: CAT.bird, mask: CAT.ground | CAT.block | CAT.pig | CAT.debris }
    });
    b.plugin = { type: type, r: t.r, isBird: true, settled: false };
    return b;
  }

  function beam(cx, bottom, w, h, kind, decor) {
    var b = makeBlock(cx, bottom - h / 2, w, h, kind);
    if (decor) b.plugin.decor = decor;
    return b;
  }
  function pigAt(cx, bottom, type) {
    var r = (PIG_TYPES[type] || PIG_TYPES.small).r;
    return makePig(cx, bottom - r, type);
  }

  function hut(cx, bottom, kind, pigType, legH) {
    legH = legH || 74;
    beam(cx - 44, bottom, 16, legH, kind);
    beam(cx + 44, bottom, 16, legH, kind);
    beam(cx, bottom - legH, 118, 14, kind, "roof");
    if (pigType) pigAt(cx, bottom, pigType);
  }

  function tower(cx, bottom, tiers, kind, pigs) {
    var th = 68;
    for (var i = 0; i < tiers; i++) {
      var b = bottom - i * th;
      beam(cx - 38, b, 15, th, kind);
      beam(cx + 38, b, 15, th, kind);
      beam(cx, b - th, 108, 13, kind, i === tiers - 1 ? "roof" : null);
      if (pigs && pigs[i]) pigAt(cx, b, pigs[i]);
    }
  }

  function gate(cx, bottom, span, legH, kind) {
    beam(cx - span / 2, bottom, 18, legH, kind);
    beam(cx + span / 2, bottom, 18, legH, kind);
    beam(cx, bottom - legH, span + 18, 16, kind, "roof");
  }

  function makeDebris(x, y, w, h, kind, vx, vy) {
    var m = MATERIALS[kind] || MATERIALS.wood;
    var d = Bodies.rectangle(x, y, w, h, {
      label: "debris",
      density: m.density, friction: 0.6, restitution: 0.1,
      collisionFilter: { category: CAT.debris, mask: CAT.ground | CAT.block | CAT.debris }
    });
    d.plugin = { kind: kind, life: 5200, w: w, h: h };
    Body.setVelocity(d, { x: vx || 0, y: vy || 0 });
    Body.setAngularVelocity(d, (rnd() - 0.5) * 0.5);
    debris.push(d); World.add(world, d);
    if (debris.length > 90) {
      var old = debris.shift(); World.remove(world, old);
    }
    return d;
  }

  function addParticles(x, y, n, opts) {
    for (var i = 0; i < n; i++) {
      var a = opts.angle !== undefined ? opts.angle + (Math.random() - 0.5) * (opts.spread || 1) : Math.random() * Math.PI * 2;
      var s = opts.speed * (0.4 + Math.random() * 0.9);
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 1, decay: opts.decay || 0.02,
        r: opts.r * (0.6 + Math.random() * 0.8),
        color: opts.colors[(Math.random() * opts.colors.length) | 0],
        type: opts.type || "dot",
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
        grav: opts.grav === undefined ? 0.2 : opts.grav,
        glow: !!opts.glow
      });
    }
  }

  function addDust(x, y, n) {
    addParticles(x, y, n, {
      colors: ["rgba(210,190,150,0.5)", "rgba(160,135,95,0.45)", "rgba(235,225,205,0.45)"],
      speed: 2.4, r: 5.5, decay: 0.045, grav: -0.02
    });
  }

  function addPopup(x, y, text, color) { popups.push({ x: x, y: y, text: text, color: color || "#ffe08a", life: 1 }); }
  function addRing(x, y, r, color, width, glow) { rings.push({ x: x, y: y, r: r, max: r, color: color, width: width || 4, life: 1, glow: !!glow }); }

  function burstFor(kind, x, y) {
    var m = MATERIALS[kind] || MATERIALS.wood;
    var cols = [m.fill, m.dark, m.light];
    if (kind === "ice" || kind === "glass") {
      addParticles(x, y, 16, { colors: cols, speed: 5, r: 4, decay: 0.03, type: "shard", grav: 0.28 });
      addRing(x, y, 26, "rgba(200,240,255,0.8)", 3);
    } else if (kind === "stone") {
      addParticles(x, y, 16, { colors: cols, speed: 4, r: 5, decay: 0.025, type: "rock", grav: 0.3 });
      addParticles(x, y, 8, { colors: ["rgba(180,180,180,0.5)"], speed: 2, r: 9, decay: 0.035, grav: -0.02 });
    } else if (kind === "metal") {
      addParticles(x, y, 10, { colors: cols, speed: 4, r: 4, decay: 0.03, type: "shard", grav: 0.28 });
    } else {
      addParticles(x, y, 14, { colors: cols, speed: 4.5, r: 5, decay: 0.025, type: "splinter", grav: 0.3 });
      addParticles(x, y, 6, { colors: ["rgba(210,180,140,0.45)"], speed: 2, r: 8, decay: 0.04, grav: -0.03 });
    }
  }

  function shatterBlock(block) {
    var kind = block.plugin.kind;
    var m = MATERIALS[kind];
    score += m.score;
    addPopup(block.position.x, block.position.y - 10, "+" + m.score, "#ffe08a");
    burstFor(kind, block.position.x, block.position.y);
    sfxBreak(kind);
    if (kind === "tnt") {
      explode(block.position.x, block.position.y, 165, 19);
    }
    World.remove(world, block);
    blocks = blocks.filter(function (b) { return b !== block; });
    if (m.brittle) {
      for (var i = 0; i < 4; i++) {
        makeDebris(block.position.x + (rnd() - 0.5) * 20, block.position.y + (rnd() - 0.5) * 20,
          8 + rnd() * 8, 6 + rnd() * 8, kind,
          (rnd() - 0.5) * 6, -rnd() * 5);
      }
    } else if (kind === "stone" || kind === "metal") {
      for (var j = 0; j < 2; j++) {
        makeDebris(block.position.x + (rnd() - 0.5) * 16, block.position.y + (rnd() - 0.5) * 16,
          10 + rnd() * 6, 8 + rnd() * 6, kind,
          (rnd() - 0.5) * 5, -rnd() * 4);
      }
    }
    updateHud();
  }

  function killPig(pig, cause) {
    if (!pig.plugin.alive) return;
    pig.plugin.alive = false;
    var t = PIG_TYPES[pig.plugin.type];
    score += t.score;
    addPopup(pig.position.x, pig.position.y - 14, "+" + t.score, "#b9f27a");
    addParticles(pig.position.x, pig.position.y, 18, { colors: [t.body, t.dark, t.snout], speed: 5.5, r: 5, decay: 0.028, type: "dot", grav: 0.26 });
    addParticles(pig.position.x, pig.position.y, 8, { colors: ["rgba(255,255,255,0.7)"], speed: 3, r: 6, decay: 0.04, grav: -0.05 });
    addRing(pig.position.x, pig.position.y, 30, "rgba(255,255,255,0.7)", 3);
    sfxPop();
    shake = Math.max(shake, 5);
    World.remove(world, pig);
    pigs = pigs.filter(function (p) { return p !== pig; });
    updateHud();
    if (pigs.length === 0 && !levelDone) {
      if (simMode) winLevel();
      else { var g = gen; setTimeout(function () { if (g === gen) winLevel(); }, 550); }
    }
  }

  function applyDamage(body, dmg, contact) {
    if (body.label === "block") {
      var wasHp = body.plugin.hp;
      body.plugin.hp -= dmg;
      if (dmg > 3 && performance.now() - (body.plugin.lastFx || 0) > 90) {
        body.plugin.lastFx = performance.now();
        addParticles(contact.x, contact.y, 4, { colors: [MATERIALS[body.plugin.kind].light, MATERIALS[body.plugin.kind].fill], speed: 2.6, r: 3, decay: 0.05, grav: 0.25 });
      }
      if (body.plugin.hp <= 0 && wasHp > 0) shatterBlock(body);
    } else if (body.label === "pig" && body.plugin.alive) {
      var reduce = 1 - body.plugin.armor;
      body.plugin.hp -= dmg * reduce;
      if (dmg > 5 && performance.now() - (body.plugin.lastFx || 0) > 120) {
        body.plugin.lastFx = performance.now();
        addParticles(contact.x, contact.y, 3, { colors: ["#fff", "#ffd"], speed: 2, r: 2.5, decay: 0.06, grav: 0.2 });
      }
      if (body.plugin.hp <= 0) killPig(body, "impact");
    }
  }

  function explode(x, y, radius, power) {
    sfxBoom();
    shake = Math.max(shake, 14);
    flash = Math.max(flash, 0.9);
    impact = { x: x, y: y, p: 1 };
    slowmo = Math.max(slowmo, 0.85);
    addRing(x, y, radius, "rgba(255,200,90,0.9)", 8, true);
    addRing(x, y, radius * 0.55, "rgba(255,255,255,0.9)", 6, true);
    addParticles(x, y, 34, { colors: ["#ffde7a", "#ff9d3b", "#f2542d", "#6b6b6b", "rgba(120,120,120,0.6)"], speed: 9, r: 9, decay: 0.022, grav: 0.05, glow: true });
    addParticles(x, y, 14, { colors: ["rgba(90,90,90,0.55)", "rgba(160,160,160,0.45)"], speed: 4, r: 16, decay: 0.02, grav: -0.06 });

    var all = blocks.concat(pigs);
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      var dx = b.position.x - x, dy = b.position.y - y;
      var d = Math.hypot(dx, dy);
      if (d > radius || d === 0) continue;
      var f = 1 - d / radius;
      var nx = dx / d, ny = dy / d;
      var vx = b.velocity.x + nx * power * f;
      var vy = b.velocity.y + ny * power * f - 3 * f;
      Body.setVelocity(b, { x: vx, y: vy });
      Body.setAngularVelocity(b, (rnd() - 0.5) * 0.5 * f);
      applyDamage(b, power * f * 1.5, { x: b.position.x, y: b.position.y });
    }
  }

  Events.on(engine, "collisionStart", function (evt) {
    for (var i = 0; i < evt.pairs.length; i++) {
      var pair = evt.pairs[i];
      var a = pair.bodyA, b = pair.bodyB;
      var rel = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
      if (rel < 2.2) continue;
      [a, b].forEach(function (bd) {
        if (bd.plugin && bd.plugin.isBird && BIRD_TYPES[bd.plugin.type].ability === "bomb" && !bd.plugin.bombed) {
          bombBird(bd);
        }
      });
      var contact = pair.collision && pair.collision.supports && pair.collision.supports[0]
        ? pair.collision.supports[0]
        : { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
      if (rel > 3.5 && (a.label === "ground" || b.label === "ground")) {
        addDust(contact.x, Math.min(contact.y, GROUND_Y - 2), Math.min(6, 1 + rel * 0.5));
      }
      var pairs = [[a, b], [b, a]];
      for (var k = 0; k < 2; k++) {
        var self = pairs[k][0], other = pairs[k][1];
        if (self.isStatic || self.label === "bird" || self.label === "debris") continue;
        var om = isFinite(other.mass) ? other.mass : 14;
        var factor = clamp(Math.sqrt(om / 4), 0.4, 2.6);
        if (other.plugin && other.plugin.isBird) factor = 2.2;
        var dmg = rel * factor;
        if (self.label === "pig") dmg *= 2.0;
        if (dmg < 1.2) continue;
        applyDamage(self, dmg, contact);
      }
      if (rel > 5) sfxThud(rel);
      if (rel > 4.5) {
        impact = { x: contact.x, y: contact.y, p: clamp((rel - 4) / 6, 0, 1) };
        if (rel > 8) slowmo = Math.max(slowmo, clamp((rel - 8) / 16, 0, 0.6));
      }
    }
  });

  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var p = e.touches && e.touches.length ? e.touches[0] : (e.changedTouches && e.changedTouches.length ? e.changedTouches[0] : e);
    return {
      x: (p.clientX - rect.left) * (W / rect.width),
      y: (p.clientY - rect.top) * (H / rect.height)
    };
  }

  function onDown(e) {
    unlock();
    if (levelDone) return;
    if (activeFlight) { triggerAbility(); return; }
    if (!bird) return;
    var p = pointerPos(e);
    if (Math.hypot(p.x - bird.position.x, p.y - bird.position.y) < 80 || Math.hypot(p.x - SLING_X, p.y - SLING_Y) < 120) {
      dragging = true; pulling = true;
    }
  }
  function onMove(e) {
    if (!dragging || !bird) return;
    var p = pointerPos(e);
    var dx = p.x - SLING_X, dy = p.y - SLING_Y;
    if (dx > 0) dx = 0;
    var len = Math.hypot(dx, dy);
    if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; }
    pullVec = { x: dx, y: dy };
    Body.setPosition(bird, { x: SLING_X + dx, y: SLING_Y + dy });
    Body.setAngle(bird, Math.atan2(-dy, -dx));
  }
  function onUp() {
    if (!dragging || !bird) return;
    dragging = false; pulling = false;
    var pull = Math.hypot(pullVec.x, pullVec.y);
    if (pull < 14) {
      Body.setPosition(bird, { x: SLING_X, y: SLING_Y });
      Body.setAngle(bird, 0);
      pullVec = { x: 0, y: 0 };
      return;
    }
    Body.setStatic(bird, false);
    Body.setVelocity(bird, { x: -pullVec.x * LAUNCH, y: -pullVec.y * LAUNCH });
    Body.setAngularVelocity(bird, -0.12);
    launched = true; abilityUsed = false; activeFlight = true; settleTimer = 0;
    sfxLaunch();
    updateHud();
  }

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); onDown(e); }, { passive: false });
  window.addEventListener("touchmove", function (e) { if (!dragging) return; e.preventDefault(); onMove(e); }, { passive: false });
  window.addEventListener("touchend", function (e) { if (!dragging) return; e.preventDefault(); onUp(e); }, { passive: false });
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space") { e.preventDefault(); if (activeFlight) triggerAbility(); }
    if (e.code === "KeyR") resetLevel();
  });

  function bombBird(b) {
    if (!b || !b.plugin || b.plugin.bombed) return;
    b.plugin.bombed = true;
    explode(b.position.x, b.position.y, 215, 27);
    World.remove(world, b);
    birds = birds.filter(function (x) { return x !== b; });
    if (bird === b) {
      bird = null;
      activeFlight = false;
      scheduleNextBird(750);
    }
  }

  function triggerAbility() {
    if (!bird || abilityUsed || !activeFlight) return;
    var t = BIRD_TYPES[bird.plugin.type];
    if (t.ability === "none") return;
    abilityUsed = true;
    if (t.ability === "dash") {
      var v = bird.velocity;
      var sp = Math.hypot(v.x, v.y);
      if (sp < 1) return;
      var boost = Math.max(sp * 1.9, 16);
      Body.setVelocity(bird, { x: v.x / sp * boost, y: v.y / sp * boost });
      addParticles(bird.position.x, bird.position.y, 14, { colors: ["#fff1b8", "#ffc93c", "#ffffff"], speed: 5, r: 5, decay: 0.05, grav: 0 });
      addRing(bird.position.x, bird.position.y, 24, "rgba(255,220,120,0.9)", 4);
      tone(700, 0.2, "triangle", 0.12, 1500);
    } else if (t.ability === "split") {
      var v2 = bird.velocity;
      var ang = Math.atan2(v2.y, v2.x);
      var spd = Math.hypot(v2.x, v2.y) || 12;
      var self = bird;
      birds.push(bird);
      [-0.24, 0.24, Math.PI].forEach(function (off) {
        var nb = makeBird(self.position.x, self.position.y, "blue");
        Body.setVelocity(nb, { x: Math.cos(ang + off) * spd, y: Math.sin(ang + off) * spd });
        World.add(world, nb);
        birds.push(nb);
      });
      addRing(bird.position.x, bird.position.y, 22, "rgba(160,220,255,0.9)", 3);
      tone(1000, 0.15, "triangle", 0.1, 1600);
    } else if (t.ability === "bomb") {
      bombBird(bird);
    }
  }

  function resetLevel() {
    gen++;
    blocks.forEach(function (b) { World.remove(world, b); });
    pigs.forEach(function (p) { World.remove(world, p); });
    debris.forEach(function (d) { World.remove(world, d); });
    birds.forEach(function (b) { World.remove(world, b); });
    if (bird) World.remove(world, bird);
    blocks = []; pigs = []; debris = []; birds = []; particles = []; popups = []; rings = [];
    bird = null; score = 0; levelDone = false; activeFlight = false; dragging = false; losePending = false;
    flash = 0; blinking = 0; slowmo = 0; impact = null;
    buildLevel(currentLevel);
  }

  function buildLevel(idx) {
    var lvl = LEVELS[idx];
    currentWorld = worldIndexOf(idx);
    rngState = 0x2545f491;
    score = 0;
    birdQueue = lvl.birds.slice();
    lvl.build();
    for (var w = 0; w < 150; w++) { Engine.update(engine, STEP); }
    spawnNextBird();
    updateHud();
    updateLevelBar();
    updateWorldTitle();
  }

  function spawnNextBird() {
    if (bird) { World.remove(world, bird); birds = birds.filter(function (b) { return b !== bird; }); bird = null; }
    if (birdQueue.length === 0) { bird = null; return; }
    var type = birdQueue.shift();
    bird = makeBird(SLING_X, SLING_Y, type);
    Body.setStatic(bird, true);
    World.add(world, bird);
    birds.push(bird);
    launched = false; abilityUsed = false; activeFlight = false;
    pullVec = { x: 0, y: 0 };
    updateHud();
  }

  function scheduleNextBird(delay) {
    if (simMode) { advanceNextBird(); return; }
    if (levelDone) return;
    var g = gen;
    setTimeout(function () { if (g === gen) advanceNextBird(); }, delay || 350);
  }

  function advanceNextBird() {
    if (levelDone) return;
    if (pigs.length === 0) { winLevel(); return; }
    if (birdQueue.length === 0) {
      levelDone = true;
      sfxLose();
      showOverlay("Out of Birds", "Score " + score, "Retry", false, 0);
    } else {
      spawnNextBird();
    }
  }

  function winLevel() {
    if (levelDone || pigs.length > 0) return;
    levelDone = true;
    var remaining = birdQueue.length + (activeFlight ? 0 : (bird ? 1 : 0));
    var bonus = remaining * 1000;
    score += bonus;
    var stars = 1 + (remaining >= 2 ? 1 : 0) + (remaining >= 3 ? 1 : 0);
    if (remaining >= 1 && remaining < 2) stars = 2;
    stars = clamp(stars, 1, 3);
    starsByLevel[currentLevel] = Math.max(starsByLevel[currentLevel] || 0, stars);
    saveProgress();
    updateHud();
    updateLevelBar();
    buildWorldMap();
    sfxWin();
    var isLast = currentLevel + 1 >= LEVELS.length;
    var endOfWorld = (currentLevel % LEVELS_PER_WORLD) === LEVELS_PER_WORLD - 1;
    var btn = isLast ? "Play Again" : (endOfWorld ? "Next World" : "Next Level");
    showOverlay("Level Clear!", "Score " + score + (bonus ? "  (+" + bonus + " bonus)" : ""), btn, true, stars);
  }

  function showOverlay(title, text, btn, isWin, stars) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = btn;
    overlayBtn.dataset.win = isWin ? "1" : "0";
    overlayStars.innerHTML = "";
    for (var i = 0; i < 3; i++) {
      var on = isWin && i < stars;
      var svg = starSvg(on);
      if (on) svg.style.animationDelay = (0.12 * i) + "s";
      overlayStars.appendChild(svg);
    }
    overlayStars.style.display = isWin ? "flex" : "none";
    overlay.classList.add("show");
  }
  function hideOverlay() { overlay.classList.remove("show"); }

  function starSvg(on) {
    var span = document.createElement("span");
    span.className = "star" + (on ? " on" : "");
    span.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M12 2.4l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.3 6.1 20.4l1.2-6.5L2.5 9.3l6.6-.9z" fill="' + (on ? "#ffd166" : "#4a5568") + '" stroke="' + (on ? "#c98a1a" : "#2d3748") + '" stroke-width="1"/></svg>';
    return span;
  }

  function persistKey() { return "angryblocks.progress.v1"; }
  function saveProgress() {
    try { localStorage.setItem(persistKey(), JSON.stringify({ stars: starsByLevel })); } catch (e) {}
  }
  function loadProgress() {
    try {
      var raw = localStorage.getItem(persistKey());
      if (!raw) return;
      var p = JSON.parse(raw);
      starsByLevel = p.stars || {};
    } catch (e) {}
  }

  var WORLDS = [
    {
      name: "Timber Yard",
      icon: "\uD83C\uDF33",
      style: "timber",
      a: "#ca8b4d", b: "#7a5230", desc: "Splinter the wooden scaffolds.",
      levels: [
        {
          name: "Timber Yard",
          birds: ["red", "red", "yellow", "red", "blue"],
          build: function () {
            var bx = 650;
            beam(bx, GROUND_Y, 22, 120, "wood");
            beam(bx + 130, GROUND_Y, 22, 120, "wood");
            beam(bx + 65, GROUND_Y - 120, 174, 20, "wood");
            beam(bx + 25, GROUND_Y - 140, 20, 80, "wood");
            beam(bx + 105, GROUND_Y - 140, 20, 80, "wood");
            beam(bx + 65, GROUND_Y - 220, 120, 20, "wood");
            pigAt(bx + 65, GROUND_Y, "small");
            pigAt(bx + 65, GROUND_Y - 140, "medium");
            pigAt(bx + 65, GROUND_Y - 240, "small");
            beam(bx + 205, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Sawmill",
          birds: ["red", "red", "yellow", "blue"],
          build: function () {
            var bx = 650;
            hut(bx - 80, GROUND_Y, "wood", "small");
            hut(bx + 80, GROUND_Y, "wood", "medium");
            beam(bx, GROUND_Y - 88, 230, 16, "wood");
            pigAt(bx, GROUND_Y - 104, "small");
          }
        },
        {
          name: "Log Tower",
          birds: ["red", "yellow", "red", "blue"],
          build: function () {
            var bx = 660;
            tower(bx, GROUND_Y, 3, "wood", ["small", "small", "medium"]);
            beam(bx + 160, GROUND_Y, 40, 44, "tnt");
            pigAt(bx + 160, GROUND_Y - 44, "small");
          }
        },
        {
          name: "Bridge Works",
          birds: ["red", "yellow", "red", "red"],
          build: function () {
            var bx = 640;
            gate(bx - 90, GROUND_Y, 120, 90, "wood");
            gate(bx + 90, GROUND_Y, 120, 90, "wood");
            beam(bx, GROUND_Y - 90, 300, 18, "wood");
            pigAt(bx - 90, GROUND_Y, "small");
            pigAt(bx + 90, GROUND_Y, "small");
            pigAt(bx, GROUND_Y - 108, "medium");
          }
        },
        {
          name: "Fort Timber",
          birds: ["red", "red", "yellow", "blue", "red"],
          build: function () {
            var bx = 660;
            beam(bx - 90, GROUND_Y, 20, 110, "wood");
            beam(bx + 90, GROUND_Y, 20, 110, "wood");
            beam(bx, GROUND_Y - 110, 210, 20, "wood");
            hut(bx, GROUND_Y, "wood", "small", 60);
            beam(bx, GROUND_Y - 130, 140, 18, "wood");
            pigAt(bx - 60, GROUND_Y - 148, "small");
            pigAt(bx + 60, GROUND_Y - 148, "small");
            beam(bx + 210, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Timber Keep",
          birds: ["red", "yellow", "red", "blue", "red"],
          build: function () {
            var bx = 650;
            tower(bx - 70, GROUND_Y, 2, "wood", ["small", "small"]);
            tower(bx + 70, GROUND_Y, 3, "wood", [null, "small", "medium"]);
            beam(bx, GROUND_Y - 204, 220, 20, "wood");
            pigAt(bx, GROUND_Y - 224, "big");
            beam(bx + 220, GROUND_Y, 44, 44, "tnt");
          }
        }
      ]
    },
    {
      name: "Ice Fortress",
      icon: "\u2744\uFE0F",
      style: "ice",
      a: "#a9e6ff", b: "#3f7fa6", desc: "Shatter the frozen walls.",
      levels: [
        {
          name: "Ice Fortress",
          birds: ["red", "yellow", "blue", "red", "black", "blue"],
          build: function () {
            var bx = 650;
            beam(bx, GROUND_Y, 22, 100, "wood");
            beam(bx + 150, GROUND_Y, 22, 100, "wood");
            beam(bx + 75, GROUND_Y - 100, 200, 20, "stone");
            beam(bx + 40, GROUND_Y - 120, 18, 70, "ice");
            beam(bx + 110, GROUND_Y - 120, 18, 70, "ice");
            beam(bx + 75, GROUND_Y - 190, 100, 16, "ice");
            beam(bx + 110, GROUND_Y, 40, 44, "tnt");
            pigAt(bx + 50, GROUND_Y, "medium");
            pigAt(bx + 75, GROUND_Y - 206, "small");
            pigAt(bx + 150, GROUND_Y - 120, "helmet");
          }
        },
        {
          name: "Frozen Hut",
          birds: ["red", "yellow", "blue", "black"],
          build: function () {
            var bx = 640;
            hut(bx - 80, GROUND_Y, "ice", "small");
            hut(bx + 80, GROUND_Y, "wood", "small");
            beam(bx, GROUND_Y - 88, 200, 16, "ice");
            pigAt(bx, GROUND_Y - 104, "medium");
            beam(bx + 190, GROUND_Y, 40, 44, "tnt");
          }
        },
        {
          name: "Slippery Slope",
          birds: ["blue", "red", "yellow", "blue"],
          build: function () {
            var bx = 650;
            beam(bx - 70, GROUND_Y, 18, 90, "ice");
            beam(bx + 70, GROUND_Y, 18, 90, "ice");
            beam(bx, GROUND_Y - 90, 170, 16, "stone");
            beam(bx - 30, GROUND_Y - 106, 16, 60, "glass");
            beam(bx + 30, GROUND_Y - 106, 16, 60, "glass");
            beam(bx, GROUND_Y - 166, 90, 14, "ice");
            pigAt(bx, GROUND_Y, "small");
            pigAt(bx, GROUND_Y - 106, "small");
            pigAt(bx, GROUND_Y - 180, "small");
          }
        },
        {
          name: "Glacier Gate",
          birds: ["blue", "red", "black", "yellow", "blue"],
          build: function () {
            var bx = 650;
            gate(bx - 95, GROUND_Y, 130, 100, "ice");
            gate(bx + 95, GROUND_Y, 130, 100, "ice");
            beam(bx, GROUND_Y - 100, 320, 18, "stone");
            pigAt(bx - 95, GROUND_Y, "small");
            pigAt(bx + 95, GROUND_Y, "medium");
            pigAt(bx, GROUND_Y - 118, "small");
            beam(bx - 230, GROUND_Y, 40, 44, "tnt");
          }
        },
        {
          name: "Ice Citadel",
          birds: ["black", "blue", "yellow", "blue", "red"],
          build: function () {
            var bx = 650;
            tower(bx - 70, GROUND_Y, 2, "ice", ["small", "small"]);
            tower(bx + 70, GROUND_Y, 2, "ice", [null, "medium"]);
            beam(bx, GROUND_Y - 136, 230, 18, "glass");
            beam(bx, GROUND_Y - 154, 18, 70, "stone");
            pigAt(bx, GROUND_Y - 224, "small");
            beam(bx + 200, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Deep Freeze",
          birds: ["blue", "black", "blue", "yellow", "blue", "red"],
          build: function () {
            var bx = 640;
            beam(bx - 120, GROUND_Y, 20, 120, "ice");
            beam(bx, GROUND_Y, 20, 120, "ice");
            beam(bx + 120, GROUND_Y, 20, 120, "ice");
            beam(bx, GROUND_Y - 120, 300, 20, "stone");
            hut(bx - 60, GROUND_Y, "glass", null, 60);
            hut(bx + 60, GROUND_Y, "glass", null, 60);
            pigAt(bx - 60, GROUND_Y, "medium");
            pigAt(bx + 60, GROUND_Y, "medium");
            pigAt(bx - 30, GROUND_Y - 140, "small");
            pigAt(bx + 30, GROUND_Y - 140, "small");
            beam(bx + 230, GROUND_Y, 44, 44, "tnt");
          }
        }
      ]
    },
    {
      name: "Stone Skyline",
      icon: "\uD83C\uDFD9\uFE0F",
      style: "stone",
      a: "#9aa3ad", b: "#5a636e", desc: "Topple the concrete towers.",
      levels: [
        {
          name: "Stone Skyline",
          birds: ["yellow", "black", "blue", "red", "red", "red"],
          build: function () {
            var bx = 680;
            beam(bx, GROUND_Y, 24, 110, "stone");
            beam(bx + 120, GROUND_Y, 24, 110, "stone");
            beam(bx + 240, GROUND_Y, 24, 110, "wood");
            beam(bx + 55, GROUND_Y - 110, 120, 20, "wood");
            beam(bx + 185, GROUND_Y - 110, 120, 20, "wood");
            beam(bx + 55, GROUND_Y - 130, 20, 80, "stone");
            beam(bx + 185, GROUND_Y - 130, 20, 80, "stone");
            beam(bx + 120, GROUND_Y - 210, 180, 20, "stone");
            beam(bx + 80, GROUND_Y - 130, 40, 44, "tnt");
            pigAt(bx + 20, GROUND_Y - 130, "medium");
            pigAt(bx + 220, GROUND_Y - 130, "medium");
            pigAt(bx + 120, GROUND_Y - 230, "small");
            pigAt(bx + 180, GROUND_Y, "medium");
          }
        },
        {
          name: "Brick Hut",
          birds: ["yellow", "black", "red", "blue"],
          build: function () {
            var bx = 650;
            hut(bx - 80, GROUND_Y, "stone", "small");
            hut(bx + 80, GROUND_Y, "stone", "medium");
            beam(bx, GROUND_Y - 88, 220, 18, "stone");
            pigAt(bx, GROUND_Y - 106, "small");
          }
        },
        {
          name: "Quarry",
          birds: ["black", "yellow", "blue", "red"],
          build: function () {
            var bx = 650;
            tower(bx, GROUND_Y, 2, "stone", ["small", "medium"]);
            beam(bx + 170, GROUND_Y, 60, 60, "stone");
            beam(bx + 170, GROUND_Y - 60, 44, 44, "tnt");
            pigAt(bx - 150, GROUND_Y, "small");
          }
        },
        {
          name: "Stone Gate",
          birds: ["yellow", "black", "red", "blue", "red"],
          build: function () {
            var bx = 650;
            gate(bx - 100, GROUND_Y, 140, 110, "stone");
            gate(bx + 100, GROUND_Y, 140, 110, "stone");
            beam(bx, GROUND_Y - 110, 340, 20, "wood");
            beam(bx, GROUND_Y - 130, 20, 80, "stone");
            pigAt(bx - 100, GROUND_Y, "small");
            pigAt(bx + 100, GROUND_Y, "small");
            pigAt(bx, GROUND_Y - 210, "medium");
          }
        },
        {
          name: "Monolith",
          birds: ["black", "yellow", "black", "blue", "red"],
          build: function () {
            var bx = 660;
            beam(bx, GROUND_Y, 40, 130, "stone");
            beam(bx - 90, GROUND_Y, 20, 90, "wood");
            beam(bx + 90, GROUND_Y, 20, 90, "wood");
            beam(bx, GROUND_Y - 130, 240, 20, "stone");
            pigAt(bx, GROUND_Y - 150, "small");
            pigAt(bx - 90, GROUND_Y, "small");
            pigAt(bx + 90, GROUND_Y, "small");
            beam(bx + 200, GROUND_Y, 40, 44, "tnt");
          }
        },
        {
          name: "Stone Crown",
          birds: ["black", "yellow", "black", "red", "blue", "yellow"],
          build: function () {
            var bx = 650;
            tower(bx - 80, GROUND_Y, 2, "stone", ["small", "small"]);
            tower(bx + 80, GROUND_Y, 3, "stone", [null, "small", "medium"]);
            beam(bx, GROUND_Y - 204, 260, 20, "stone");
            pigAt(bx - 40, GROUND_Y - 224, "small");
            pigAt(bx + 40, GROUND_Y - 224, "small");
            beam(bx + 240, GROUND_Y, 44, 44, "tnt");
            pigAt(bx, GROUND_Y, "helmet");
          }
        }
      ]
    },
    {
      name: "Bunker Hill",
      icon: "\uD83D\uDEE1\uFE0F",
      style: "bunker",
      a: "#8f97a4", b: "#3c434d", desc: "Crack the armored bunkers.",
      levels: [
        {
          name: "Bunker Hill",
          birds: ["black", "yellow", "black", "blue", "red"],
          build: function () {
            var bx = 660;
            beam(bx, GROUND_Y, 26, 120, "metal");
            beam(bx + 160, GROUND_Y, 26, 120, "metal");
            beam(bx + 80, GROUND_Y - 120, 200, 24, "stone");
            beam(bx + 30, GROUND_Y - 144, 22, 90, "wood");
            beam(bx + 130, GROUND_Y - 144, 22, 90, "wood");
            beam(bx + 80, GROUND_Y - 234, 140, 22, "stone");
            beam(bx + 40, GROUND_Y - 144, 40, 44, "tnt");
            pigAt(bx + 80, GROUND_Y - 144, "helmet");
            pigAt(bx + 80, GROUND_Y - 256, "medium");
            pigAt(bx + 160, GROUND_Y, "small");
            beam(bx + 240, GROUND_Y, 40, 120, "wood");
            beam(bx + 240, GROUND_Y - 120, 40, 44, "tnt");
          }
        },
        {
          name: "Steel Hut",
          birds: ["black", "yellow", "black", "red"],
          build: function () {
            var bx = 650;
            hut(bx - 80, GROUND_Y, "metal", "small");
            hut(bx + 80, GROUND_Y, "metal", "small");
            beam(bx, GROUND_Y - 88, 220, 18, "stone");
            pigAt(bx, GROUND_Y - 106, "medium");
          }
        },
        {
          name: "Armory",
          birds: ["black", "black", "yellow", "blue", "red"],
          build: function () {
            var bx = 650;
            beam(bx - 70, GROUND_Y, 24, 100, "metal");
            beam(bx + 70, GROUND_Y, 24, 100, "metal");
            beam(bx, GROUND_Y - 100, 190, 20, "stone");
            pigAt(bx, GROUND_Y, "helmet");
            pigAt(bx, GROUND_Y - 120, "small");
            beam(bx + 180, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Blast Wall",
          birds: ["black", "yellow", "black", "blue", "red"],
          build: function () {
            var bx = 650;
            gate(bx - 100, GROUND_Y, 140, 100, "metal");
            gate(bx + 100, GROUND_Y, 140, 100, "metal");
            beam(bx, GROUND_Y - 100, 340, 20, "stone");
            pigAt(bx - 100, GROUND_Y, "small");
            pigAt(bx + 100, GROUND_Y, "small");
            beam(bx, GROUND_Y - 120, 44, 44, "tnt");
          }
        },
        {
          name: "Fortress",
          birds: ["black", "black", "yellow", "blue", "red", "black"],
          build: function () {
            var bx = 650;
            beam(bx - 110, GROUND_Y, 22, 120, "metal");
            beam(bx + 110, GROUND_Y, 22, 120, "metal");
            beam(bx, GROUND_Y - 120, 250, 20, "stone");
            hut(bx, GROUND_Y, "metal", "helmet", 70);
            beam(bx, GROUND_Y - 140, 160, 18, "stone");
            pigAt(bx - 50, GROUND_Y - 158, "small");
            pigAt(bx + 50, GROUND_Y - 158, "small");
            beam(bx + 230, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Iron Citadel",
          birds: ["black", "black", "yellow", "blue", "black", "red"],
          build: function () {
            var bx = 650;
            tower(bx - 90, GROUND_Y, 2, "metal", ["small", "small"]);
            tower(bx + 90, GROUND_Y, 3, "metal", [null, "medium", "small"]);
            beam(bx, GROUND_Y - 204, 300, 22, "stone");
            pigAt(bx - 50, GROUND_Y - 226, "small");
            pigAt(bx + 50, GROUND_Y - 226, "small");
            pigAt(bx, GROUND_Y, "big");
            beam(bx + 260, GROUND_Y, 44, 44, "tnt");
          }
        }
      ]
    },
    {
      name: "Glass Garden",
      icon: "\uD83D\uDC8E",
      style: "glass",
      a: "#c7ecd9", b: "#5aa98a", desc: "Breeze through brittle glass.",
      levels: [
        {
          name: "Glass Garden",
          birds: ["blue", "blue", "yellow", "blue", "black"],
          build: function () {
            var bx = 640;
            beam(bx, GROUND_Y, 18, 100, "ice");
            beam(bx + 120, GROUND_Y, 18, 100, "ice");
            beam(bx + 60, GROUND_Y - 100, 160, 16, "glass");
            beam(bx + 30, GROUND_Y - 116, 16, 80, "glass");
            beam(bx + 90, GROUND_Y - 116, 16, 80, "glass");
            beam(bx + 60, GROUND_Y - 196, 120, 16, "ice");
            pigAt(bx + 60, GROUND_Y, "small");
            pigAt(bx + 60, GROUND_Y - 116, "small");
            pigAt(bx + 30, GROUND_Y, "medium");
            beam(bx + 180, GROUND_Y, 18, 90, "glass");
            beam(bx + 260, GROUND_Y, 18, 90, "glass");
            beam(bx + 220, GROUND_Y - 90, 120, 16, "glass");
            pigAt(bx + 220, GROUND_Y, "medium");
            pigAt(bx + 220, GROUND_Y - 106, "small");
          }
        },
        {
          name: "Glass Hut",
          birds: ["blue", "yellow", "blue", "black"],
          build: function () {
            var bx = 650;
            hut(bx - 80, GROUND_Y, "glass", "small");
            hut(bx + 80, GROUND_Y, "glass", "small");
            beam(bx, GROUND_Y - 88, 220, 16, "glass");
            pigAt(bx, GROUND_Y - 104, "medium");
          }
        },
        {
          name: "Crystal Spikes",
          birds: ["blue", "blue", "yellow", "black"],
          build: function () {
            var bx = 650;
            beam(bx - 90, GROUND_Y, 16, 100, "ice");
            beam(bx, GROUND_Y, 16, 130, "glass");
            beam(bx + 90, GROUND_Y, 16, 100, "ice");
            beam(bx, GROUND_Y - 130, 230, 16, "glass");
            pigAt(bx - 90, GROUND_Y, "small");
            pigAt(bx + 90, GROUND_Y, "small");
            pigAt(bx, GROUND_Y - 146, "small");
          }
        },
        {
          name: "Mirror Gate",
          birds: ["blue", "yellow", "blue", "blue", "black"],
          build: function () {
            var bx = 650;
            gate(bx - 100, GROUND_Y, 140, 100, "glass");
            gate(bx + 100, GROUND_Y, 140, 100, "glass");
            beam(bx, GROUND_Y - 100, 340, 16, "ice");
            pigAt(bx - 100, GROUND_Y, "small");
            pigAt(bx + 100, GROUND_Y, "small");
            pigAt(bx, GROUND_Y - 116, "medium");
          }
        },
        {
          name: "Prism Tower",
          birds: ["blue", "blue", "yellow", "blue", "black"],
          build: function () {
            var bx = 650;
            tower(bx, GROUND_Y, 3, "glass", ["small", "small", "medium"]);
            pigAt(bx - 150, GROUND_Y, "small");
            pigAt(bx + 150, GROUND_Y, "small");
            beam(bx + 240, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Shatter Palace",
          birds: ["blue", "blue", "yellow", "black", "blue", "black"],
          build: function () {
            var bx = 640;
            beam(bx - 120, GROUND_Y, 18, 110, "ice");
            beam(bx, GROUND_Y, 18, 110, "ice");
            beam(bx + 120, GROUND_Y, 18, 110, "ice");
            beam(bx, GROUND_Y - 110, 310, 18, "glass");
            hut(bx - 70, GROUND_Y, "glass", "medium", 60);
            hut(bx + 70, GROUND_Y, "glass", "medium", 60);
            pigAt(bx - 40, GROUND_Y - 128, "small");
            pigAt(bx + 40, GROUND_Y - 128, "small");
            beam(bx + 230, GROUND_Y, 44, 44, "tnt");
          }
        }
      ]
    },
    {
      name: "The Citadel",
      icon: "\uD83D\uDC51",
      style: "citadel",
      a: "#b58cff", b: "#5b3a9e", desc: "The final stronghold. Everything goes.",
      levels: [
        {
          name: "The Citadel",
          birds: ["red", "yellow", "black", "blue", "black", "yellow"],
          build: function () {
            var bx = 660;
            beam(bx, GROUND_Y, 24, 120, "stone");
            beam(bx + 150, GROUND_Y, 24, 120, "stone");
            beam(bx + 300, GROUND_Y, 24, 120, "stone");
            beam(bx + 75, GROUND_Y - 120, 150, 20, "wood");
            beam(bx + 225, GROUND_Y - 120, 150, 20, "wood");
            beam(bx + 45, GROUND_Y - 140, 22, 80, "stone");
            beam(bx + 150, GROUND_Y - 140, 22, 80, "stone");
            beam(bx + 255, GROUND_Y - 140, 22, 80, "stone");
            beam(bx + 150, GROUND_Y - 220, 270, 20, "stone");
            pigAt(bx + 75, GROUND_Y, "helmet");
            pigAt(bx + 225, GROUND_Y, "big");
            pigAt(bx + 95, GROUND_Y - 140, "medium");
            pigAt(bx + 205, GROUND_Y - 140, "medium");
            pigAt(bx + 90, GROUND_Y - 240, "small");
            pigAt(bx + 200, GROUND_Y - 240, "small");
            beam(bx + 380, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Outer Wall",
          birds: ["black", "yellow", "black", "blue", "red"],
          build: function () {
            var bx = 650;
            gate(bx - 110, GROUND_Y, 150, 110, "stone");
            gate(bx + 110, GROUND_Y, 150, 110, "stone");
            beam(bx, GROUND_Y - 110, 380, 22, "metal");
            pigAt(bx - 110, GROUND_Y, "helmet");
            pigAt(bx + 110, GROUND_Y, "helmet");
            pigAt(bx, GROUND_Y - 132, "medium");
            beam(bx - 250, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "War Machine",
          birds: ["black", "black", "yellow", "blue", "red", "black"],
          build: function () {
            var bx = 650;
            beam(bx - 120, GROUND_Y, 24, 130, "metal");
            beam(bx + 120, GROUND_Y, 24, 130, "metal");
            beam(bx, GROUND_Y - 130, 270, 22, "stone");
            hut(bx, GROUND_Y, "stone", "helmet", 60);
            beam(bx, GROUND_Y - 152, 180, 18, "metal");
            pigAt(bx - 55, GROUND_Y - 170, "small");
            pigAt(bx + 55, GROUND_Y - 170, "small");
            beam(bx + 240, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Death Gate",
          birds: ["black", "yellow", "black", "blue", "black", "red"],
          build: function () {
            var bx = 650;
            gate(bx - 120, GROUND_Y, 160, 120, "metal");
            gate(bx + 120, GROUND_Y, 160, 120, "metal");
            beam(bx, GROUND_Y - 120, 400, 22, "stone");
            beam(bx, GROUND_Y - 142, 22, 90, "stone");
            pigAt(bx - 120, GROUND_Y, "medium");
            pigAt(bx + 120, GROUND_Y, "medium");
            pigAt(bx, GROUND_Y - 232, "small");
            beam(bx + 180, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Stronghold",
          birds: ["black", "black", "yellow", "blue", "black", "red"],
          build: function () {
            var bx = 650;
            tower(bx - 95, GROUND_Y, 3, "metal", ["medium", "small", null]);
            tower(bx + 95, GROUND_Y, 3, "stone", [null, "medium", null]);
            beam(bx, GROUND_Y - 204, 320, 22, "stone");
            pigAt(bx - 50, GROUND_Y - 226, "small");
            pigAt(bx + 50, GROUND_Y - 226, "small");
            pigAt(bx, GROUND_Y, "big");
            beam(bx + 270, GROUND_Y, 44, 44, "tnt");
          }
        },
        {
          name: "Final Citadel",
          birds: ["black", "yellow", "black", "blue", "black", "yellow", "red"],
          build: function () {
            var bx = 650;
            beam(bx - 150, GROUND_Y, 26, 130, "metal");
            beam(bx - 50, GROUND_Y, 26, 130, "metal");
            beam(bx + 50, GROUND_Y, 26, 130, "metal");
            beam(bx + 150, GROUND_Y, 26, 130, "metal");
            beam(bx, GROUND_Y - 130, 360, 24, "stone");
            hut(bx - 100, GROUND_Y, "stone", "helmet", 60);
            hut(bx + 100, GROUND_Y, "stone", "helmet", 60);
            beam(bx, GROUND_Y - 154, 220, 20, "metal");
            pigAt(bx - 60, GROUND_Y - 174, "medium");
            pigAt(bx + 60, GROUND_Y - 174, "medium");
            pigAt(bx, GROUND_Y - 174, "small");
            beam(bx + 200, GROUND_Y, 44, 44, "tnt");
          }
        }
      ]
    }
  ];

  var LEVELS = [];
  WORLDS.forEach(function (w, wi) {
    w.levels.forEach(function (lvl, li) {
      lvl.world = wi;
      lvl.slot = li;
      lvl.index = LEVELS.length;
      LEVELS.push(lvl);
    });
  });

  function worldIndexOf(gi) { return Math.floor(gi / LEVELS_PER_WORLD); }
  function worldStars(wi) {
    var s = 0;
    for (var i = 0; i < LEVELS_PER_WORLD; i++) s += starsByLevel[wi * LEVELS_PER_WORLD + i] || 0;
    return s;
  }
  function worldCleared(wi) {
    for (var i = 0; i < LEVELS_PER_WORLD; i++) {
      if (!(starsByLevel[wi * LEVELS_PER_WORLD + i] >= 1)) return false;
    }
    return true;
  }
  function isWorldUnlocked(wi) { return true; }
  function isLevelUnlocked(gi) { return true; }
  function highestUnlockedInWorld(wi) {
    var base = wi * LEVELS_PER_WORLD, best = base;
    for (var i = 0; i < LEVELS_PER_WORLD; i++) if (isLevelUnlocked(base + i)) best = base + i;
    return best;
  }

  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var overlayBtn = document.getElementById("overlay-btn");
  var overlayRetry = document.getElementById("overlay-retry");
  var overlayStars = document.getElementById("overlay-stars");
  var scoreEl = document.getElementById("score");
  var birdsCountEl = document.getElementById("birds-count");
  var starsEl = document.getElementById("stars");
  var levelbarEl = document.getElementById("levelbar");
  var soundBtn = document.getElementById("sound");
  var worldTitleEl = document.getElementById("world-title");
  var worldsBtn = document.getElementById("worlds");
  var worldMapEl = document.getElementById("worldmap");
  var worldGridEl = document.getElementById("world-grid");

  function updateWorldTitle() {
    var w = WORLDS[currentWorld];
    if (!w) return;
    worldTitleEl.textContent = "World " + (currentWorld + 1) + " \u2014 " + w.name;
  }

  function goToLevel(gi) {
    if (gi < 0 || gi >= LEVELS.length || !isLevelUnlocked(gi)) return;
    hideOverlay();
    currentLevel = gi;
    currentWorld = worldIndexOf(gi);
    resetLevel();
  }

  function enterWorld(wi) {
    if (!isWorldUnlocked(wi)) return;
    hideWorldMap();
    goToLevel(highestUnlockedInWorld(wi));
  }

  function showWorldMap() {
    hideOverlay();
    buildWorldMap();
    worldMapEl.classList.add("show");
  }
  function hideWorldMap() { worldMapEl.classList.remove("show"); }

  function buildWorldMap() {
    worldGridEl.innerHTML = "";
    WORLDS.forEach(function (w, wi) {
      var open = isWorldUnlocked(wi);
      var card = document.createElement("button");
      card.className = "world-card" + (open ? "" : " locked") + (wi === currentWorld ? " current" : "");
      card.style.setProperty("--wa", w.a);
      card.style.setProperty("--wb", w.b);
      var got = worldStars(wi), max = LEVELS_PER_WORLD * 3;
      card.innerHTML =
        '<div class="world-icon">' + (open ? w.icon : "\uD83D\uDD12") + "</div>" +
        '<div class="world-meta">' +
          '<div class="world-name">' + w.name + "</div>" +
          '<div class="world-desc">' + (open ? w.desc : "Clear the previous world to unlock") + "</div>" +
          '<div class="world-stars">\u2605 ' + got + " / " + max + "</div>" +
        "</div>";
      card.addEventListener("click", function () { if (open) enterWorld(wi); });
      worldGridEl.appendChild(card);
    });
  }

  function updateHud() {
    scoreEl.textContent = "Score " + score;
    var remaining = birdQueue.length + (bird && !launched ? 1 : 0);
    birdsCountEl.textContent = remaining;
    starsEl.innerHTML = "";
    var s = starsByLevel[currentLevel] || 0;
    for (var i = 0; i < 3; i++) starsEl.appendChild(starSvg(i < s));
  }

  function updateLevelBar() {
    levelbarEl.innerHTML = "";
    var base = currentWorld * LEVELS_PER_WORLD;
    for (var slot = 0; slot < LEVELS_PER_WORLD; slot++) {
      var gi = base + slot;
      var locked = !isLevelUnlocked(gi);
      var btn = document.createElement("button");
      btn.className = "level-btn" + (gi === currentLevel ? " active" : "") + (locked ? " locked" : "");
      var s = starsByLevel[gi] || 0;
      var starTxt = s ? "\u2605".repeat(s) : "\u2606\u2606\u2606";
      btn.innerHTML = (locked ? '<span class="lk">\uD83D\uDD12 </span>' : "") + "Level " + (slot + 1) + " <span class='lk'>" + starTxt + "</span>";
      (function (target) {
        btn.addEventListener("click", function () { goToLevel(target); });
      })(gi);
      levelbarEl.appendChild(btn);
    }
  }

  overlayBtn.addEventListener("click", function () {
    hideOverlay();
    if (overlayBtn.dataset.win === "1" && currentLevel + 1 < LEVELS.length && isLevelUnlocked(currentLevel + 1)) {
      goToLevel(currentLevel + 1);
    } else {
      resetLevel();
    }
  });
  overlayRetry.addEventListener("click", function () { hideOverlay(); resetLevel(); });
  worldsBtn.addEventListener("click", function () { showWorldMap(); });
  document.getElementById("reset").addEventListener("click", function () { hideOverlay(); resetLevel(); });
  soundBtn.addEventListener("click", function () {
    muted = !muted;
    soundBtn.classList.toggle("muted", muted);
    soundBtn.textContent = muted ? "\u266A\u0338" : "\u266A";
    if (!muted) unlock();
  });

  var fullscreenBtn = document.getElementById("fullscreen");
  /** @type {any} */ var fsDoc = document;
  /** @type {any} */ var fsRoot = document.documentElement;
  /** @type {any} */ var fsScreen = screen;

  function nativeFullscreenElement() {
    return fsDoc.fullscreenElement || fsDoc.webkitFullscreenElement || null;
  }
  function requestNativeFullscreen() {
    var fn = fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen || fsRoot.webkitRequestFullScreen;
    if (!fn) return Promise.reject(new Error("fullscreen unsupported"));
    try { return Promise.resolve(fn.call(fsRoot)); }
    catch (err) { return Promise.reject(err); }
  }
  function exitNativeFullscreen() {
    var fn = fsDoc.exitFullscreen || fsDoc.webkitExitFullscreen || fsDoc.webkitCancelFullScreen;
    if (!fn) return Promise.resolve();
    try { return Promise.resolve(fn.call(fsDoc)); }
    catch (err) { return Promise.reject(err); }
  }
  function lockLandscape() {
    if (fsScreen.orientation && fsScreen.orientation.lock) {
      try { var p = fsScreen.orientation.lock("landscape"); if (p && p.catch) p.catch(function () {}); } catch (err) {}
    }
  }

  function setImmersive(on) {
    document.body.classList.toggle("immersive", on);
    fullscreenBtn.textContent = on ? "\u2715" : "\u26F6";
    fullscreenBtn.title = on ? "Exit fullscreen" : "Fullscreen";
  }

  function isStandalone() {
    if (/** @type {any} */ (window.navigator).standalone === true) return true;
    return !!(window.matchMedia && window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches);
  }
  function isIOS() {
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (ua.indexOf("Macintosh") !== -1 && "ontouchend" in document);
  }

  var toastEl = null, toastTimer = 0;
  function showToast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, ms || 6000);
  }

  fullscreenBtn.addEventListener("click", function () {
    var on = !document.body.classList.contains("immersive");
    setImmersive(on);
    if (on) {
      requestNativeFullscreen()
        .then(lockLandscape)
        .catch(function () {
          if (isIOS() && !isStandalone()) {
            showToast("For a true full screen: tap Share \u25B8 Add to Home Screen, then open Angry Blocks from your home screen.");
          }
        });
    } else {
      exitNativeFullscreen().catch(function () {});
    }
  });

  function onFullscreenChange() {
    if (!nativeFullscreenElement() && document.body.classList.contains("immersive")) {
      setImmersive(false);
    }
  }
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  function updateParticles(dt) {
    var f = dt / STEP;
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * f; p.y += p.vy * f;
      p.vy += p.grav * f;
      p.vx *= 0.995;
      p.rot += p.vr * f;
      p.life -= p.decay * f;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var r = rings.length - 1; r >= 0; r--) {
      var rg = rings[r];
      rg.r += (rg.max * 0.06) * f;
      rg.life -= 0.05 * f;
      if (rg.life <= 0) rings.splice(r, 1);
    }
    for (var u = popups.length - 1; u >= 0; u--) {
      var pp = popups[u];
      pp.y -= 0.9 * f;
      pp.life -= 0.018 * f;
      if (pp.life <= 0) popups.splice(u, 1);
    }
  }

  function updateDebris(dt) {
    for (var i = debris.length - 1; i >= 0; i--) {
      var d = debris[i];
      d.plugin.life -= dt;
      if (d.plugin.life <= 0 || d.position.y > H + 200 || d.position.x < -200 || d.position.x > W + 200) {
        World.remove(world, d);
        debris.splice(i, 1);
      }
    }
  }

  function settleWorld(maxSteps) {
    for (var i = 0; i < maxSteps; i++) {
      Engine.update(engine, STEP);
      updateParticles(STEP);
      updateDebris(STEP);
      var moving = false;
      for (var b = 0; b < blocks.length; b++) if (Math.hypot(blocks[b].velocity.x, blocks[b].velocity.y) > 0.4) { moving = true; break; }
      if (!moving) for (var p = 0; p < pigs.length; p++) if (Math.hypot(pigs[p].velocity.x, pigs[p].velocity.y) > 0.4) { moving = true; break; }
      if (!moving) return;
    }
  }

  function updateFlight(dt) {
    if (!activeFlight) return;
    for (var i = birds.length - 1; i >= 0; i--) {
      var b = birds[i];
      if (b.position.x > W + 80 || b.position.y > H + 80 || b.position.x < -80 || b.position.y < -200) {
        World.remove(world, b);
        birds.splice(i, 1);
      }
    }

    if (birds.length === 0) {
      activeFlight = false;
      scheduleNextBird(500);
      return;
    }

    var anyFast = false;
    for (var j = 0; j < birds.length; j++) {
      if (Math.hypot(birds[j].velocity.x, birds[j].velocity.y) > 0.6) anyFast = true;
    }

    if (!anyFast) {
      settleTimer += dt;
      var worldMoving = blocks.concat(pigs).some(function (b) { return Vector.magnitude(b.velocity) > 0.55; });
      var worldSettledTimer = worldMoving ? 0 : (updateFlight._ws = (updateFlight._ws || 0) + dt);
      if (worldSettledTimer > 700 || settleTimer > 3200) {
        activeFlight = false;
        updateFlight._ws = 0;
        scheduleNextBird(250);
      }
    } else {
      settleTimer = 0;
      updateFlight._ws = 0;
    }
  }

  var last = performance.now();
  var acc = 0;
  function loop(now) {
    var real = Math.min(60, now - last);
    last = now;
    if (slowmo > 0.01) slowmo *= 0.94; else slowmo = 0;
    var frame = real * (1 - slowmo * 0.72);
    time += frame;

    acc += frame;
    var guard = 0;
    while (acc >= STEP && guard < 5) {
      Engine.update(engine, STEP);
      acc -= STEP;
      guard++;
    }
    if (guard >= 5) acc = 0;

    updateParticles(frame);
    updateDebris(frame);
    updateFlight(frame);

    trailTick += real;
    if (trailTick > 42) {
      trailTick = 0;
      for (var tr = 0; tr < birds.length; tr++) {
        var tb = birds[tr];
        var tsp = Math.hypot(tb.velocity.x, tb.velocity.y);
        if (tsp > 3) {
          addParticles(tb.position.x - tb.velocity.x * 0.6, tb.position.y - tb.velocity.y * 0.6, 1,
            { colors: ["rgba(255,255,255,0.42)", "rgba(255,235,190,0.32)"], speed: 0.4, r: 4, decay: 0.06, grav: -0.02, type: "smoke" });
        }
      }
    }

    if (shake > 0.1) shake *= 0.88; else shake = 0;

    blinkTimer -= frame;
    if (blinkTimer <= 0 && blinking <= 0) { blinking = 1; blinkTimer = 2200 + Math.random() * 2600; }
    if (blinking > 0) blinking -= frame / 110; else blinking = 0;

    for (var i = 0; i < clouds.length; i++) {
      clouds[i].x += clouds[i].v * (frame / STEP);
      if (clouds[i].x > W + 80) clouds[i].x = -80;
    }
    for (var b = 0; b < bgBirds.length; b++) {
      bgBirds[b].x += bgBirds[b].v * (frame / STEP);
      if (bgBirds[b].x > W + 40) { bgBirds[b].x = -40; bgBirds[b].y = 70 + Math.random() * 100; }
    }

    setState3D({
      blocks: blocks, pigs: pigs, birds: birds, bird: bird, debris: debris,
      particles: particles, popups: popups, rings: rings, clouds: clouds,
      birdQueue: birdQueue, dragging: dragging, pullVec: pullVec,
      slingX: SLING_X, slingY: SLING_Y, maxPull: MAX_PULL, launch: LAUNCH,
      groundY: GROUND_Y, gravityStep: engine.gravity.y * engine.gravity.scale * STEP * STEP,
      activeFlight: activeFlight, launched: launched, time: time, shake: shake, flash: flash,
      blinking: blinking, slowmo: slowmo, impact: impact,
      world: currentWorld, style: (WORLDS[currentWorld] && WORLDS[currentWorld].style) || "timber"
    });
    render3D();
    impact = null;
    if (flash > 0.01) flash *= 0.8; else flash = 0;
    requestAnimationFrame(loop);
  }

  init3D(canvas);

  loadProgress();
  buildLevel(currentLevel);
  showWorldMap();
  requestAnimationFrame(loop);

  window.__AB = {
    state: function () {
      return {
        level: currentLevel, score: score, pigsLeft: pigs.length, blocksLeft: blocks.length,
        birdsInQueue: birdQueue.length, birdOnSling: bird ? bird.plugin.type : null,
        activeFlight: activeFlight, levelDone: levelDone,
        birdVel: bird ? { x: +bird.velocity.x.toFixed(3), y: +bird.velocity.y.toFixed(3) } : null,
        birdPos: bird ? { x: +bird.position.x.toFixed(1), y: +bird.position.y.toFixed(1) } : null,
        flying: birds.map(function (b) { return { x: +b.position.x.toFixed(0), y: +b.position.y.toFixed(0) }; }),
        pigPositions: pigs.map(function (p) { return { x: Math.round(p.position.x), y: Math.round(p.position.y), hp: Math.round(p.plugin.hp), type: p.plugin.type }; })
      };
    },
    level: function (i) { hideOverlay(); hideWorldMap(); currentLevel = clamp(i, 0, LEVELS.length - 1); currentWorld = worldIndexOf(currentLevel); resetLevel(); },
    worlds: function () { return WORLDS.map(function (w, wi) { return { name: w.name, unlocked: isWorldUnlocked(wi), stars: worldStars(wi), levels: w.levels.length }; }); },
    launch: function (angleDeg, pull, abilityDelayMs) {
      if (!bird || activeFlight) return false;
      var dx = -Math.cos(angleDeg * Math.PI / 180) * pull;
      var dy = Math.sin(angleDeg * Math.PI / 180) * pull;
      if (dx > 0) dx = 0;
      var len = Math.hypot(dx, dy);
      if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; }
      pullVec = { x: dx, y: dy };
      Body.setPosition(bird, { x: SLING_X + dx, y: SLING_Y + dy });
      Body.setStatic(bird, false);
      Body.setVelocity(bird, { x: -dx * LAUNCH, y: -dy * LAUNCH });
      launched = true; abilityUsed = false; activeFlight = true; settleTimer = 0;
      updateHud();
      if (abilityDelayMs !== undefined) {
        var g = gen;
        setTimeout(function () { if (g === gen) triggerAbility(); }, abilityDelayMs);
      }
      return true;
    },
    sim: function (level, seq) {
      simMode = true;
      currentLevel = level;
      resetLevel();
      var initialPigs = pigs.length;
      var log = [];
      for (var i = 0; i < seq.length; i++) {
        var s = seq[i];
        if (levelDone || activeFlight || !bird) { log.push({ blocked: true }); continue; }
        var ang = s.angle * Math.PI / 180;
        var dx = -Math.cos(ang) * s.pull;
        var dy = Math.sin(ang) * s.pull;
        var len = Math.hypot(dx, dy);
        if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; }
        pullVec = { x: dx, y: dy };
        Body.setPosition(bird, { x: SLING_X + dx, y: SLING_Y + dy });
        Body.setStatic(bird, false);
        Body.setVelocity(bird, { x: -dx * LAUNCH, y: -dy * LAUNCH });
        launched = true; abilityUsed = false; activeFlight = true; settleTimer = 0;
        var abilityAt = s.delay === undefined ? -1 : Math.round(s.delay / STEP);
        var steps = 0, lastAbility = -999;
        while (steps < 1200 && !levelDone) {
          Engine.update(engine, STEP);
          time += STEP;
          updateParticles(STEP);
          updateDebris(STEP);
          updateFlight(STEP);
          if (abilityAt >= 0 && steps === abilityAt) triggerAbility();
          if (!activeFlight && !levelDone) break;
          steps++;
        }
        log.push({ pigs: pigs.length, score: score, done: levelDone, steps: steps });
        if (levelDone || pigs.length === 0) break;
        settleWorld(180);
      }
      simMode = false;
      return { level: level, initialPigs: initialPigs, finalScore: score, pigsLeft: pigs.length, levelDone: levelDone, log: log };
    }
  };
})();
