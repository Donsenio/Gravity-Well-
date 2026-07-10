/* ============================================================
   GRAVITY WELL: RECLAIMED — Phase 3 "Full War"
   Single-player. Vanilla JS + Canvas. No dependencies.

   New in Phase 3:
     - Three enemy factions: Ashkari Reach (aggressive),
       Pale Syndicate (fortified builders), Vorath Dominion (stealth)
     - Upgrade shop (press U) — spend credits on your ship
     - Enemy bases can be destroyed and planets recaptured
     - Colony turrets (purchasable) defend your planets
     - "PRESS L TO FLAG" landing prompt
     - Soft collision: slow contact with a planet no longer kills you

   File layout:
     1. CONFIG      — all tunable numbers in one place
     2. SETUP       — canvas, input, camera
     3. UPGRADES    — shop definitions + UI
     4. GAME STATE  — init, spawn functions
     5. UPDATE      — physics, AI, collisions, win/lose
     6. DRAW        — rendering
     7. LOOP        — the main loop
   ============================================================ */

/* ---------- 1. CONFIG ---------- */
const CONFIG = {
  world: { w: 2800, h: 1900 },
  ship: {
    thrust: 0.07,
    turnSpeed: 0.04,
    drag: 0.998,
    hull: 100,
    shootCooldown: 14,
    bulletSpeed: 5.5,
    crashSpeed: 1.3,       // impact speed above this = hull breach
  },
  gravity: { maxPull: 0.55 },
  planets: {
    count: 7,
    minRadius: 45,
    maxRadiusExtra: 20,
    minMass: 1600,
    massExtra: 600,
    minSpacing: 340,
    revealRange: 260,
    baseHull: 100,         // health of an enemy base built on a planet
  },
  enemies: {
    maxSpeed: 1.5,
    accel: 0.035,
    bulletSpeed: 3.2,
    landTimeFrames: 200,
    minCount: 3,           // respawn wave when hostiles drop below this
    waveSize: 3,
  },
  factions: {
    ashkari: { hull: 40, shootRange: 350, aggression: 0.75, speedMult: 1.0,  color: '#e85850', label: 'ASHKARI' },
    pale:    { hull: 70, shootRange: 300, aggression: 0.25, speedMult: 0.7,  color: '#2ab8d6', label: 'PALE SYNDICATE' },
    vorath:  { hull: 30, shootRange: 250, aggression: 0.15, speedMult: 1.25, color: '#9f6ad6', label: 'VORATH' },
  },
  paleTurret: { range: 260, cooldown: 110 },  // Pale-owned planets shoot back
  freighter: { speed: 1.2, hull: 60 },
  colonyTurret: { range: 220, cooldown: 90 }, // your colonies, once upgraded
  economy: {
    creditTickFrames: 300,
    creditsPerColony: 10,
  },
  win: { planetsNeeded: 4 },  // you win at 4; any faction reaching 4 wins
};

const PLANET_NAMES   = ['KETH-7', 'VORA-2', 'SELUN', 'DRAXI', 'MIRATH', 'TANIS', 'HALCYON'];
const PLANET_FILLS   = ['#1a3a5e', '#3a1a1a', '#1a3a2a', '#2e1a3a', '#3a2e1a', '#1a2e3a', '#33301a'];
const PLANET_STROKES = ['#2a9fd6', '#d6442a', '#2ad67a', '#9f2ad6', '#d6a02a', '#2ad6c2', '#c2d62a'];

