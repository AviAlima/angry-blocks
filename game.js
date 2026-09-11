(function () {
  "use strict";

  var { Engine, Render, Runner, World, Bodies, Body, Composite, Events, Vector, Constraint } = Matter;

  var W = 1000, H = 600;
  var GROUND_Y = H - 60;
  var SLING_X = 170, SLING_Y = GROUND_Y - 140;
  var MAX_PULL = 90;
  var LAUNCH_FACTOR = 0.19;

  var COLORS = {
    wood: "#c98a4b",
    woodDark: "#a66f38",
    stone: "#9aa3ad",
    pig: "#7ec850",
    pigDark: "#5da336",
    bird: "#d94f4f",
    birdDark: "#a83a3a",
  };

  var engine = Engine.create();
  engine.gravity.y = 1;
  var world = engine.world;

  var canvas = document.getElementById("game");
  var render = Render.create({
    canvas: canvas,
    engine: engine,
    options: {
      width: W,
      height: H,
      wireframes: false,
      background: "transparent",
      pixelRatio: window.devicePixelRatio || 1,
    },
  });

  var M = Matter;

  // ---- Collision categories ----
  var CAT = { ground: 0x0001, static: 0x0002, block: 0x0004, pig: 0x0008, bird: 0x0010 };

  // ---- Sounds (tiny WebAudio synth, no assets) ----
  var audioCtx = null;
  function ac() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    return audioCtx;
  }
  function unlock() { var c = ac(); if (c && c.state === "suspended") c.resume(); }
  function beep(freq, dur, type, vol) {
    var c = ac();
    if (!c) return;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.12, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }
  function sfxLaunch() { beep(220, 0.18, "sawtooth", 0.15); }
  function sfxHit() { beep(120, 0.08, "square", 0.08); }
  function sfxPop() {
    beep(600, 0.08, "square", 0.14);
    setTimeout(function () { beep(880, 0.1, "square", 0.1); }, 60);
  }
  function sfxWin() {
    [523, 659, 784, 1046].forEach(function (f, i) {
      setTimeout(function () { beep(f, 0.18, "triangle", 0.14); }, i * 110);
    });
  }
  function sfxLose() {
    [400, 300, 200].forEach(function (f, i) {
      setTimeout(function () { beep(f, 0.25, "sawtooth", 0.12); }, i * 140);
    });
  }

  // ---- Ground + walls ----
  var ground = Bodies.rectangle(W / 2, GROUND_Y + 30, W + 400, 60, {
    isStatic: true,
    label: "ground",
    render: { fillStyle: "#3a2f25" },
    collisionFilter: { category: CAT.ground },
  });
  var ceiling = Bodies.rectangle(W / 2, -30, W + 400, 60, { isStatic: true, label: "wall" });
  var leftWall = Bodies.rectangle(-30, H / 2, 60, H * 3, { isStatic: true, label: "wall" });
  var rightWall = Bodies.rectangle(W + 30, H / 2, 60, H * 3, { isStatic: true, label: "wall" });
  World.add(world, [ground, ceiling, leftWall, rightWall]);

  // ---- Game objects ----
  var bird = null, birdConstraint = null, pigs = [], blocks = [], particles = [];
  var dragging = false, pulled = false, pullVec = { x: 0, y: 0 };
  var birdsLeft = 3, flying = false, settling = false, settleTimer = 0, levelDone = false;
  var score = 0;

  var scoreEl = document.getElementById("score");
  var birdsEl = document.getElementById("birds");

  function updateHud() {
    scoreEl.textContent = "Score: " + score;
    birdsEl.textContent = "Birds: " + birdsLeft;
  }

  function makeBlock(x, y, w, h, kind) {
    var b = Bodies.rectangle(x, y, w, h, {
      label: "block",
      density: kind === "stone" ? 0.004 : 0.0018,
      friction: 0.6,
      frictionStatic: 0.9,
      restitution: 0.02,
      render: { fillStyle: kind === "stone" ? COLORS.stone : COLORS.wood },
      collisionFilter: { category: CAT.block },
    });
    b.plugin = { kind: kind };
    blocks.push(b);
    World.add(world, b);
    return b;
  }

  function makePig(x, y, r) {
    r = r || 24;
    var p = Bodies.circle(x, y, r, {
      label: "pig",
      density: 0.0016,
      friction: 0.5,
      restitution: 0.15,
      render: { fillStyle: COLORS.pig },
      collisionFilter: { category: CAT.pig },
    });
    p.plugin = { r: r, hp: 1, alive: true };
    pigs.push(p);
    World.add(world, p);
    return p;
  }

  function makeBird(x, y) {
    var b = Bodies.circle(x, y, 18, {
      label: "bird",
      density: 0.006,
      friction: 0.5,
      frictionAir: 0.003,
      restitution: 0.35,
      render: { fillStyle: COLORS.bird },
      collisionFilter: { category: CAT.bird },
    });
    b.plugin = { launched: false, settled: false };
    return b;
  }

  function spawnBird() {
    if (levelDone) return;
    bird = makeBird(SLING_X, SLING_Y);
    Body.setStatic(bird, true);
    World.add(world, bird);
    dragging = false;
    pulled = false;
    pulling = false;
    pullVec = { x: 0, y: 0 };
    flying = false;
  }

  // ---- Level ----
  function buildLevel() {
    blocks.forEach(function (b) { World.remove(world, b); });
    pigs.forEach(function (p) { World.remove(world, p); });
    blocks = []; pigs = []; particles = [];
    score = 0; birdsLeft = 3; levelDone = false; flying = false; settling = false;
    if (bird) { World.remove(world, bird); bird = null; }

    var baseX = 640;
    // Two towers made of wood, roof + stone top
    // Left tower
    makeBlock(baseX, GROUND_Y - 20, 22, 120, "wood");
    makeBlock(baseX + 90, GROUND_Y - 20, 22, 120, "wood");
    makeBlock(baseX + 45, GROUND_Y - 90, 120, 20, "wood");
    // Right tower
    makeBlock(baseX + 170, GROUND_Y - 20, 22, 120, "wood");
    makeBlock(baseX + 260, GROUND_Y - 20, 22, 120, "wood");
    makeBlock(baseX + 215, GROUND_Y - 90, 120, 20, "stone");
    // Pigs tucked inside
    makePig(baseX + 45, GROUND_Y - 55, 22);
    makePig(baseX + 215, GROUND_Y - 55, 22);
    // Pig on top
    makePig(baseX + 130, GROUND_Y - 135, 20);
    // Some crates
    makeBlock(baseX + 130, GROUND_Y - 120, 60, 20, "wood");

    spawnBird();
    updateHud();
  }

  // ---- Interaction ----
  var pulling = false;
  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var p = e.touches ? e.touches[0] : e;
    return {
      x: (p.clientX - rect.left) * (W / rect.width),
      y: (p.clientY - rect.top) * (H / rect.height),
    };
  }
  function distToBird(p) {
    if (!bird) return 999;
    return Math.hypot(p.x - bird.position.x, p.y - bird.position.y);
  }

  function onDown(e) {
    unlock();
    if (levelDone || flying || !bird) return;
    var p = pointerPos(e);
    if (distToBird(p) < 90) {
      dragging = true;
      pulled = false;
    }
  }
  function onMove(e) {
    if (!dragging || !bird) return;
    var p = pointerPos(e);
    var dx = p.x - SLING_X, dy = p.y - SLING_Y;
    var len = Math.hypot(dx, dy);
    if (len > MAX_PULL) { dx = dx / len * MAX_PULL; dy = dy / len * MAX_PULL; }
    // only allow pulling left/up-ish from sling
    if (dx > 0) dx = 0;
    pullVec = { x: dx, y: dy };
    Body.setPosition(bird, { x: SLING_X + dx, y: SLING_Y + dy });
  }
  function onUp() {
    if (!dragging || !bird) return;
    dragging = false;
    var pull = Math.hypot(pullVec.x, pullVec.y);
    if (pull < 12) {
      Body.setPosition(bird, { x: SLING_X, y: SLING_Y });
      pullVec = { x: 0, y: 0 };
      return;
    }
    Body.setStatic(bird, false);
    bird.plugin.launched = true;
    Body.setVelocity(bird, {
      x: -pullVec.x * LAUNCH_FACTOR,
      y: -pullVec.y * LAUNCH_FACTOR,
    });
    flying = true;
    pulled = true;
    sfxLaunch();
  }

  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); onDown(e); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); onMove(e); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); onUp(e); }, { passive: false });

  // ---- Particles ----
  function burst(x, y, color) {
    for (var i = 0; i < 14; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = 2 + Math.random() * 4;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2,
        life: 1, color: color,
        r: 2 + Math.random() * 3,
      });
    }
  }
  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.25;
      p.life -= 0.025;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // ---- Damage from collisions ----
  Events.on(engine, "collisionStart", function (evt) {
    evt.pairs.forEach(function (pair) {
      var a = pair.bodyA, b = pair.bodyB;
      [a, b].forEach(function (body) {
        var other = body === a ? b : a;
        if (body.label === "pig" && body.plugin && body.plugin.alive) {
          var speed = Vector.magnitude(other.velocity || { x: 0, y: 0 });
          var rel = Vector.magnitude(Vector.sub(body.velocity, other.velocity));
          if (rel > 4.5) killPig(body, rel);
          else if (rel > 1.5) sfxHit();
        }
      });
    });
  });

  function killPig(pig, force) {
    if (!pig.plugin.alive) return;
    pig.plugin.alive = false;
    score += 500;
    burst(pig.position.x, pig.position.y, COLORS.pig);
    sfxPop();
    World.remove(world, pig);
    pigs = pigs.filter(function (p) { return p !== pig; });
    updateHud();
    checkWinSoon();
  }

  function checkWinSoon() {
    if (pigs.length === 0 && !levelDone) {
      levelDone = true;
      score += birdsLeft * 1000;
      updateHud();
      sfxWin();
      showOverlay("Level Clear!", "Score: " + score, "Play Again");
    }
  }

  function nextBird() {
    if (levelDone) return;
    if (bird) { World.remove(world, bird); bird = null; }
    if (pigs.length === 0) { checkWinSoon(); return; }
    if (birdsLeft > 0) {
      spawnBird();
    } else {
      levelDone = true;
      sfxLose();
      showOverlay("Out of Birds", "Score: " + score, "Try Again");
    }
  }

  // ---- Bird settled detection ----
  function isSettled(body) {
    return Vector.magnitude(body.velocity) < 0.35 && Math.abs(body.angularVelocity) < 0.05;
  }

  // ---- Overlay ----
  var overlay = document.getElementById("overlay");
  var overlayTitle = document.getElementById("overlay-title");
  var overlayText = document.getElementById("overlay-text");
  var overlayBtn = document.getElementById("overlay-btn");
  function showOverlay(title, text, btn) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    overlayBtn.textContent = btn;
    overlay.classList.add("show");
  }
  function hideOverlay() { overlay.classList.remove("show"); }
  overlayBtn.addEventListener("click", function () {
    hideOverlay();
    buildLevel();
  });
  var resetBtn = document.getElementById("reset");
  resetBtn.addEventListener("click", function () { hideOverlay(); buildLevel(); });

  // ---- Custom rendering ----
  function drawPig(ctx, body) {
    var r = body.plugin.r;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pig;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.pigDark;
    ctx.stroke();
    // ears
    ctx.beginPath();
    ctx.arc(-r * 0.6, -r * 0.75, r * 0.28, 0, Math.PI * 2);
    ctx.arc(r * 0.6, -r * 0.75, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.pigDark;
    ctx.fill();
    // snout
    ctx.beginPath();
    ctx.ellipse(0, r * 0.25, r * 0.42, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#8fd35f";
    ctx.fill();
    ctx.fillStyle = COLORS.pigDark;
    ctx.beginPath();
    ctx.arc(-r * 0.15, r * 0.25, r * 0.08, 0, Math.PI * 2);
    ctx.arc(r * 0.15, r * 0.25, r * 0.08, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(-r * 0.32, -r * 0.2, r * 0.22, 0, Math.PI * 2);
    ctx.arc(r * 0.32, -r * 0.2, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.2, r * 0.1, 0, Math.PI * 2);
    ctx.arc(r * 0.3, -r * 0.2, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawBird(ctx, body) {
    var r = 18;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.bird;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.birdDark;
    ctx.stroke();
    // belly
    ctx.beginPath();
    ctx.arc(0, r * 0.4, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = "#f2d0a4";
    ctx.fill();
    // beak
    ctx.beginPath();
    ctx.moveTo(r * 0.6, -r * 0.1);
    ctx.lineTo(r * 1.4, r * 0.1);
    ctx.lineTo(r * 0.6, r * 0.35);
    ctx.closePath();
    ctx.fillStyle = "#f5a623";
    ctx.fill();
    // eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(r * 0.35, -r * 0.35, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.beginPath();
    ctx.arc(r * 0.42, -r * 0.35, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
    // brow
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.65);
    ctx.lineTo(r * 0.62, -r * 0.42);
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.birdDark;
    ctx.stroke();
    ctx.restore();
  }

  // ---- Slingshot rendering ----
  function drawSling(ctx) {
    var bx = SLING_X, by = SLING_Y;
    // back band
    if (bird && (dragging || (!bird.plugin.launched))) {
      var px = bird.position.x, py = bird.position.y;
      ctx.beginPath();
      ctx.moveTo(bx - 14, by - 10);
      ctx.lineTo(px, py);
      ctx.strokeStyle = "#6b4a2a";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    // posts
    ctx.fillStyle = "#6b4a2a";
    ctx.fillRect(bx - 8, by - 12, 16, GROUND_Y - (by - 12));
    ctx.beginPath();
    ctx.arc(bx - 14, by - 14, 8, 0, Math.PI * 2);
    ctx.arc(bx + 14, by - 14, 8, 0, Math.PI * 2);
    ctx.fill();
    // front band
    if (bird && (dragging || (!bird.plugin.launched))) {
      var px2 = bird.position.x, py2 = bird.position.y;
      ctx.beginPath();
      ctx.moveTo(bx + 14, by - 10);
      ctx.lineTo(px2, py2);
      ctx.strokeStyle = "#7d5731";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }

  function drawTrajectory(ctx) {
    if (!dragging || !bird) return;
    var pull = Math.hypot(pullVec.x, pullVec.y);
    if (pull < 5) return;
    var vx = -pullVec.x * LAUNCH_FACTOR;
    var vy = -pullVec.y * LAUNCH_FACTOR;
    var x = SLING_X, y = SLING_Y;
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (var i = 0; i < 260; i++) {
      x += vx; y += vy;
      vy += engine.gravity.y * engine.gravity.scale * 1000; // approximate per-step
      if (i % 4 === 0) { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); }
      if (y > GROUND_Y) break;
    }
  }

  Events.on(render, "afterRender", function () {
    var ctx = render.context;
    drawSling(ctx);
    drawTrajectory(ctx);
    pigs.forEach(function (p) { if (p.plugin.alive) drawPig(ctx, p); });
    if (bird) drawBird(ctx, bird);

    // particles
    particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  });

  // ---- Main loop ----
  var runner = Runner.create();
  var lastTime = performance.now();
  function loop() {
    var now = performance.now();
    var dt = Math.min(32, now - lastTime);
    lastTime = now;

    Engine.update(engine, dt);
    updateParticles(dt);

    // bird flight + settle logic
    if (flying && bird) {
      var p = bird.position;
      if (p.x > W + 40 || p.y > H + 40) {
        flying = false;
        nextBird();
      } else if (!bird.plugin.settled && isSettled(bird) && bird.position.x > SLING_X + 40) {
        bird.plugin.settled = true;
        settleTimer = 0;
        settling = true;
      }
      if (bird && bird.plugin.settled) {
        settleTimer += dt;
        // if all motion settled, move to next bird after a beat
        var anyMoving = blocks.concat(pigs).some(function (b) {
          return Vector.magnitude(b.velocity) > 0.4;
        });
        if ((!anyMoving && settleTimer > 600) || settleTimer > 3500) {
          flying = false;
          settling = false;
          nextBird();
        }
      }
    }
    requestAnimationFrame(loop);
  }

  // custom static-body rendering for blocks with kind colors (Matter draws them, fine)
  Events.on(render, "beforeRender", function () {
    blocks.forEach(function (b) {
      b.render.fillStyle = b.plugin.kind === "stone" ? COLORS.stone : COLORS.wood;
    });
  });

  Render.run(render);
  buildLevel();
  requestAnimationFrame(loop);
})();
