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

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  var bgLayer = document.createElement("canvas");
  bgLayer.width = W * DPR;
  bgLayer.height = H * DPR;
  var bgCtx = bgLayer.getContext("2d");
  bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

  var fxLayer = document.createElement("canvas");
  fxLayer.width = W * DPR;
  fxLayer.height = H * DPR;
  var fxCtx = fxLayer.getContext("2d");
  fxCtx.setTransform(DPR, 0, 0, DPR, 0, 0);

  function makeGrain(size) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    for (var i = 0; i < size * size * 0.14; i++) {
      var x = Math.random() * size, y = Math.random() * size, r = 0.5 + Math.random() * 1.1;
      g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.13)" : "rgba(255,255,255,0.11)";
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    return g.createPattern(c, "repeat");
  }
  var grainPattern = makeGrain(96);

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
  var birdQueue = [];
  var currentLevel = 0;
  var unlocked = 1;
  var starsByLevel = {};
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

  function beam(cx, bottom, w, h, kind) {
    return makeBlock(cx, bottom - h / 2, w, h, kind);
  }
  function pigAt(cx, bottom, type) {
    var r = (PIG_TYPES[type] || PIG_TYPES.small).r;
    return makePig(cx, bottom - r, type);
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
  canvas.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); onDown(e); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); onMove(e); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); onUp(e); }, { passive: false });
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
    flash = 0; blinking = 0;
    buildLevel(currentLevel);
  }

  function buildLevel(idx) {
    var lvl = LEVELS[idx];
    rngState = 0x2545f491;
    score = 0;
    birdQueue = lvl.birds.slice();
    lvl.build();
    for (var w = 0; w < 150; w++) { Engine.update(engine, STEP); }
    spawnNextBird();
    updateHud();
    updateLevelBar();
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
    if (currentLevel + 1 >= unlocked) unlocked = Math.min(LEVELS.length, currentLevel + 2);
    saveProgress();
    updateHud();
    updateLevelBar();
    sfxWin();
    showOverlay("Level Clear!", "Score " + score + (bonus ? "  (+" + bonus + " bonus)" : ""), currentLevel + 1 < LEVELS.length ? "Next Level" : "Play Again", true, stars);
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
    try { localStorage.setItem(persistKey(), JSON.stringify({ unlocked: unlocked, stars: starsByLevel })); } catch (e) {}
  }
  function loadProgress() {
    try {
      var raw = localStorage.getItem(persistKey());
      if (!raw) return;
      var p = JSON.parse(raw);
      unlocked = clamp(p.unlocked || 1, 1, LEVELS.length);
      starsByLevel = p.stars || {};
    } catch (e) {}
  }

  var LEVELS = [
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
    }
  ];

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
    LEVELS.forEach(function (lvl, i) {
      var btn = document.createElement("button");
      btn.className = "level-btn" + (i === currentLevel ? " active" : "") + (i >= unlocked ? " locked" : "");
      var s = starsByLevel[i] || 0;
      var starTxt = s ? "\u2605".repeat(s) : "\u2606\u2606\u2606";
      btn.innerHTML = (i >= unlocked ? '<span class="lk">\uD83D\uDD12 </span>' : "") + "Level " + (i + 1) + " <span class='lk'>" + starTxt + "</span>";
      btn.addEventListener("click", function () {
        if (i >= unlocked) return;
        hideOverlay();
        currentLevel = i;
        resetLevel();
      });
      levelbarEl.appendChild(btn);
    });
  }

  overlayBtn.addEventListener("click", function () {
    hideOverlay();
    if (overlayBtn.dataset.win === "1" && currentLevel + 1 < LEVELS.length) {
      currentLevel++;
      resetLevel();
    } else {
      resetLevel();
    }
  });
  overlayRetry.addEventListener("click", function () { hideOverlay(); resetLevel(); });
  document.getElementById("reset").addEventListener("click", function () { hideOverlay(); resetLevel(); });
  soundBtn.addEventListener("click", function () {
    muted = !muted;
    soundBtn.classList.toggle("muted", muted);
    soundBtn.textContent = muted ? "\u266A\u0338" : "\u266A";
    if (!muted) unlock();
  });

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function paintSky() {
    var sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, "#3f8fd4");
    sky.addColorStop(0.45, "#8ec9ef");
    sky.addColorStop(1, "#d9f0fb");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, GROUND_Y);

    var sunGrad = ctx.createRadialGradient(830, 100, 10, 830, 100, 150);
    sunGrad.addColorStop(0, "rgba(255,244,200,0.95)");
    sunGrad.addColorStop(0.35, "rgba(255,235,160,0.5)");
    sunGrad.addColorStop(1, "rgba(255,235,160,0)");
    ctx.fillStyle = sunGrad;
    ctx.fillRect(660, -60, 340, 340);
    ctx.beginPath();
    ctx.arc(830, 100, 46, 0, Math.PI * 2);
    ctx.fillStyle = "#fff3c4";
    ctx.fill();

    ctx.fillStyle = "rgba(220,238,250,0.55)";
    ctx.fillRect(0, GROUND_Y - 46, W, 46);

    drawHills(GROUND_Y - 6, "#a9d2e6", 0.15, 134, 0.32);
    drawHills(GROUND_Y + 10, "#6fa9c9", 0.5, 90, 0.6);
    drawHills(GROUND_Y + 30, "#5793b6", 1, 60, 1.3);
  }

  function paintFx() {
    var v = fxCtx.createRadialGradient(W / 2, H * 0.4, H * 0.32, W / 2, H * 0.5, H * 1.02);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(6,12,20,0.42)");
    fxCtx.fillStyle = v;
    fxCtx.fillRect(0, 0, W, H);

    var warm = fxCtx.createLinearGradient(0, 0, 0, H);
    warm.addColorStop(0, "rgba(255,214,140,0.07)");
    warm.addColorStop(0.5, "rgba(255,255,255,0)");
    warm.addColorStop(1, "rgba(30,24,56,0.12)");
    fxCtx.fillStyle = warm;
    fxCtx.fillRect(0, 0, W, H);
  }

  function drawBackground() {
    ctx.drawImage(bgLayer, 0, 0, W, H);

    for (var i = 0; i < clouds.length; i++) {
      var cl = clouds[i];
      drawCloud(cl.x, cl.y, cl.s);
    }

    for (var b = 0; b < bgBirds.length; b++) {
      var bird = bgBirds[b];
      var yy = bird.y + Math.sin(time * 0.002 + bird.p) * 6;
      ctx.strokeStyle = "rgba(40,60,80,0.4)";
      ctx.lineWidth = 2;
      var flap = Math.sin(time * 0.01 + bird.p) * 3;
      ctx.beginPath();
      ctx.moveTo(bird.x - 7, yy + flap);
      ctx.lineTo(bird.x, yy);
      ctx.lineTo(bird.x + 7, yy + flap);
      ctx.stroke();
    }
  }

  function drawCloud(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.arc(30, 6, 20, 0, Math.PI * 2);
    ctx.arc(-28, 8, 18, 0, Math.PI * 2);
    ctx.arc(8, -14, 20, 0, Math.PI * 2);
    var g = ctx.createLinearGradient(0, -34, 0, 30);
    g.addColorStop(0, "rgba(255,255,255,0.96)");
    g.addColorStop(0.55, "rgba(248,252,255,0.84)");
    g.addColorStop(1, "rgba(184,210,230,0.88)");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function drawHills(baseY, color, parallax, amp, freq) {
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    for (var x = 0; x <= W; x += 20) {
      var y = baseY - amp * (0.5 + 0.5 * Math.sin(x * 0.006 * freq + parallax * 3)) - amp * 0.3 * Math.sin(x * 0.013 * freq);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, baseY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawGround() {
    var dirt = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    dirt.addColorStop(0, "#7a5a34");
    dirt.addColorStop(0.25, "#6b4c2a");
    dirt.addColorStop(1, "#4a3320");
    ctx.fillStyle = dirt;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    ctx.fillStyle = "#5a4126";
    for (var i = 0; i < 60; i++) {
      var px = (i * 137.5) % W;
      var py = GROUND_Y + 18 + ((i * 53) % (H - GROUND_Y - 20));
      ctx.beginPath();
      ctx.arc(px, py, 1.6 + (i % 3) * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    var grass = ctx.createLinearGradient(0, GROUND_Y - 16, 0, GROUND_Y + 8);
    grass.addColorStop(0, "#8fd35f");
    grass.addColorStop(1, "#4f9a2e");
    ctx.fillStyle = grass;
    ctx.fillRect(0, GROUND_Y - 14, W, 22);

    ctx.fillStyle = "#3f7f24";
    for (var g = 0; g < W; g += 9) {
      var hgt = 6 + ((g * 7919) % 9);
      ctx.fillRect(g, GROUND_Y - 14 - hgt * 0.2, 2, hgt * 0.6);
    }
  }

  function drawSling() {
    var bx = SLING_X, by = SLING_Y;
    var ready = bird && !launched;
    if (ready) {
      var px = bird.position.x, py = bird.position.y;
      ctx.strokeStyle = "#5a3d20";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bx - 15, by - 6); ctx.lineTo(px, py); ctx.stroke();
    }
    ctx.fillStyle = "#6b4a2a";
    ctx.beginPath();
    roundRect(ctx, bx - 9, by - 18, 18, GROUND_Y - by + 18, 6);
    ctx.fill();
    ctx.fillStyle = "#5a3d20";
    for (var i = 0; i < 5; i++) {
      ctx.fillRect(bx - 9, by + i * ((GROUND_Y - by) / 5), 18, 2);
    }
    ctx.fillStyle = "#6b4a2a";
    ctx.beginPath(); ctx.arc(bx - 15, by - 16, 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx + 15, by - 16, 9, 0, Math.PI * 2); ctx.fill();
    if (ready) {
      var px2 = bird.position.x, py2 = bird.position.y;
      ctx.strokeStyle = "#7d5731";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bx + 15, by - 6); ctx.lineTo(px2, py2); ctx.stroke();
      ctx.fillStyle = "#4a3018";
      ctx.beginPath();
      ctx.arc(px2, py2, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTrajectory() {
    if (!dragging || !bird) return;
    var pull = Math.hypot(pullVec.x, pullVec.y);
    if (pull < 8) return;
    var vx = -pullVec.x * LAUNCH, vy = -pullVec.y * LAUNCH;
    var x = SLING_X, y = SLING_Y;
    var gStep = engine.gravity.y * engine.gravity.scale * STEP * STEP;
    for (var i = 0; i < 200; i++) {
      x += vx; y += vy; vy += gStep;
      if (y > GROUND_Y || x > W + 60) break;
      if (i % 4 === 0) {
        var a = 0.55 * (1 - i / 200);
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255," + a + ")";
        ctx.fill();
      }
    }
    var t = pull / MAX_PULL;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, SLING_X - 8, SLING_Y + 40, 16, 70, 8);
    ctx.fill();
    ctx.fillStyle = t > 0.8 ? "#ff5a4d" : "#ffd166";
    ctx.beginPath();
    roundRect(ctx, SLING_X - 8, SLING_Y + 40 + 70 * (1 - t), 16, 70 * t, 8);
    ctx.fill();
  }

  function drawBlock(b) {
    var p = b.plugin, m = MATERIALS[p.kind];
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    var w = p.w, h = p.h, x = -w / 2, y = -h / 2, r = Math.min(6, w / 2, h / 2);

    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    var grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, m.light);
    grad.addColorStop(0.45, m.fill);
    grad.addColorStop(1, m.dark);
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.lineWidth = 2;
    ctx.strokeStyle = m.dark;
    roundRect(ctx, x, y, w, h, r);
    ctx.stroke();

    if (!m.icy && p.kind !== "tnt") {
      ctx.save();
      roundRect(ctx, x, y, w, h, r);
      ctx.clip();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = grainPattern;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.moveTo(x + r * 0.7, y + 1.5);
    ctx.lineTo(x + w - r * 0.7, y + 1.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.beginPath();
    ctx.moveTo(x + r * 0.7, y + h - 1.5);
    ctx.lineTo(x + w - r * 0.7, y + h - 1.5);
    ctx.stroke();

    if (p.kind === "wood") {
      ctx.strokeStyle = "rgba(90,50,15,0.35)";
      ctx.lineWidth = 1.5;
      if (w > h) {
        for (var i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + 4, y + (h * i / 3)); ctx.lineTo(x + w - 4, y + (h * i / 3)); ctx.stroke(); }
      } else {
        for (var j = 1; j < 3; j++) { ctx.beginPath(); ctx.moveTo(x + (w * j / 3), y + 4); ctx.lineTo(x + (w * j / 3), y + h - 4); ctx.stroke(); }
      }
      ctx.strokeStyle = "rgba(90,50,15,0.25)";
      ctx.beginPath();
      ctx.ellipse(x + w * 0.3, y + h * 0.5, Math.min(w, h) * 0.12, Math.min(w, h) * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === "stone") {
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      for (var s = 0; s < 6; s++) {
        var sx = x + ((s * 37) % w), sy = y + ((s * 61) % h);
        ctx.beginPath(); ctx.arc(sx, sy, 1.6 + (s % 3) * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      for (var s2 = 0; s2 < 4; s2++) {
        var sx2 = x + ((s2 * 53) % w), sy2 = y + ((s2 * 29) % h);
        ctx.beginPath(); ctx.arc(sx2, sy2, 2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (m.icy) {
      ctx.globalAlpha = 0.9;
      var shine = ctx.createLinearGradient(x, y, x + w, y + h);
      shine.addColorStop(0, "rgba(255,255,255,0.75)");
      shine.addColorStop(0.35, "rgba(255,255,255,0.05)");
      shine.addColorStop(1, "rgba(255,255,255,0.35)");
      ctx.fillStyle = shine;
      roundRect(ctx, x + 2, y + 2, w - 4, h - 4, r);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 4, y + h - 5); ctx.lineTo(x + w - 5, y + 4); ctx.stroke();
    } else if (p.kind === "metal") {
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      var inset = 5;
      [[x + inset, y + inset], [x + w - inset, y + inset], [x + inset, y + h - inset], [x + w - inset, y + h - inset]].forEach(function (pt) {
        ctx.beginPath(); ctx.arc(pt[0], pt[1], 2, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x + 3, y + h * 0.45, w - 6, 2);
    } else if (p.kind === "sand") {
      ctx.fillStyle = "rgba(120,95,45,0.45)";
      for (var d = 0; d < 14; d++) {
        ctx.beginPath();
        ctx.arc(x + ((d * 23) % w), y + ((d * 17) % h), 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.kind === "tnt") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "bold " + Math.min(w, h) * 0.42 + "px Trebuchet MS";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(w > h ? "TNT" : "TNT", 0, 1);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
    }

    var hpRatio = p.hp / p.maxHp;
    if (p.kind !== "tnt" && hpRatio < 0.75) {
      ctx.strokeStyle = "rgba(30,20,10," + (0.5 * (1 - hpRatio)) + ")";
      ctx.lineWidth = 1.6;
      var cx = 0, cy = 0;
      for (var cr = 0; cr < 3; cr++) {
        ctx.beginPath();
        var ang = cr * 2.1 + 0.5;
        var len = Math.min(w, h) * 0.42;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        ctx.lineTo(cx + Math.cos(ang + 0.5) * len * 1.1, cy + Math.sin(ang + 0.5) * len * 1.1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawPig(p) {
    var t = PIG_TYPES[p.plugin.type];
    var r = p.plugin.r;
    var hpRatio = p.plugin.hp / p.plugin.maxHp;
    ctx.save();
    ctx.translate(p.position.x, p.position.y);
    ctx.rotate(p.angle);

    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    var bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r * 1.15);
    bodyGrad.addColorStop(0, t.snout);
    bodyGrad.addColorStop(0.6, t.body);
    bodyGrad.addColorStop(1, t.dark);
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = t.dark;
    ctx.beginPath();
    ctx.arc(-r * 0.62, -r * 0.78, r * 0.3, 0, Math.PI * 2);
    ctx.arc(r * 0.62, -r * 0.78, r * 0.3, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(0, r * 0.26, r * 0.46, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = t.snout;
    ctx.fill();
    ctx.strokeStyle = t.dark;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = t.dark;
    ctx.beginPath();
    ctx.arc(-r * 0.16, r * 0.26, r * 0.09, 0, Math.PI * 2);
    ctx.arc(r * 0.16, r * 0.26, r * 0.09, 0, Math.PI * 2);
    ctx.fill();

    var gx = 0, gy = 0;
    var tgt = activeFlight ? (bird || birds[0]) : null;
    if (tgt) {
      var dxg = tgt.position.x - p.position.x, dyg = tgt.position.y - p.position.y;
      var dg = Math.hypot(dxg, dyg) || 1;
      var ca = Math.cos(-p.angle), sa = Math.sin(-p.angle);
      gx = (dxg / dg) * ca - (dyg / dg) * sa;
      gy = (dxg / dg) * sa + (dyg / dg) * ca;
    }
    var exo = gx * r * 0.08, eyo = gy * r * 0.08;

    if (blinking > 0.45) {
      ctx.strokeStyle = "#2a2013";
      ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(-r * 0.33, -r * 0.2, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.33, -r * 0.2, r * 0.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-r * 0.33, -r * 0.22, r * 0.24, 0, Math.PI * 2);
      ctx.arc(r * 0.33, -r * 0.22, r * 0.24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1f2430";
      ctx.beginPath();
      ctx.arc(-r * 0.3 + exo, -r * 0.22 + eyo, r * 0.11, 0, Math.PI * 2);
      ctx.arc(r * 0.3 + exo, -r * 0.22 + eyo, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(-r * 0.34 + exo, -r * 0.28 + eyo, r * 0.04, 0, Math.PI * 2);
      ctx.arc(r * 0.26 + exo, -r * 0.28 + eyo, r * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "#2a2013";
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.lineCap = "round";
    if (hpRatio > 0.6) {
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.55); ctx.lineTo(-r * 0.16, -r * 0.48); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 0.55); ctx.lineTo(r * 0.16, -r * 0.48); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.44); ctx.lineTo(-r * 0.16, -r * 0.58); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 0.44); ctx.lineTo(r * 0.16, -r * 0.58); ctx.stroke();
    }

    if (hpRatio <= 0.66) {
      ctx.fillStyle = "rgba(190,60,60,0.35)";
      ctx.beginPath(); ctx.arc(-r * 0.55, r * 0.3, r * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    if (hpRatio <= 0.4) {
      ctx.fillStyle = "rgba(190,60,60,0.4)";
      ctx.beginPath(); ctx.arc(r * 0.5, r * 0.35, r * 0.26, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#2a2013";
      ctx.beginPath();
      ctx.arc(r * 0.05, r * 0.62, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#2a2013";
      ctx.beginPath();
      ctx.arc(r * 0.05, r * 0.45, r * 0.24, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    }

    if (p.plugin.armor > 0) {
      ctx.fillStyle = "#9aa3ad";
      ctx.strokeStyle = "#5b6270";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -r * 0.15, r * 1.02, Math.PI * 1.08, Math.PI * 1.92);
      ctx.lineTo(r * 0.9, -r * 0.15);
      ctx.lineTo(-r * 0.9, -r * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      var mg = ctx.createLinearGradient(-r, -r, r, 0);
      mg.addColorStop(0, "rgba(255,255,255,0.6)");
      mg.addColorStop(0.5, "rgba(255,255,255,0.1)");
      mg.addColorStop(1, "rgba(255,255,255,0.5)");
      ctx.fillStyle = mg;
      ctx.beginPath();
      ctx.arc(0, -r * 0.15, r * 1.02, Math.PI * 1.08, Math.PI * 1.92);
      ctx.lineTo(r * 0.9, -r * 0.15);
      ctx.lineTo(-r * 0.9, -r * 0.15);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBirdShape(body, type, isStatic) {
    var t = BIRD_TYPES[type];
    var r = t.r;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);

    var ang = body.velocity ? Math.atan2(body.velocity.y, body.velocity.x) : 0;
    var speed = body.velocity ? Math.hypot(body.velocity.x, body.velocity.y) : 0;
    var stretch = 1 + Math.min(speed * 0.02, 0.32);
    ctx.rotate(ang);
    ctx.scale(stretch, 1 / stretch);
    ctx.rotate(-ang);
    ctx.rotate(body.angle);

    var flap = speed > 1 ? Math.sin(time * 0.02) * 0.5 : 0;

    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 4;

    ctx.fillStyle = t.dark;
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, 0);
    ctx.lineTo(-r * 1.9, -r * 0.5 + flap * 6);
    ctx.lineTo(-r * 1.9, r * 0.5 + flap * 6);
    ctx.closePath();
    ctx.fill();

    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.2, 0, 0, r * 1.15);
    g.addColorStop(0, t.color);
    g.addColorStop(0.7, t.dark);
    g.addColorStop(1, t.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = t.belly;
    ctx.beginPath();
    ctx.ellipse(r * 0.05, r * 0.42, r * 0.5, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = t.dark;
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, -r * 0.05, r * 0.55, r * 0.42, -0.3 + flap, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    for (var f = 0; f < 3; f++) {
      var fx = -r * 0.45 + f * r * 0.17;
      ctx.beginPath();
      ctx.moveTo(fx, -r * 0.26);
      ctx.lineTo(fx - r * 0.08, r * 0.24);
      ctx.stroke();
    }

    ctx.fillStyle = t.beak;
    ctx.beginPath();
    ctx.moveTo(r * 0.55, -r * 0.12);
    ctx.lineTo(r * 1.45, r * 0.05);
    ctx.lineTo(r * 0.55, r * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(r * 0.34, -r * 0.38, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1f2430";
    ctx.beginPath();
    ctx.arc(r * 0.42, -r * 0.38, r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#2a2013";
    ctx.lineWidth = Math.max(2, r * 0.14);
    ctx.lineCap = "round";
    if (type === "black" || type === "red") {
      ctx.beginPath(); ctx.moveTo(r * 0.08, -r * 0.72); ctx.lineTo(r * 0.62, -r * 0.5); ctx.stroke();
    } else if (type === "blue") {
      ctx.beginPath(); ctx.moveTo(r * 0.06, -r * 0.62); ctx.lineTo(r * 0.5, -r * 0.66); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(r * 0.04, -r * 0.6); ctx.lineTo(r * 0.5, -r * 0.72); ctx.stroke();
    }

    if (type === "black") {
      ctx.strokeStyle = "#c9a14a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.quadraticCurveTo(r * 0.2, -r * 1.5, -r * 0.1, -r * 1.7);
      ctx.stroke();
      ctx.fillStyle = Math.sin(time * 0.03) > 0 ? "#ffd166" : "#ff7a3d";
      ctx.beginPath();
      ctx.arc(-r * 0.1, -r * 1.75, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,220,120,0.6)";
      ctx.beginPath();
      ctx.arc(-r * 0.1, -r * 1.75, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawQueue() {
    var startX = SLING_X - 60;
    for (var i = 0; i < birdQueue.length; i++) {
      var type = birdQueue[i];
      var t = BIRD_TYPES[type];
      var x = startX - i * 34;
      var y = GROUND_Y - t.r - 2;
      ctx.save();
      ctx.translate(x, y);
      var bob = Math.sin(time * 0.004 + i) * 1.5;
      ctx.translate(0, bob);
      ctx.fillStyle = t.color;
      ctx.beginPath(); ctx.arc(0, 0, t.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.belly;
      ctx.beginPath(); ctx.ellipse(0, t.r * 0.4, t.r * 0.5, t.r * 0.36, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.beak;
      ctx.beginPath();
      ctx.moveTo(t.r * 0.55, -t.r * 0.1); ctx.lineTo(t.r * 1.4, t.r * 0.05); ctx.lineTo(t.r * 0.55, t.r * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(t.r * 0.34, -t.r * 0.38, t.r * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1f2430";
      ctx.beginPath(); ctx.arc(t.r * 0.4, -t.r * 0.38, t.r * 0.11, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawTrail() {
    if (!bird || !activeFlight) return;
    if (!bird.plugin.trail) bird.plugin.trail = [];
    bird.plugin.trail.push({ x: bird.position.x, y: bird.position.y, life: 1 });
    if (bird.plugin.trail.length > 26) bird.plugin.trail.shift();
    for (var i = 0; i < bird.plugin.trail.length; i++) {
      var p = bird.plugin.trail[i];
      p.life -= 0.03;
      if (p.life <= 0) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6 * p.life, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255," + (0.35 * p.life) + ")";
      ctx.fill();
    }
  }

  function drawSpeedLines(b) {
    var sp = Math.hypot(b.velocity.x, b.velocity.y);
    if (sp < 6) return;
    var t = BIRD_TYPES[b.plugin.type];
    var a = Math.atan2(b.velocity.y, b.velocity.x);
    var len = t.r * 1.6 + sp * 1.2;
    var alpha = Math.min(0.5, (sp - 5) * 0.04);
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(a);
    ctx.strokeStyle = "rgba(255,255,255," + alpha + ")";
    ctx.lineCap = "round";
    for (var i = 0; i < 3; i++) {
      var yy = (i - 1) * t.r * 0.5;
      ctx.lineWidth = 2 - i * 0.4;
      ctx.beginPath();
      ctx.moveTo(-t.r * 1.2, yy);
      ctx.lineTo(-t.r * 1.2 - len, yy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles() {
    function drawOne(p) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.type === "shard") {
        ctx.beginPath();
        ctx.moveTo(0, -p.r); ctx.lineTo(p.r * 0.6, 0); ctx.lineTo(0, p.r); ctx.lineTo(-p.r * 0.6, 0); ctx.closePath();
        ctx.fill();
      } else if (p.type === "splinter" || p.type === "rock") {
        ctx.fillRect(-p.r * 0.6, -p.r * 0.35, p.r * 1.2, p.r * 0.7);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    var i, p, anyGlow = false;
    for (i = 0; i < particles.length; i++) {
      p = particles[i];
      if (p.glow) anyGlow = true; else drawOne(p);
    }
    if (anyGlow) {
      ctx.globalCompositeOperation = "lighter";
      for (i = 0; i < particles.length; i++) {
        p = particles[i];
        if (p.glow) drawOne(p);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  }

  function drawRings() {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (r.glow) ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = Math.max(0, r.life);
      ctx.lineWidth = r.width * r.life;
      ctx.stroke();
      if (r.glow) ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < popups.length; i++) {
      var p = popups[i];
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.font = "bold 20px Trebuchet MS";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

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

  function drawDebris() {
    for (var i = 0; i < debris.length; i++) {
      var d = debris[i];
      var m = MATERIALS[d.plugin.kind] || MATERIALS.wood;
      ctx.save();
      ctx.globalAlpha = clamp(d.plugin.life / 800, 0, 1);
      ctx.translate(d.position.x, d.position.y);
      ctx.rotate(d.angle);
      ctx.fillStyle = m.fill;
      ctx.strokeStyle = m.dark;
      ctx.lineWidth = 1.5;
      roundRect(ctx, -d.plugin.w / 2, -d.plugin.h / 2, d.plugin.w, d.plugin.h, 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function shadowFor(body, halfW, halfH) {
    var h = GROUND_Y - body.position.y;
    if (h < -40) return;
    var lift = clamp(h / 460, 0, 1);
    var alpha = 0.30 * (1 - lift) + 0.03;
    if (alpha < 0.05) return;
    var w = halfW * (1 + lift * 0.55);
    var hh = Math.max(2.5, halfH * 0.34) * (1 + lift * 0.5);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#152230";
    ctx.beginPath();
    ctx.ellipse(body.position.x, GROUND_Y + 6, w, hh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawShadows() {
    for (var i = 0; i < blocks.length; i++) {
      var bp = blocks[i].plugin;
      shadowFor(blocks[i], bp.w * 0.5, bp.h * 0.5);
    }
    for (var j = 0; j < pigs.length; j++) {
      var pr = pigs[j].plugin.r;
      shadowFor(pigs[j], pr * 1.05, pr * 0.9);
    }
    if (bird) shadowFor(bird, BIRD_TYPES[bird.plugin.type].r * 1.05, BIRD_TYPES[bird.plugin.type].r * 0.9);
    for (var k = 0; k < birds.length; k++) {
      if (birds[k] === bird) continue;
      var bt = BIRD_TYPES[birds[k].plugin.type];
      shadowFor(birds[k], bt.r * 1.05, bt.r * 0.9);
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
    var frame = Math.min(60, now - last);
    last = now;
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

    var sx = shake ? (Math.random() - 0.5) * shake : 0;
    var sy = shake ? (Math.random() - 0.5) * shake : 0;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(sx, sy);

    drawBackground();
    drawGround();
    drawShadows();
    drawTrail();

    blocks.forEach(drawBlock);
    drawDebris();
    pigs.forEach(drawPig);
    if (bird) { drawSpeedLines(bird); drawBirdShape(bird, bird.plugin.type); }
    for (var k = 0; k < birds.length; k++) {
      if (birds[k] !== bird) { drawSpeedLines(birds[k]); drawBirdShape(birds[k], birds[k].plugin.type); }
    }
    drawSling();
    drawTrajectory();
    drawQueue();
    drawParticles();
    drawRings();
    drawPopups();

    ctx.restore();
    if (flash > 0.01) {
      ctx.fillStyle = "rgba(255,238,200," + (flash * 0.6) + ")";
      ctx.fillRect(0, 0, W, H);
      flash *= 0.8;
    } else flash = 0;
    ctx.drawImage(fxLayer, 0, 0, W, H);
    requestAnimationFrame(loop);
  }

  (function cacheStaticLayers() {
    var real = ctx;
    ctx = bgCtx;
    paintSky();
    ctx = real;
    paintFx();
  })();

  loadProgress();
  buildLevel(currentLevel);
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
    level: function (i) { hideOverlay(); currentLevel = i; resetLevel(); },
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