/* ---------- 2. SETUP ---------- */
const canvas = document.getElementById('gw-canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('gw-wrap');
const msgEl = document.getElementById('gw-msg');
const hint = document.getElementById('gw-focus-hint');
const restartBtn = document.getElementById('gw-restart');
const shopEl = document.getElementById('gw-shop');
const shopItemsEl = document.getElementById('shop-items');
const shopCreditsEl = document.getElementById('shop-credits');
const shopCloseBtn = document.getElementById('shop-close');

let W, H;
function resize() {
  W = wrap.clientWidth;
  H = Math.round(W * 0.62);
  canvas.width = W;
  canvas.height = H;
  wrap.style.height = H + 'px';
}
resize();
window.addEventListener('resize', resize);

const WORLD_W = CONFIG.world.w;
const WORLD_H = CONFIG.world.h;
let cam = { x: 0, y: 0 };

function worldToScreen(wx, wy) { return { x: wx - cam.x, y: wy - cam.y }; }
function onScreen(wx, wy, margin = 80) {
  const s = worldToScreen(wx, wy);
  return s.x > -margin && s.x < W + margin && s.y > -margin && s.y < H + margin;
}

let keys = {};
let shopOpen = false;

canvas.addEventListener('keydown', e => {
  if (e.key === 'u' || e.key === 'U') { toggleShop(); e.preventDefault(); return; }
  if (e.key === 'Escape' && shopOpen) { toggleShop(); return; }
  keys[e.key] = true;
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
});
canvas.addEventListener('keyup', e => { keys[e.key] = false; });
hint.addEventListener('click', () => { hint.style.display = 'none'; canvas.focus(); });
restartBtn.addEventListener('click', () => { init(); canvas.focus(); });
canvas.addEventListener('focus', () => { hint.style.display = 'none'; });
shopCloseBtn.addEventListener('click', () => { toggleShop(); canvas.focus(); });

/* ---------- 3. UPGRADES ---------- */
const UPGRADES = {
  engine: {
    name: 'Engine Boost',
    desc: 'Stronger thrust per level',
    costs: [100, 200, 400],
    apply: () => {},   // read via multiplier below
  },
  hull: {
    name: 'Reinforced Hull',
    desc: '+25 max hull and full repair',
    costs: [80, 160, 320],
    apply: () => {
      ship.maxHull += 25;
      ship.hull = ship.maxHull;
    },
  },
  weapons: {
    name: 'Rapid Cannons',
    desc: 'Faster fire rate per level',
    costs: [120, 240, 480],
    apply: () => {},
  },
  freighter: {
    name: 'Freighter Engines',
    desc: 'Freighters travel faster',
    costs: [100, 200],
    apply: () => {},
  },
  turrets: {
    name: 'Colony Turrets',
    desc: 'Your colonies shoot nearby hostiles',
    costs: [150, 250],
    apply: () => {},
  },
};

let upgradeLevels = {};

function upgradeLevel(key) { return upgradeLevels[key] || 0; }
function thrustMult()    { return 1 + upgradeLevel('engine') * 0.25; }
function fireCooldown()  { return Math.max(6, CONFIG.ship.shootCooldown - upgradeLevel('weapons') * 3); }
function freighterSpeed(){ return CONFIG.freighter.speed * (1 + upgradeLevel('freighter') * 0.5); }
function turretsOwned()  { return upgradeLevel('turrets') > 0; }
function turretRange()   { return CONFIG.colonyTurret.range + (upgradeLevel('turrets') - 1) * 90; }

function toggleShop() {
  shopOpen = !shopOpen;
  shopEl.classList.toggle('hidden', !shopOpen);
  if (shopOpen) renderShop();
}

function renderShop() {
  shopCreditsEl.textContent = 'CREDITS: ' + Math.round(credits);
  shopItemsEl.innerHTML = '';
  for (const key of Object.keys(UPGRADES)) {
    const u = UPGRADES[key];
    const lvl = upgradeLevel(key);
    const maxed = lvl >= u.costs.length;
    const cost = maxed ? null : u.costs[lvl];

    const row = document.createElement('div');
    row.className = 'shop-item';

    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML =
      '<div class="name">' + u.name + '</div>' +
      '<div class="desc">' + u.desc + '</div>' +
      '<div class="level">LVL ' + lvl + '/' + u.costs.length + '</div>';

    const btn = document.createElement('button');
    if (maxed) {
      btn.textContent = 'MAX';
      btn.disabled = true;
    } else {
      btn.textContent = cost + ' cr';
      btn.disabled = credits < cost;
      btn.addEventListener('click', () => {
        if (credits >= cost) {
          credits -= cost;
          upgradeLevels[key] = lvl + 1;
          u.apply();
          flashMsg(u.name + ' upgraded to LVL ' + (lvl + 1), 2000);
          renderShop();
          updateHUD();
        }
      });
    }

    row.appendChild(info);
    row.appendChild(btn);
    shopItemsEl.appendChild(row);
  }
}

/* ---------- 4. GAME STATE ---------- */
let ship, planets, bullets, enemies, freighters, particles, stars;
let score, credits, gameState, shootCooldown, landCooldown, msgTimer, creditTimer;

function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

function flashMsg(text, dur = 2500) {
  msgEl.textContent = text;
  msgEl.style.opacity = 1;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { msgEl.style.opacity = 0; }, dur);
}

function genStars() {
  stars = [];
  for (let i = 0; i < 340; i++) {
    stars.push({
      x: Math.random() * WORLD_W,
      y: Math.random() * WORLD_H,
      r: Math.random() * 1.2 + 0.2,
      a: Math.random() * 0.6 + 0.3,
      layer: Math.random() < 0.5 ? 0.3 : 0.7,
    });
  }
}

function genPlanets() {
  planets = [];
  for (let i = 0; i < CONFIG.planets.count; i++) {
    let px, py, overlap, tries = 0;
    do {
      overlap = false;
      px = 300 + Math.random() * (WORLD_W - 600);
      py = 200 + Math.random() * (WORLD_H - 400);
      for (const p of planets) {
        if (dist({ x: px, y: py }, p) < CONFIG.planets.minSpacing) { overlap = true; break; }
      }
      tries++;
    } while (overlap && tries < 60);

    planets.push({
      x: px, y: py,
      r: CONFIG.planets.minRadius + Math.random() * CONFIG.planets.maxRadiusExtra,
      mass: CONFIG.planets.minMass + Math.random() * CONFIG.planets.massExtra,
      name: PLANET_NAMES[i],
      fillColor: PLANET_FILLS[i],
      strokeColor: PLANET_STROKES[i],
      owner: null,             // null | 'player' | 'ashkari' | 'pale' | 'vorath'
      building: false,
      revealed: false,
      value: 50 + Math.floor(Math.random() * 80),
      baseHull: 0,             // enemy base health once seized
      turretTimer: 0,          // used by pale turrets AND player colony turrets
    });
  }
}

function init() {
  genStars();
  genPlanets();

  ship = {
    x: planets[0].x - 180,
    y: planets[0].y,
    vx: 0.1, vy: -0.08,
    angle: 0,
    hull: CONFIG.ship.hull,
    maxHull: CONFIG.ship.hull,
    thrust: 0,
    dead: false,
    landing: false,
    landProgress: 0,
    landTarget: null,
    landingPlanet: null,
  };

  bullets = []; enemies = []; freighters = []; particles = [];
  score = 0; credits = 0;
  upgradeLevels = {};
  gameState = 'playing';
  shootCooldown = 0; landCooldown = 0; creditTimer = 0;
  shopOpen = false;
  shopEl.classList.add('hidden');

  planets[0].revealed = true;

  spawnWave(3);
  flashMsg('Scout the sector — three factions want these planets', 3500);
  updateHUD();
}

function spawnWave(n) {
  const types = ['ashkari', 'ashkari', 'pale', 'vorath'];  // ashkari weighted heavier
  for (let i = 0; i < n; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    const fac = CONFIG.factions[type];
    const side = Math.random() < 0.5;
    enemies.push({
      x: side ? WORLD_W * 0.9 + Math.random() * 80 : Math.random() * 80,
      y: Math.random() * WORLD_H,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      angle: 0,
      hull: fac.hull,
      shootTimer: 120 + Math.random() * 150,
      r: 7,
      faction: type,
      targetPlanet: null,
      state: 'hunt',
      landTimer: 0,
      flicker: Math.random() * 100,   // vorath stealth shimmer
    });
  }
}

function spawnFreighter(planet) {
  freighters.push({
    x: ship.x, y: ship.y,
    tx: planet.x, ty: planet.y,
    planet,
    hull: CONFIG.freighter.hull,
    arrived: false,
    r: 9,
  });
  flashMsg('Freighter dispatched to ' + planet.name, 2500);
}

/* ---------- 5. UPDATE ---------- */
function applyGravityTo(obj) {
  for (const p of planets) {
    if (!p.revealed) continue;
    const dx = p.x - obj.x, dy = p.y - obj.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
    const f = Math.min(p.mass / (d * d), CONFIG.gravity.maxPull);
    obj.vx += (dx / d) * f * 0.016;
    obj.vy += (dy / d) * f * 0.016;
  }
}

function spawnPart(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = Math.random() * 2 + 0.3;
    particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 1,
      decay: 0.02 + Math.random() * 0.015,
      color: col,
      r: Math.random() * 2.5 + 0.5,
    });
  }
}

function fireShot(obj, isEnemy) {
  const spd = isEnemy ? CONFIG.enemies.bulletSpeed : CONFIG.ship.bulletSpeed;
  const offset = isEnemy ? obj.r + 5 : 14;
  bullets.push({
    x: obj.x + Math.cos(obj.angle) * offset,
    y: obj.y + Math.sin(obj.angle) * offset,
    vx: Math.cos(obj.angle) * spd + (isEnemy ? obj.vx : ship.vx) * 0.35,
    vy: Math.sin(obj.angle) * spd + (isEnemy ? obj.vy : ship.vy) * 0.35,
    life: 1,
    isEnemy,
    r: isEnemy ? 2.5 : 3,
  });
}

function fireTurretShot(fromX, fromY, target, isEnemy) {
  const a = Math.atan2(target.y - fromY, target.x - fromX);
  bullets.push({
    x: fromX + Math.cos(a) * 8,
    y: fromY + Math.sin(a) * 8,
    vx: Math.cos(a) * 3.4,
    vy: Math.sin(a) * 3.4,
    life: 0.8,
    isEnemy,
    r: 2.5,
  });
}

function updateHUD() {
  document.getElementById('h-hull').textContent = Math.max(0, Math.round(ship.hull));
  document.getElementById('h-score').textContent = score;
  const owned = planets.filter(p => p.owner === 'player').length;
  document.getElementById('h-planets').textContent = owned + '/' + planets.length;
  document.getElementById('h-credits').textContent = 'CREDITS: ' + Math.round(credits);
  document.getElementById('h-enemies').textContent = 'HOSTILES: ' + enemies.length;
  document.getElementById('h-state').textContent =
    ship.dead ? 'HULL BREACH' :
    ship.landing ? 'LANDING...' :
    gameState === 'won' ? 'VICTORY' : 'FLYING';
}

function revealAround(x, y, range) {
  for (const p of planets) {
    if (!p.revealed && dist({ x, y }, p) < range) p.revealed = true;
  }
}

function nearestFlaggablePlanet() {
  let closest = null, closestD = 9999;
  for (const p of planets) {
    if (!p.revealed) continue;
    const d = dist(ship, p);
    if (d < closestD) { closestD = d; closest = p; }
  }
  if (closest && closestD < closest.r + 55) return closest;
  return null;
}

function handleInput() {
  const canControl = !ship.dead && !ship.landing && !shopOpen;

  if ((keys['w'] || keys['W'] || keys['ArrowUp']) && canControl) {
    ship.vx += Math.cos(ship.angle) * CONFIG.ship.thrust * thrustMult();
    ship.vy += Math.sin(ship.angle) * CONFIG.ship.thrust * thrustMult();
    ship.thrust = 1;
  } else ship.thrust = 0;

  if ((keys['a'] || keys['A'] || keys['ArrowLeft']) && canControl) ship.angle -= CONFIG.ship.turnSpeed;
  if ((keys['d'] || keys['D'] || keys['ArrowRight']) && canControl) ship.angle += CONFIG.ship.turnSpeed;

  if (keys[' '] && shootCooldown <= 0 && canControl) {
    fireShot(ship, false);
    shootCooldown = fireCooldown();
  }
  if (shootCooldown > 0) shootCooldown--;

  if ((keys['l'] || keys['L']) && landCooldown <= 0 && canControl) {
    const p = nearestFlaggablePlanet();
    if (p) {
      if (p.owner === 'player') {
        flashMsg(p.name + ' already claimed', 1500); landCooldown = 30;
      } else if (p.owner) {
        flashMsg('Destroy the ' + CONFIG.factions[p.owner].label + ' base first!', 2000); landCooldown = 30;
      } else if (p.building) {
        flashMsg('Freighter already en route to ' + p.name, 1500); landCooldown = 30;
      } else {
        ship.landing = true;
        ship.landingPlanet = p;
        const a = Math.atan2(ship.y - p.y, ship.x - p.x);
        ship.landTarget = {
          x: p.x + Math.cos(a) * (p.r + 12),
          y: p.y + Math.sin(a) * (p.r + 12),
        };
        flashMsg('Flagging ' + p.name + '...', 2500);
      }
    } else { flashMsg('No planet in range', 1500); landCooldown = 30; }
  }
  if (landCooldown > 0) landCooldown--;
}

function updateShip() {
  if (ship.landing) {
    ship.x += (ship.landTarget.x - ship.x) * 0.05;
    ship.y += (ship.landTarget.y - ship.y) * 0.05;
    ship.vx *= 0.82; ship.vy *= 0.82;
    ship.landProgress += 0.007;
    if (ship.landProgress >= 1) {
      ship.landing = false;
      ship.landProgress = 0;
      const lp = ship.landingPlanet;
      lp.building = true;
      spawnFreighter(lp);
      ship.landingPlanet = null;
    }
  } else if (!ship.dead) {
    applyGravityTo(ship);
    ship.x += ship.vx; ship.y += ship.vy;
    ship.vx *= CONFIG.ship.drag; ship.vy *= CONFIG.ship.drag;
    if (ship.thrust) {
      spawnPart(ship.x - Math.cos(ship.angle) * 12, ship.y - Math.sin(ship.angle) * 12, '#e87030', 2);
    }
  }

  ship.x = Math.max(0, Math.min(WORLD_W, ship.x));
  ship.y = Math.max(0, Math.min(WORLD_H, ship.y));

  revealAround(ship.x, ship.y, CONFIG.planets.revealRange);

  // Soft collision with planet surfaces:
  // fast impact = hull breach, slow contact = gentle push-off
  for (const p of planets) {
    if (ship.dead || ship.landing || !p.revealed) continue;
    const d = dist(ship, p);
    if (d < p.r + 2) {
      const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
      if (speed > CONFIG.ship.crashSpeed) {
        ship.dead = true;
        spawnPart(ship.x, ship.y, '#e87a30', 45);
        gameState = 'dead';
        flashMsg('Hull breach — too fast! Click Restart', 9999);
      } else {
        // Slide off the surface: push out along the normal, cancel inward velocity
        const nx = (ship.x - p.x) / d, ny = (ship.y - p.y) / d;
        ship.x = p.x + nx * (p.r + 2.5);
        ship.y = p.y + ny * (p.r + 2.5);
        const inward = ship.vx * -nx + ship.vy * -ny;
        if (inward > 0) { ship.vx += nx * inward; ship.vy += ny * inward; }
      }
    }
  }
}

function updateFreighters() {
  for (const f of freighters) {
    if (f.arrived) continue;
    const dx = f.tx - f.x, dy = f.ty - f.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 8) {
      f.arrived = true;
      f.planet.building = false;
      f.planet.owner = 'player';
      credits += f.planet.value;
      score += 200;
      flashMsg(f.planet.name + ' colonized! +' + f.planet.value + ' credits', 2500);
    } else {
      const spd = freighterSpeed();
      f.x += (dx / d) * spd;
      f.y += (dy / d) * spd;
    }
  }
  freighters = freighters.filter(f => !f.arrived || f.planet.owner === 'player');
}

function updateEconomy() {
  creditTimer++;
  if (creditTimer >= CONFIG.economy.creditTickFrames) {
    creditTimer = 0;
    const bonus = planets.filter(p => p.owner === 'player').length * CONFIG.economy.creditsPerColony;
    if (bonus > 0) credits += bonus;
  }
}

function updateEnemies() {
  for (const e of enemies) {
    applyGravityTo(e);
    const fac = CONFIG.factions[e.faction];

    if (e.state === 'hunt') {
      const unowned = planets.filter(p => !p.owner && !p.building && p.revealed);
      if (!e.targetPlanet || e.targetPlanet.owner) {
        e.targetPlanet = unowned.length > 0
          ? unowned[Math.floor(Math.random() * unowned.length)]
          : null;
      }

      // Aggressive factions sometimes hunt YOU instead of planets
      let tx, ty;
      const distToShip = dist(e, ship);
      if ((!e.targetPlanet || (Math.random() < fac.aggression * 0.02 && distToShip < 500)) && !ship.dead) {
        tx = ship.x; ty = ship.y;
      } else if (e.targetPlanet) {
        tx = e.targetPlanet.x; ty = e.targetPlanet.y;
      } else {
        tx = ship.x; ty = ship.y;
      }

      const dx = tx - e.x, dy = ty - e.y, dd = Math.sqrt(dx * dx + dy * dy);
      e.angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.25;
      if (dd > 100) {
        e.vx += Math.cos(e.angle) * CONFIG.enemies.accel * fac.speedMult;
        e.vy += Math.sin(e.angle) * CONFIG.enemies.accel * fac.speedMult;
      }
      if (e.targetPlanet && dd < e.targetPlanet.r + 50 && !e.targetPlanet.owner) {
        e.state = 'landing';
        e.landTimer = CONFIG.enemies.landTimeFrames;
        flashMsg(fac.label + ' scout approaching ' + e.targetPlanet.name + '!', 2200);
      }
    } else if (e.state === 'landing') {
      e.landTimer--;
      const dx = e.targetPlanet.x - e.x, dy = e.targetPlanet.y - e.y;
      e.vx += dx * 0.002; e.vy += dy * 0.002;
      if (e.targetPlanet.owner) {
        // Someone beat them to it
        e.state = 'hunt'; e.targetPlanet = null;
      } else if (e.landTimer <= 0) {
        e.targetPlanet.owner = e.faction;
        e.targetPlanet.baseHull = CONFIG.planets.baseHull;
        score = Math.max(0, score - 150);
        flashMsg(e.targetPlanet.name + ' seized by ' + fac.label + '!', 2500);
        e.state = 'hunt';
        e.targetPlanet = null;
      }
    }

    // Speed cap (per-faction)
    const maxSpd = CONFIG.enemies.maxSpeed * fac.speedMult;
    const spd = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    if (spd > maxSpd) { e.vx = e.vx / spd * maxSpd; e.vy = e.vy / spd * maxSpd; }
    e.x += e.vx; e.y += e.vy;
    e.x = Math.max(0, Math.min(WORLD_W, e.x));
    e.y = Math.max(0, Math.min(WORLD_H, e.y));

    for (const p of planets) {
      if (dist(e, p) < p.r + e.r + 2) {
        e.x = Math.random() * WORLD_W;
        e.y = Math.random() * WORLD_H;
        e.vx = 0; e.vy = 0;
      }
    }

    e.shootTimer--;
    if (e.shootTimer <= 0 && dist(e, ship) < fac.shootRange && !ship.dead) {
      fireShot(e, true);
      e.shootTimer = 110 + Math.random() * 130;
    }

    e.flicker += 1;
  }
}

function updatePlanetTurrets() {
  for (const p of planets) {
    if (p.turretTimer > 0) p.turretTimer--;

    // Pale Syndicate planets shoot at the player
    if (p.owner === 'pale' && !ship.dead && !ship.landing) {
      if (p.turretTimer <= 0 && dist(p, ship) < p.r + CONFIG.paleTurret.range) {
        fireTurretShot(p.x, p.y, ship, true);
        p.turretTimer = CONFIG.paleTurret.cooldown;
      }
    }

    // Player colonies with the turret upgrade shoot at hostiles
    if (p.owner === 'player' && turretsOwned()) {
      if (p.turretTimer <= 0) {
        let nearest = null, nd = 9999;
        for (const e of enemies) {
          const d = dist(p, e);
          if (d < p.r + turretRange() && d < nd) { nd = d; nearest = e; }
        }
        if (nearest) {
          fireTurretShot(p.x, p.y, nearest, false);
          p.turretTimer = CONFIG.colonyTurret.cooldown;
        }
      }
    }
  }
}

function updateBullets() {
  for (const b of bullets) {
    b.x += b.vx; b.y += b.vy;
    b.life -= 0.006;

    for (const p of planets) {
      if (dist(b, p) < p.r) {
        // Player bullets damage enemy bases
        if (!b.isEnemy && p.owner && p.owner !== 'player') {
          p.baseHull -= 10;
          spawnPart(b.x, b.y, CONFIG.factions[p.owner].color, 6);
          if (p.baseHull <= 0) {
            flashMsg(CONFIG.factions[p.owner].label + ' base on ' + p.name + ' destroyed!', 2500);
            p.owner = null;
            p.baseHull = 0;
            score += 250;
          }
        }
        b.life = 0;
      }
    }
  }

  for (const b of bullets) {
    if (b.isEnemy && !ship.dead && !ship.landing && dist(b, ship) < 11) {
      ship.hull -= 10; b.life = 0;
      spawnPart(ship.x, ship.y, '#e87a30', 10);
      if (ship.hull <= 0) {
        ship.dead = true;
        gameState = 'dead';
        flashMsg('Hull breach — click Restart to try again', 9999);
      }
    } else if (!b.isEnemy) {
      for (const e of enemies) {
        if (dist(b, e) < e.r + 4) {
          e.hull -= 15; b.life = 0;
          spawnPart(e.x, e.y, '#e8b030', 12);
          if (e.hull <= 0) {
            spawnPart(e.x, e.y, CONFIG.factions[e.faction].color, 30);
            score += 150;
            credits += 15;
            e.hull = -999;
          }
          break;
        }
      }
    }
  }

  enemies = enemies.filter(e => e.hull > -900);
  bullets = bullets.filter(b =>
    b.life > 0 && b.x > -100 && b.x < WORLD_W + 100 && b.y > -100 && b.y < WORLD_H + 100
  );
}

function updateParticles() {
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.96; p.vy *= 0.96;
    p.life -= p.decay;
  }
  particles = particles.filter(p => p.life > 0);
}

function checkWinLose() {
  if (enemies.length < CONFIG.enemies.minCount && gameState === 'playing') {
    spawnWave(CONFIG.enemies.waveSize);
    flashMsg('Hostile reinforcements detected!', 2000);
  }

  const counts = { player: 0, ashkari: 0, pale: 0, vorath: 0 };
  for (const p of planets) if (p.owner) counts[p.owner]++;

  if (counts.player >= CONFIG.win.planetsNeeded) {
    gameState = 'won';
    flashMsg('SECTOR SECURED — Victory! Press Restart for a new sector', 9999);
  }
  for (const f of ['ashkari', 'pale', 'vorath']) {
    if (counts[f] >= CONFIG.win.planetsNeeded) {
      gameState = 'dead';
      flashMsg('Sector lost to ' + CONFIG.factions[f].label + ' — Restart to try again', 9999);
    }
  }
}

function updateCamera() {
  cam.x = ship.x - W / 2;
  cam.y = ship.y - H / 2;
  cam.x = Math.max(0, Math.min(WORLD_W - W, cam.x));
  cam.y = Math.max(0, Math.min(WORLD_H - H, cam.y));
}

function update() {
  if (gameState !== 'playing' || shopOpen) return;
  handleInput();
  updateShip();
  updateFreighters();
  updateEconomy();
  updateEnemies();
  updatePlanetTurrets();
  updateBullets();
  updateParticles();
  checkWinLose();
  updateCamera();
  updateHUD();
}

/* ---------- 6. DRAW ---------- */
function drawShip(wx, wy, angle, thrust) {
  const s = worldToScreen(wx, wy);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(angle);
  ctx.strokeStyle = '#7ecfff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(13, 0); ctx.lineTo(-9, -7); ctx.lineTo(-5, 0); ctx.lineTo(-9, 7);
  ctx.closePath(); ctx.stroke();
  if (thrust) {
    ctx.strokeStyle = '#e87a30';
    ctx.beginPath();
    ctx.moveTo(-5, -4); ctx.lineTo(-14 - Math.random() * 6, 0); ctx.lineTo(-5, 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEnemy(e) {
  if (!onScreen(e.x, e.y)) return;
  const s = worldToScreen(e.x, e.y);
  const fac = CONFIG.factions[e.faction];
  ctx.save();

  // Vorath stealth shimmer — they fade in and out
  if (e.faction === 'vorath') {
    ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(e.flicker * 0.03));
  }

  ctx.translate(s.x, s.y);
  ctx.rotate(e.angle);
  ctx.strokeStyle = fac.color;
  ctx.lineWidth = 1.5;

  if (e.faction === 'pale') {
    // Bulkier hull shape for the fortified faction
    ctx.beginPath();
    ctx.moveTo(e.r + 4, 0); ctx.lineTo(0, -e.r); ctx.lineTo(-e.r, -e.r * 0.5);
    ctx.lineTo(-e.r, e.r * 0.5); ctx.lineTo(0, e.r);
    ctx.closePath(); ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(e.r + 4, 0); ctx.lineTo(-e.r, -e.r * 0.8); ctx.lineTo(-e.r * 0.5, 0); ctx.lineTo(-e.r, e.r * 0.8);
    ctx.closePath(); ctx.stroke();
  }

  ctx.restore();
}

function drawFreighter(f) {
  if (!onScreen(f.x, f.y)) return;
  const s = worldToScreen(f.x, f.y);
  const a = Math.atan2(f.ty - f.y, f.tx - f.x);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(a);
  ctx.strokeStyle = '#7ed4a0';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-10, -5, 20, 10);
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(14, -4); ctx.lineTo(14, 4);
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}

function ownerStroke(p) {
  if (p.owner === 'player') return '#2adf6e';
  if (p.owner) return CONFIG.factions[p.owner].color;
  return p.strokeColor;
}

function ownerFill(p) {
  if (p.owner === 'player') return '#1a5e35';
  if (p.owner === 'ashkari') return '#5e1a1a';
  if (p.owner === 'pale') return '#1a4a5e';
  if (p.owner === 'vorath') return '#3a1a5e';
  return p.fillColor;
}

function drawPlanets() {
  for (const p of planets) {
    if (!onScreen(p.x, p.y, p.r + 60)) continue;
    const sc = worldToScreen(p.x, p.y);

    if (!p.revealed) {
      ctx.fillStyle = 'rgba(30,50,70,0.25)';
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, p.r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // Gravity rings
    ctx.strokeStyle = 'rgba(30,100,160,0.08)';
    ctx.lineWidth = 1;
    for (let r = p.r + 25; r < p.r + 130; r += 38) {
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Body
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = ownerFill(p);
    ctx.fill();
    ctx.strokeStyle = ownerStroke(p);
    ctx.lineWidth = p.owner ? 2 : 1;
    ctx.stroke();

    // Enemy base health bar
    if (p.owner && p.owner !== 'player') {
      const bw = p.r * 1.4;
      const frac = p.baseHull / CONFIG.planets.baseHull;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 8, bw, 4);
      ctx.fillStyle = CONFIG.factions[p.owner].color;
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 8, bw * frac, 4);
    }

    // Pale turret range hint when you're close
    if (p.owner === 'pale' && dist(ship, p) < p.r + CONFIG.paleTurret.range + 60) {
      ctx.save();
      ctx.strokeStyle = 'rgba(42,184,214,0.2)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, p.r + CONFIG.paleTurret.range, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Building spinner
    if (p.building) {
      ctx.strokeStyle = 'rgba(42,159,214,0.5)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, p.r + 10, -Math.PI / 2, -Math.PI / 2 + (Date.now() % 4000 / 4000) * Math.PI * 2);
      ctx.stroke();
    }

    // Player colony turret indicator
    if (p.owner === 'player' && turretsOwned()) {
      ctx.fillStyle = '#2adf6e';
      ctx.beginPath();
      ctx.arc(sc.x, sc.y - p.r - 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Labels
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = p.owner === 'player' ? '#5dffaa' : p.owner ? CONFIG.factions[p.owner].color : p.strokeColor;
    ctx.fillText(p.name, sc.x, sc.y - p.r - 8);
    if (p.owner === 'player') ctx.fillText('YOUR COLONY', sc.x, sc.y - p.r - 20);
    else if (p.owner) ctx.fillText(CONFIG.factions[p.owner].label, sc.x, sc.y - p.r - 20);
    else if (p.building) ctx.fillText('FREIGHTER EN ROUTE', sc.x, sc.y - p.r - 20);
  }
}

function drawLandingPrompt() {
  if (ship.dead || ship.landing || gameState !== 'playing') return;
  const p = nearestFlaggablePlanet();
  if (!p || p.building) return;

  const s = worldToScreen(ship.x, ship.y);
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  if (!p.owner) {
    ctx.fillStyle = '#7ef0ff';
    ctx.fillText('PRESS L TO FLAG ' + p.name, s.x, s.y - 22);
  } else if (p.owner !== 'player') {
    ctx.fillStyle = CONFIG.factions[p.owner].color;
    ctx.fillText('ENEMY BASE — SHOOT IT TO RECLAIM', s.x, s.y - 22);
  }
}

function drawMinimap() {
  const mw = 130, mh = 88, mx = W - mw - 10, my = H - mh - 10;
  ctx.fillStyle = 'rgba(7,9,15,0.85)';
  ctx.fillRect(mx, my, mw, mh);
  ctx.strokeStyle = '#1a3050';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(mx, my, mw, mh);

  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  for (const p of planets) {
    const px = mx + p.x * sx, py = my + p.y * sy;
    if (!p.revealed) {
      ctx.fillStyle = '#1a2535';
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.fillStyle = p.owner === 'player' ? '#2adf6e' : p.owner ? CONFIG.factions[p.owner].color : p.strokeColor;
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = '#7ecfff';
  ctx.fillRect(mx + ship.x * sx - 1.5, my + ship.y * sy - 1.5, 3, 3);

  ctx.strokeStyle = 'rgba(100,180,255,0.3)';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(mx + cam.x * sx, my + cam.y * sy, W * sx, H * sy);

  ctx.fillStyle = '#445566';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('MAP', mx + 3, my + 10);
}

function draw() {
  ctx.fillStyle = '#07090f';
  ctx.fillRect(0, 0, W, H);

  for (const s of stars) {
    let px = (s.x - cam.x * s.layer) % W;
    let py = (s.y - cam.y * s.layer) % H;
    if (px < 0) px += W;
    if (py < 0) py += H;
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, py, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  drawPlanets();

  for (const f of freighters) if (!f.arrived) drawFreighter(f);

  for (const b of bullets) {
    if (!onScreen(b.x, b.y, 10)) continue;
    const s = worldToScreen(b.x, b.y);
    ctx.save();
    ctx.globalAlpha = Math.min(1, b.life + 0.2);
    ctx.beginPath();
    ctx.arc(s.x, s.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = b.isEnemy ? '#e85050' : '#7ef0ff';
    ctx.fill();
    ctx.restore();
  }

  for (const e of enemies) drawEnemy(e);

  for (const p of particles) {
    if (!onScreen(p.x, p.y, 10)) continue;
    const s = worldToScreen(p.x, p.y);
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.beginPath();
    ctx.arc(s.x, s.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.restore();
  }

  if (!ship.dead) drawShip(ship.x, ship.y, ship.angle, ship.thrust);

  drawLandingPrompt();
  drawMinimap();
}

/* ---------- 7. LOOP ---------- */
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

init();
loop();
