/* ============================================================
   GRAVITY WELL: RECLAIMED — Phase 4.0 "The Economy"
   Single-player. Vanilla JS + Canvas. No dependencies.

   New in Phase 4.0 (straight from the original manual):
     - TWO-TIER MATERIALS: Colonies produce RAW materials.
       Bases convert raw into FINISHED materials.
     - FREIGHTERS ARE REAL UNITS: they load raw cargo at your
       colonies, fly to the target, and are CONSUMED when they
       construct a Base or Colony. Full cargo required.
     - Later structures (Platform, Lab, Sensor) are built by the
       Base itself, consuming finished materials.
     - LABS BUILD SHIPS: new fighters and freighters are produced
       by labs using finished materials.
     - ENEMY FACTIONS RUN THE SAME ECONOMY: their freighters fly
       real supply lines you can intercept. Destroy a faction's
       colonies, labs, and freighters and their expansion halts —
       the classic Gravity Well strategy, now fully real.
     - All freighters are neutral gray (commercial vessels),
       with a cargo bar, just like the original.
   ============================================================ */

/* ---------- 1. CONFIG & STRUCTURES ---------- */
const CONFIG = {
  world: { w: 2800, h: 1900 },
  ship: {
    thrust: 0.07,
    turnSpeed: 0.04,
    drag: 0.998,
    hull: 100,
    shootCooldown: 14,
    bulletSpeed: 5.5,
    crashSpeed: 1.3,        // impact above this = destruction
    landSpeed: 0.55,        // at or below this (nose out) = safe landing
    repairRate: 0.09,       // hull repaired per frame while landed at your base
    repairCost: 0.025,      // finished materials consumed per frame of repair
  },
  research: {
    ratePerLab: 0.00013,    // labs work cooperatively — more labs, faster tech
  },
  gravity: { maxPull: 0.55 },
  planets: {
    count: 7,
    minRadius: 42,
    maxRadiusExtra: 16,
    minMass: 1500,
    massExtra: 500,
    revealRange: 260,
  },
  materials: {
    cap: 100,               // max raw or finished stored per planet
    rawRate: 0.035,         // raw produced per frame by a Colony
    convertRate: 0.028,     // raw -> finished per frame by a Base
    buildDrain: 0.045,      // finished consumed per frame while Base constructs
    baseBuildRate: 0.0011,  // construction progress per frame (Base-built structures)
  },
  freighterUnit: {
    speed: 0.6,
    hull: 60,
    cargoCap: 100,
    loadRate: 0.5,          // cargo transfer per frame while loading
    cost: 40,               // finished materials to build one
    maxPerFaction: 3,
    attackRange: 190,
    attackCooldown: 80,
  },
  fighterUnit: {
    cost: 30,               // finished materials per fighter
    maxSpeed: 1.5,
    accel: 0.035,
    bulletSpeed: 3.2,
    perLabCap: 2,
    baseCap: 2,
  },
  production: { checkFrames: 240 },   // how often labs try to build ships
  aiFlagFrames: 420,                  // how often AI factions pick expansion targets
  factions: {
    ashkari: { hull: 40, shootRange: 350, aggression: 0.9,  speedMult: 1.0,  color: '#e85850', label: 'ASHKARI' },
    pale:    { hull: 70, shootRange: 300, aggression: 0.3,  speedMult: 0.7,  color: '#2ab8d6', label: 'PALE SYNDICATE' },
    vorath:  { hull: 30, shootRange: 250, aggression: 0.2,  speedMult: 1.25, color: '#9f6ad6', label: 'VORATH' },
  },
  highport: { range: 250, cooldown: 95 },   // orbital defense garrison
  comm:     { range: 300 },                 // comm center radar reach
  sensor:   { range: 430 },                 // sensor array radar reach
  drone:    { orbit: 58, range: 240, cooldown: 55, hp: 25 },
  win: { planetsNeeded: 5 },
};

// Freighters construct the first three (consumed each time, per the manual):
// Base, Colony, High Port. Then the Base builds Lab and Comm Center on the
// ground, and the High Port builds Space Dock and Sensor Array in orbit.
const BUILD_ORDER = ['base', 'colony', 'highport', 'lab', 'comm', 'spacedock', 'sensor'];
const FREIGHTER_BUILT = 3;

const PLANETARY = ['base', 'colony', 'lab', 'comm'];          // fixed ground slots
const ORBITAL   = ['highport', 'spacedock', 'sensor'];        // orbit the planet

const STRUCTS = {
  base:      { name: 'BASE',         hp: 130, w: 20, h: 13 },
  colony:    { name: 'COLONY',       hp: 100, w: 24, h: 15 },
  highport:  { name: 'HIGH PORT',    hp: 120, w: 28, h: 9 },
  lab:       { name: 'LAB',          hp: 80,  w: 17, h: 17 },
  comm:      { name: 'COMM CENTER',  hp: 70,  w: 14, h: 12 },
  spacedock: { name: 'SPACE DOCK',   hp: 90,  w: 14, h: 14 },
  sensor:    { name: 'SENSOR ARRAY', hp: 60,  w: 12, h: 12 },
};

// Ground slot angles for the four planetary structures
const GROUND_ANGLES = { base: -1.5708, colony: 0, lab: 1.5708, comm: 3.1416 };
// Orbital offsets: Space Dock and Sensor Array trail their High Port
const ORBIT_OFFSET = { highport: 0, spacedock: 0.55, sensor: 1.1 };

const PLANET_NAMES   = ['HOME', 'KETH-7', 'VORA-2', 'SELUN', 'DRAXI', 'MIRATH', 'TANIS'];
const PLANET_FILLS   = ['#1a3a5e', '#3a1a1a', '#1a3a5e', '#2e1a3a', '#1a3a2a', '#3a2e1a', '#1a2e3a'];
const PLANET_STROKES = ['#2a9fd6', '#d6442a', '#2ab8d6', '#9f6ad6', '#2ad67a', '#d6a02a', '#2ad6c2'];

const FACTION_LIST = ['player', 'ashkari', 'pale', 'vorath'];

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
function onScreen(wx, wy, margin = 100) {
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
    apply: () => {},
  },
  hull: {
    name: 'Reinforced Hull',
    desc: '+25 max hull and full repair',
    costs: [80, 160, 320],
    apply: () => { ship.maxHull += 25; ship.hull = ship.maxHull; },
  },
  weapons: {
    name: 'Rapid Cannons',
    desc: 'Faster fire rate per level',
    costs: [120, 240, 480],
    apply: () => {},
  },
  freighter: {
    name: 'Freighter Engines',
    desc: 'Your freighters travel faster',
    costs: [100, 200],
    apply: () => {},
  },
  construction: {
    name: 'Rapid Construction',
    desc: 'Bases build structures faster',
    costs: [120, 240],
    apply: () => {},
  },
};

let upgradeLevels = {};

function upgradeLevel(key) { return upgradeLevels[key] || 0; }
function thrustMult()     { return 1 + upgradeLevel('engine') * 0.25; }
function fireCooldown()   { return Math.max(6, CONFIG.ship.shootCooldown - upgradeLevel('weapons') * 3); }
function freighterSpd(owner) {
  let s = CONFIG.freighterUnit.speed;
  if (owner === 'player') s *= (1 + upgradeLevel('freighter') * 0.5);
  return s;
}
function baseBuildRate(owner) {
  let r = CONFIG.materials.baseBuildRate;
  if (owner === 'player') r *= (1 + upgradeLevel('construction') * 0.5);
  return r;
}

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
let ship, planets, bullets, enemies, freighters, drones, particles, stars;
let score, credits, gameState, shootCooldown, landCooldown, msgTimer;
let productionTimer, aiFlagTimer;
let researchProgress, researchReady;

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

function newPlanet(i, px, py) {
  return {
    x: px, y: py,
    r: CONFIG.planets.minRadius + Math.random() * CONFIG.planets.maxRadiusExtra,
    mass: CONFIG.planets.minMass + Math.random() * CONFIG.planets.massExtra,
    name: PLANET_NAMES[i],
    fillColor: PLANET_FILLS[i],
    strokeColor: PLANET_STROKES[i],
    owner: null,
    flaggedBy: null,          // faction that has claimed intent
    revealed: false,
    structures: {},
    buildIndex: 0,
    buildProgress: 0,
    turretTimer: 0,
    orbitAng: Math.random() * Math.PI * 2,   // rotation of orbital structures
    raw: 0,
    finished: 0,
  };
}

function genPlanets() {
  planets = [];
  const homes = [
    [0.14, 0.72],
    [0.86, 0.20],
    [0.85, 0.80],
    [0.18, 0.14],
  ];
  for (let i = 0; i < 4; i++) {
    planets.push(newPlanet(i, homes[i][0] * WORLD_W, homes[i][1] * WORLD_H));
  }
  for (let i = 4; i < CONFIG.planets.count; i++) {
    let px, py, overlap, tries = 0;
    do {
      overlap = false;
      px = WORLD_W * 0.28 + Math.random() * WORLD_W * 0.44;
      py = WORLD_H * 0.2 + Math.random() * WORLD_H * 0.6;
      for (const p of planets) {
        if (dist({ x: px, y: py }, p) < 340) { overlap = true; break; }
      }
      tries++;
    } while (overlap && tries < 80);
    planets.push(newPlanet(i, px, py));
  }
}

function addStructure(p, type) {
  p.structures[type] = { hp: STRUCTS[type].hp, maxHp: STRUCTS[type].hp };
}

function structCount(p) { return Object.keys(p.structures).length; }

function setupHome(p, owner) {
  p.owner = owner;
  p.flaggedBy = null;
  p.structures = {};
  addStructure(p, 'base');
  addStructure(p, 'colony');
  addStructure(p, 'highport');
  p.buildIndex = 3;           // next up: lab
  p.buildProgress = 0;
  p.raw = 60;
  p.finished = 50;
  p.revealed = (owner === 'player');
}

function structPos(p, type) {
  if (PLANETARY.includes(type)) {
    const a = GROUND_ANGLES[type];
    return {
      x: p.x + Math.cos(a) * (p.r + 24),
      y: p.y + Math.sin(a) * (p.r + 24),
    };
  }
  // Orbital: High Port leads, Space Dock and Sensor Array trail behind it
  const a = p.orbitAng + ORBIT_OFFSET[type];
  return {
    x: p.x + Math.cos(a) * (p.r + 58),
    y: p.y + Math.sin(a) * (p.r + 58),
  };
}

function init() {
  genStars();
  genPlanets();

  setupHome(planets[0], 'player');
  setupHome(planets[1], 'ashkari');
  setupHome(planets[2], 'pale');
  setupHome(planets[3], 'vorath');

  ship = {
    x: planets[0].x - 170,
    y: planets[0].y - 60,
    vx: 0.1, vy: -0.05,
    angle: 0,
    hull: CONFIG.ship.hull,
    maxHull: CONFIG.ship.hull,
    thrust: 0,
    dead: false,
    landedOn: null,          // planet the fighter is currently landed on
  };

  bullets = []; enemies = []; freighters = []; drones = []; particles = [];
  score = 0; credits = 100;
  upgradeLevels = {};
  researchProgress = 0;
  researchReady = null;
  gameState = 'playing';
  shootCooldown = 0; landCooldown = 0;
  productionTimer = 0; aiFlagTimer = 0;
  shopOpen = false;
  shopEl.classList.add('hidden');

  // Every faction begins with one freighter and two fighters
  for (let i = 0; i < 4; i++) {
    spawnFreighterUnit(FACTION_LIST[i], planets[i]);
  }
  spawnFighter('ashkari', planets[1]);
  spawnFighter('ashkari', planets[1]);
  spawnFighter('pale',    planets[2]);
  spawnFighter('pale',    planets[2]);
  spawnFighter('vorath',  planets[3]);
  spawnFighter('vorath',  planets[3]);

  flashMsg('HOME is secure. Colonies make RAW, bases make FINISHED. Expand!', 4000);
  updateHUD();
}

function spawnFighter(faction, nearPlanet) {
  const fac = CONFIG.factions[faction];
  const a = Math.random() * Math.PI * 2;
  const d = nearPlanet.r + 90 + Math.random() * 60;
  enemies.push({
    x: nearPlanet.x + Math.cos(a) * d,
    y: nearPlanet.y + Math.sin(a) * d,
    vx: (Math.random() - 0.5) * 0.5,
    vy: (Math.random() - 0.5) * 0.5,
    angle: 0,
    hull: fac.hull,
    shootTimer: 120 + Math.random() * 150,
    r: 7,
    faction,
    targetPlanet: null,
    targetFreighter: null,
    flicker: Math.random() * 100,
  });
}

function spawnFreighterUnit(owner, nearPlanet) {
  const a = Math.random() * Math.PI * 2;
  freighters.push({
    x: nearPlanet.x + Math.cos(a) * (nearPlanet.r + 40),
    y: nearPlanet.y + Math.sin(a) * (nearPlanet.r + 40),
    owner,
    cargo: 0,
    state: 'idle',            // idle | toColony | loading | toTarget
    target: null,             // planet reference
    hull: CONFIG.freighterUnit.hull,
    maxHull: CONFIG.freighterUnit.hull,
    r: 9,
    shootTimer: 0,
    angle: 0,
  });
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
  const spd = isEnemy ? CONFIG.fighterUnit.bulletSpeed : CONFIG.ship.bulletSpeed;
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

function fireAimedShot(fromX, fromY, target, isEnemy, spawnOffset = 12) {
  const a = Math.atan2(target.y - fromY, target.x - fromX);
  bullets.push({
    x: fromX + Math.cos(a) * spawnOffset,
    y: fromY + Math.sin(a) * spawnOffset,
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

  let raw = 0, fin = 0;
  for (const p of planets) {
    if (p.owner === 'player') { raw += p.raw; fin += p.finished; }
  }
  document.getElementById('h-credits').textContent =
    'CR ' + Math.round(credits) + ' · RAW ' + Math.round(raw) + ' · FIN ' + Math.round(fin);
  document.getElementById('h-enemies').textContent = 'HOSTILES: ' + enemies.length;
  document.getElementById('h-state').textContent =
    ship.dead ? 'HULL BREACH' :
    ship.landedOn ? 'LANDED' :
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
  if (closest && closestD < closest.r + 60) return closest;
  return null;
}

function handleInput() {
  const canControl = !ship.dead && !shopOpen;

  if ((keys['w'] || keys['W'] || keys['ArrowUp']) && canControl) {
    if (ship.landedOn) {
      // Lift off: push away from the surface
      const p = ship.landedOn;
      const a = Math.atan2(ship.y - p.y, ship.x - p.x);
      ship.landedOn = null;
      ship.vx = Math.cos(a) * 0.9;
      ship.vy = Math.sin(a) * 0.9;
      ship.angle = a;
    }
    ship.vx += Math.cos(ship.angle) * CONFIG.ship.thrust * thrustMult();
    ship.vy += Math.sin(ship.angle) * CONFIG.ship.thrust * thrustMult();
    ship.thrust = 1;
  } else ship.thrust = 0;

  if ((keys['a'] || keys['A'] || keys['ArrowLeft']) && canControl && !ship.landedOn) ship.angle -= CONFIG.ship.turnSpeed;
  if ((keys['d'] || keys['D'] || keys['ArrowRight']) && canControl && !ship.landedOn) ship.angle += CONFIG.ship.turnSpeed;

  if (keys[' '] && shootCooldown <= 0 && canControl && !ship.landedOn) {
    fireShot(ship, false);
    shootCooldown = fireCooldown();
  }
  if (shootCooldown > 0) shootCooldown--;
}

function updateShip() {
  if (ship.landedOn) {
    // Pinned to the surface, nose out
    const p = ship.landedOn;
    const a = ship.angle;
    ship.x = p.x + Math.cos(a) * (p.r + 8);
    ship.y = p.y + Math.sin(a) * (p.r + 8);
    ship.vx = 0; ship.vy = 0;

    // Repairs at your own base, consuming finished materials
    if (p.owner === 'player' && p.structures.base && ship.hull < ship.maxHull && p.finished > 0.1) {
      ship.hull = Math.min(ship.maxHull, ship.hull + CONFIG.ship.repairRate);
      p.finished = Math.max(0, p.finished - CONFIG.ship.repairCost);
    }

    // Install lab research when landed at a base
    if (researchReady && p.owner === 'player' && p.structures.base) {
      const u = UPGRADES[researchReady];
      upgradeLevels[researchReady] = upgradeLevel(researchReady) + 1;
      u.apply();
      flashMsg('Labs installed ' + u.name + ' LVL ' + upgradeLevel(researchReady) + '!', 3000);
      researchReady = null;
      researchProgress = 0;
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

  // Surface contact: the original's landing rules.
  // Too fast = destruction. Slow + nose pointing away = safe landing.
  // Slow-ish but wrong rotation or slightly hot = damage and bounce.
  for (const p of planets) {
    if (ship.dead || ship.landedOn || !p.revealed) continue;
    const d = dist(ship, p);
    if (d < p.r + 2) {
      const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
      const outward = Math.atan2(ship.y - p.y, ship.x - p.x);
      let rotDiff = Math.abs(((ship.angle - outward) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      const noseOut = rotDiff < 0.9;

      if (speed > CONFIG.ship.crashSpeed) {
        ship.dead = true;
        spawnPart(ship.x, ship.y, '#e87a30', 45);
        gameState = 'dead';
        flashMsg('Hull breach — too fast! Click Restart', 9999);
      } else if (speed <= CONFIG.ship.landSpeed && noseOut) {
        // TOUCHDOWN
        ship.landedOn = p;
        ship.angle = outward;
        ship.x = p.x + Math.cos(outward) * (p.r + 8);
        ship.y = p.y + Math.sin(outward) * (p.r + 8);
        ship.vx = 0; ship.vy = 0;
        if (!p.owner && p.flaggedBy !== 'player') {
          p.flaggedBy = 'player';
          flashMsg('Touchdown on ' + p.name + ' — flag planted, freighters inbound!', 3000);
        } else if (p.owner === 'player') {
          flashMsg('Docked at ' + p.name + (p.structures.base ? ' — repairing' : ''), 2000);
        } else {
          flashMsg('Landed on ' + p.name, 1500);
        }
      } else {
        // Rough contact: damage and bounce, settle toward correct orientation
        ship.hull -= noseOut ? 6 : 10;
        spawnPart(ship.x, ship.y, '#e8b030', 10);
        const nx = (ship.x - p.x) / d, ny = (ship.y - p.y) / d;
        ship.x = p.x + nx * (p.r + 3);
        ship.y = p.y + ny * (p.r + 3);
        const inward = ship.vx * -nx + ship.vy * -ny;
        if (inward > 0) {
          ship.vx += nx * inward * 1.4;
          ship.vy += ny * inward * 1.4;
        }
        ship.angle = outward;   // the ship "often settles to the proper orientation"
        if (ship.hull <= 0) {
          ship.dead = true;
          gameState = 'dead';
          flashMsg('Hull breach — click Restart to try again', 9999);
        } else {
          flashMsg(noseOut ? 'Too fast — bleed off more speed' : 'Bad rotation — nose away from the planet', 1800);
        }
      }
    }
  }
}

/* --- The materials economy --- */
function updateMaterials() {
  const M = CONFIG.materials;
  for (const p of planets) {
    p.orbitAng += 0.006;    // orbital structures circle the planet
    if (!p.owner) continue;

    // Colonies produce raw materials
    if (p.structures.colony) {
      p.raw = Math.min(M.cap, p.raw + M.rawRate);
    }
    // Bases convert raw into finished; a High Port doubles conversion capacity
    if (p.structures.base && p.raw > 0 && p.finished < M.cap) {
      let rate = M.convertRate;
      if (p.structures.highport) rate *= 2;
      const amt = Math.min(rate, p.raw);
      p.raw -= amt;
      p.finished = Math.min(M.cap, p.finished + amt);
    }
    // Construction of later structures consumes finished materials.
    // Lab and Comm Center are built by the Base; Space Dock and Sensor
    // Array are built by the High Port — each must still be standing.
    if (p.buildIndex >= FREIGHTER_BUILT && p.buildIndex < BUILD_ORDER.length) {
      const type = BUILD_ORDER[p.buildIndex];
      const builder = PLANETARY.includes(type) ? 'base' : 'highport';
      if (p.structures[builder] && p.finished > M.buildDrain) {
        p.finished -= M.buildDrain;
        p.buildProgress += baseBuildRate(p.owner);
        if (p.buildProgress >= 1) {
          addStructure(p, type);
          p.buildIndex++;
          p.buildProgress = 0;
          if (p.owner === 'player') {
            flashMsg(STRUCTS[type].name + ' completed on ' + p.name, 2000);
            if (type === 'lab') spawnDrone(p);
          }
        }
      }
    }
  }
}

/* --- Labs produce fighters and freighters from finished materials --- */
function updateProduction() {
  productionTimer++;
  if (productionTimer < CONFIG.production.checkFrames) return;
  productionTimer = 0;

  for (const facName of FACTION_LIST) {
    // Labs and Space Docks both construct ships
    const shipyards = planets.filter(p =>
      p.owner === facName && (p.structures.lab || p.structures.spacedock)
    );
    if (shipyards.length === 0) continue;

    // Freighters first — expansion is life
    const myFreighters = freighters.filter(f => f.owner === facName).length;
    if (myFreighters < CONFIG.freighterUnit.maxPerFaction) {
      const src = shipyards.find(p => p.finished >= CONFIG.freighterUnit.cost);
      if (src) {
        src.finished -= CONFIG.freighterUnit.cost;
        spawnFreighterUnit(facName, src);
        if (facName === 'player') flashMsg('New freighter constructed at ' + src.name, 2000);
      }
    }

    // Then fighters (enemy factions only — you ARE your fighter)
    if (facName !== 'player') {
      const alive = enemies.filter(e => e.faction === facName).length;
      const cap = CONFIG.fighterUnit.baseCap + shipyards.length * CONFIG.fighterUnit.perLabCap;
      if (alive < cap) {
        const src = shipyards.find(p => p.finished >= CONFIG.fighterUnit.cost);
        if (src) {
          src.finished -= CONFIG.fighterUnit.cost;
          spawnFighter(facName, src);
        }
      }
    }
  }
}

/* --- AI factions choose expansion targets --- */
function updateAiFlags() {
  aiFlagTimer++;
  if (aiFlagTimer < CONFIG.aiFlagFrames) return;
  aiFlagTimer = 0;

  for (const facName of ['ashkari', 'pale', 'vorath']) {
    // Can this faction even expand? Needs at least one freighter or the means to build one
    const hasFreighter = freighters.some(f => f.owner === facName);
    const hasEconomy = planets.some(p => p.owner === facName && p.structures.colony);
    if (!hasFreighter && !hasEconomy) continue;

    const alreadyFlagging = planets.some(p => p.flaggedBy === facName && !p.owner);
    if (alreadyFlagging) continue;

    const neutral = planets.filter(p => !p.owner && !p.flaggedBy);
    if (neutral.length > 0) {
      const pick = neutral[Math.floor(Math.random() * neutral.length)];
      pick.flaggedBy = facName;
    }
  }
}

/* --- Freighter unit AI: load raw cargo, deliver, be consumed building --- */
function updateFreighters() {
  for (const f of freighters) {
    const spd = freighterSpd(f.owner);

    if (f.state === 'idle') {
      if (f.cargo >= CONFIG.freighterUnit.cargoCap) {
        // Full: find a construction target
        let target = planets.find(p => p.flaggedBy === f.owner && !p.owner);
        if (!target) {
          target = planets.find(p =>
            p.owner === f.owner && p.buildIndex < FREIGHTER_BUILT
          );
        }
        if (target) { f.target = target; f.state = 'toTarget'; }
        // else: stay idle, loaded and ready
      } else {
        // Not full: find a colony with raw materials to load from
        let best = null, bd = Infinity;
        for (const p of planets) {
          if (p.owner === f.owner && p.structures.colony && p.raw > 5) {
            const d = dist(f, p);
            if (d < bd) { bd = d; best = p; }
          }
        }
        if (best) { f.target = best; f.state = 'toColony'; }
      }
    } else if (f.state === 'toColony') {
      const p = f.target;
      if (!p || p.owner !== f.owner || !p.structures.colony) { f.state = 'idle'; f.target = null; }
      else {
        moveToward(f, p, spd);
        if (dist(f, p) < p.r + 34) f.state = 'loading';
      }
    } else if (f.state === 'loading') {
      const p = f.target;
      if (!p || p.owner !== f.owner || !p.structures.colony) { f.state = 'idle'; f.target = null; }
      else {
        const amt = Math.min(CONFIG.freighterUnit.loadRate, p.raw,
                             CONFIG.freighterUnit.cargoCap - f.cargo);
        p.raw -= amt;
        f.cargo += amt;
        if (f.cargo >= CONFIG.freighterUnit.cargoCap) { f.state = 'idle'; f.target = null; }
        else if (p.raw <= 0.5) { f.state = 'idle'; f.target = null; }  // well ran dry, re-evaluate
      }
    } else if (f.state === 'toTarget') {
      const p = f.target;
      const stillValid = p && (
        (p.flaggedBy === f.owner && !p.owner) ||
        (p.owner === f.owner && p.buildIndex < FREIGHTER_BUILT)
      );
      if (!stillValid) { f.state = 'idle'; f.target = null; }
      else {
        moveToward(f, p, spd);
        if (dist(f, p) < p.r + 30) {
          // CONSTRUCTION: the freighter and its cargo are consumed
          if (!p.owner) {
            p.owner = f.owner;
            p.flaggedBy = null;
            addStructure(p, 'base');
            p.buildIndex = 1;
            p.buildProgress = 0;
            if (f.owner === 'player') {
              credits += 60;
              score += 200;
              flashMsg('Freighter consumed — BASE constructed on ' + p.name + '!', 2500);
            } else if (p.revealed) {
              flashMsg(CONFIG.factions[f.owner].label + ' built a base on ' + p.name, 2500);
            }
          } else {
            addStructure(p, 'colony');
            p.buildIndex = 2;
            p.buildProgress = 0;
            if (f.owner === 'player') {
              score += 150;
              flashMsg('Freighter consumed — COLONY constructed on ' + p.name, 2500);
            }
          }
          spawnPart(f.x, f.y, '#b8c8d0', 25);
          f.hull = -999;   // consumed
        }
      }
    }

    // Light defensive gun
    if (f.shootTimer > 0) f.shootTimer--;
    if (f.shootTimer <= 0 && f.hull > 0) {
      if (f.owner === 'player') {
        let nearest = null, nd = Infinity;
        for (const e of enemies) {
          const ed = dist(f, e);
          if (ed < CONFIG.freighterUnit.attackRange && ed < nd) { nd = ed; nearest = e; }
        }
        if (nearest) {
          fireAimedShot(f.x, f.y, nearest, false, f.r + 6);
          f.shootTimer = CONFIG.freighterUnit.attackCooldown;
        }
      } else if (!ship.dead && dist(f, ship) < CONFIG.freighterUnit.attackRange) {
        fireAimedShot(f.x, f.y, ship, true, f.r + 6);
        f.shootTimer = CONFIG.freighterUnit.attackCooldown;
      }
    }
  }

  freighters = freighters.filter(f => f.hull > -900);
}

function moveToward(obj, target, spd) {
  const dx = target.x - obj.x, dy = target.y - obj.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 1) {
    obj.x += (dx / d) * spd;
    obj.y += (dy / d) * spd;
    obj.angle = Math.atan2(dy, dx);
  }
}

function spawnDrone(p) {
  drones.push({
    planet: p,
    ang: Math.random() * Math.PI * 2,
    hp: CONFIG.drone.hp,
    shootTimer: 0,
  });
}

function updateDrones() {
  for (const d of drones) {
    if (d.planet.owner !== 'player' || !d.planet.structures.lab) { d.hp = -1; continue; }
    d.ang += 0.02;
    d.x = d.planet.x + Math.cos(d.ang) * (d.planet.r + CONFIG.drone.orbit);
    d.y = d.planet.y + Math.sin(d.ang) * (d.planet.r + CONFIG.drone.orbit);

    if (d.shootTimer > 0) d.shootTimer--;
    if (d.shootTimer <= 0) {
      let nearest = null, nd = Infinity;
      for (const e of enemies) {
        const ed = dist(d, e);
        if (ed < CONFIG.drone.range && ed < nd) { nd = ed; nearest = e; }
      }
      if (nearest) {
        fireAimedShot(d.x, d.y, nearest, false, 6);
        d.shootTimer = CONFIG.drone.cooldown;
      }
    }
  }
  drones = drones.filter(d => d.hp > 0);
}

function updateEnemies() {
  for (const e of enemies) {
    applyGravityTo(e);
    const fac = CONFIG.factions[e.faction];

    // Priority 1: intercept enemy (player) freighters nearby
    if (!e.targetFreighter || e.targetFreighter.hull <= 0) {
      e.targetFreighter = null;
      if (Math.random() < fac.aggression * 0.03) {
        for (const f of freighters) {
          if (f.owner === 'player' && dist(e, f) < 420) { e.targetFreighter = f; break; }
        }
      }
    }

    // Priority 2: escort own expansion / raid player planets
    if (!e.targetFreighter) {
      if (!e.targetPlanet ||
          (e.targetPlanet.owner && e.targetPlanet.owner !== 'player' && e.targetPlanet.owner !== e.faction)) {
        const flagged = planets.filter(p => p.flaggedBy === e.faction && !p.owner);
        const yours = planets.filter(p => p.owner === 'player');
        if (flagged.length > 0 && Math.random() < 0.5) {
          e.targetPlanet = flagged[0];
        } else if (yours.length > 0 && Math.random() < fac.aggression) {
          e.targetPlanet = yours[Math.floor(Math.random() * yours.length)];
        } else {
          e.targetPlanet = null;
        }
      }
    }

    let tx, ty;
    const distToShip = dist(e, ship);
    if (e.targetFreighter) {
      tx = e.targetFreighter.x; ty = e.targetFreighter.y;
    } else if ((!e.targetPlanet || (Math.random() < fac.aggression * 0.02 && distToShip < 500)) && !ship.dead) {
      tx = ship.x; ty = ship.y;
    } else if (e.targetPlanet) {
      tx = e.targetPlanet.x; ty = e.targetPlanet.y;
    } else {
      tx = ship.x; ty = ship.y;
    }

    const dx = tx - e.x, dy = ty - e.y, dd = Math.sqrt(dx * dx + dy * dy);
    e.angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.25;
    if (dd > 110) {
      e.vx += Math.cos(e.angle) * CONFIG.fighterUnit.accel * fac.speedMult;
      e.vy += Math.sin(e.angle) * CONFIG.fighterUnit.accel * fac.speedMult;
    }

    // Shoot at the intercepted freighter
    if (e.targetFreighter && dd < 260 && e.shootTimer <= 0) {
      fireAimedShot(e.x, e.y, e.targetFreighter, true, e.r + 5);
      e.shootTimer = 90 + Math.random() * 100;
    }

    // Raid player structures
    if (e.targetPlanet && e.targetPlanet.owner === 'player' && dd < e.targetPlanet.r + 240) {
      if (e.shootTimer <= 0) {
        const types = Object.keys(e.targetPlanet.structures);
        if (types.length > 0) {
          const t = types[Math.floor(Math.random() * types.length)];
          fireAimedShot(e.x, e.y, structPos(e.targetPlanet, t), true, e.r + 5);
          e.shootTimer = 100 + Math.random() * 120;
        }
      }
    }

    const maxSpd = CONFIG.fighterUnit.maxSpeed * fac.speedMult;
    const spd = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    if (spd > maxSpd) { e.vx = e.vx / spd * maxSpd; e.vy = e.vy / spd * maxSpd; }
    e.x += e.vx; e.y += e.vy;
    e.x = Math.max(0, Math.min(WORLD_W, e.x));
    e.y = Math.max(0, Math.min(WORLD_H, e.y));

    for (const p of planets) {
      if (dist(e, p) < p.r + e.r + 2) {
        const na = Math.random() * Math.PI * 2;
        e.x = p.x + Math.cos(na) * (p.r + 120);
        e.y = p.y + Math.sin(na) * (p.r + 120);
        e.vx = 0; e.vy = 0;
      }
    }

    if (e.shootTimer > 0) e.shootTimer--;
    if (e.shootTimer <= 0 && distToShip < fac.shootRange && !ship.dead) {
      fireShot(e, true);
      e.shootTimer = 110 + Math.random() * 130;
    }

    e.flicker += 1;
  }
}

function updatePlatforms() {
  for (const p of planets) {
    if (p.turretTimer > 0) p.turretTimer--;
    if (!p.owner || !p.structures.highport || p.turretTimer > 0) continue;
    const pos = structPos(p, 'highport');

    if (p.owner === 'player') {
      let nearest = null, nd = Infinity;
      for (const e of enemies) {
        const d = dist(pos, e);
        if (d < CONFIG.highport.range && d < nd) { nd = d; nearest = e; }
      }
      if (nearest) {
        fireAimedShot(pos.x, pos.y, nearest, false, 16);
        p.turretTimer = CONFIG.highport.cooldown;
      }
    } else if (!ship.dead && !ship.landedOn) {
      if (dist(pos, ship) < CONFIG.highport.range) {
        fireAimedShot(pos.x, pos.y, ship, true, 16);
        p.turretTimer = CONFIG.highport.cooldown;
      }
    }
  }
}

function damageStructure(p, type, dmg, hitX, hitY) {
  const s = p.structures[type];
  if (!s) return;
  s.hp -= dmg;
  spawnPart(hitX, hitY, p.owner === 'player' ? '#2adf6e' : CONFIG.factions[p.owner].color, 6);
  if (s.hp <= 0) {
    delete p.structures[type];
    spawnPart(hitX, hitY, '#e87030', 25);
    const ownerLabel = p.owner === 'player' ? 'Your' : CONFIG.factions[p.owner].label;
    flashMsg(ownerLabel + ' ' + STRUCTS[type].name + ' on ' + p.name + ' destroyed!', 2200);

    // The Space Dock and Sensor Array are attached to the High Port —
    // when the High Port falls, they fall with it
    if (type === 'highport') {
      for (const attached of ['spacedock', 'sensor']) {
        if (p.structures[attached]) {
          delete p.structures[attached];
          const ap = structPos(p, attached);
          spawnPart(ap.x, ap.y, '#e87030', 18);
        }
      }
    }

    const idx = BUILD_ORDER.indexOf(type);
    if (idx < p.buildIndex) { p.buildIndex = idx; p.buildProgress = 0; }

    if (p.owner !== 'player') score += 100;

    if (structCount(p) === 0) {
      const wasEnemy = p.owner !== 'player';
      flashMsg(p.name + ' has fallen — the planet is unclaimed!', 2500);
      p.owner = null;
      p.flaggedBy = null;
      p.buildIndex = 0;
      p.buildProgress = 0;
      p.raw = 0;
      p.finished = 0;
      if (wasEnemy) score += 300;
    }
  }
}

function updateBullets() {
  for (const b of bullets) {
    b.x += b.vx; b.y += b.vy;
    b.life -= 0.006;

    for (const p of planets) {
      if (dist(b, p) < p.r) { b.life = 0; break; }
      if (!p.owner || b.life <= 0) continue;
      const hostileToPlanet = (p.owner === 'player') === b.isEnemy;
      if (!hostileToPlanet) continue;
      for (const type of Object.keys(p.structures)) {
        const pos = structPos(p, type);
        if (dist(b, pos) < 13) {
          damageStructure(p, type, 12, b.x, b.y);
          b.life = 0;
          break;
        }
      }
    }
  }

  for (const b of bullets) {
    if (b.life <= 0) continue;

    // Freighters: player bullets hit enemy freighters, enemy bullets hit yours
    for (const f of freighters) {
      const hostile = (f.owner === 'player') === b.isEnemy;
      if (hostile && dist(b, f) < f.r + 5) {
        f.hull -= 15; b.life = 0;
        spawnPart(f.x, f.y, '#b8c8d0', 8);
        if (f.hull <= 0 && f.hull > -900) {
          spawnPart(f.x, f.y, '#e87030', 30);
          if (f.owner === 'player') {
            flashMsg('Your freighter was destroyed!', 2500);
          } else {
            score += 200;
            credits += 25;
            flashMsg(CONFIG.factions[f.owner].label + ' freighter destroyed — supply line cut!', 2500);
          }
          f.hull = -999;
        }
        break;
      }
    }
    if (b.life <= 0) continue;

    if (b.isEnemy) {
      if (!ship.dead && dist(b, ship) < 11) {
        ship.hull -= 10; b.life = 0;
        spawnPart(ship.x, ship.y, '#e87a30', 10);
        if (ship.hull <= 0) {
          ship.dead = true;
          gameState = 'dead';
          flashMsg('Hull breach — click Restart to try again', 9999);
        }
        continue;
      }
      for (const d of drones) {
        if (dist(b, d) < 8) {
          d.hp -= 15; b.life = 0;
          spawnPart(d.x, d.y, '#7ecfff', 8);
          break;
        }
      }
    } else {
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
  freighters = freighters.filter(f => f.hull > -900);
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

function updateSensors() {
  for (const p of planets) {
    if (p.owner !== 'player') continue;
    if (p.structures.comm)   revealAround(p.x, p.y, CONFIG.comm.range);
    if (p.structures.sensor) revealAround(p.x, p.y, CONFIG.sensor.range);
  }
}

// Labs work cooperatively on research. When a development is ready,
// land at any of your bases to install it — just like the original.
function updateResearch() {
  if (researchReady) return;
  const labs = planets.filter(p => p.owner === 'player' && p.structures.lab).length;
  if (labs === 0) return;
  researchProgress += CONFIG.research.ratePerLab * labs;
  if (researchProgress >= 1) {
    const options = Object.keys(UPGRADES).filter(k => upgradeLevel(k) < UPGRADES[k].costs.length);
    if (options.length === 0) {
      credits += 100;
      researchProgress = 0;
      flashMsg('Labs report: no further developments — +100 credits', 2500);
      return;
    }
    researchReady = options[Math.floor(Math.random() * options.length)];
    flashMsg('LABS HAVE A NEW DEVELOPMENT — land at a base to install!', 4000);
  }
}

function checkWinLose() {
  if (gameState !== 'playing') return;

  const counts = { player: 0, ashkari: 0, pale: 0, vorath: 0 };
  for (const p of planets) if (p.owner) counts[p.owner]++;

  if (counts.player === 0) {
    gameState = 'dead';
    flashMsg('All your bases have fallen — Restart to try again', 9999);
    return;
  }
  if (counts.player >= CONFIG.win.planetsNeeded) {
    gameState = 'won';
    flashMsg('SECTOR SECURED — Victory!', 9999);
    return;
  }
  if (counts.ashkari === 0 && counts.pale === 0 && counts.vorath === 0) {
    gameState = 'won';
    flashMsg('All rival civilizations eliminated — total victory!', 9999);
    return;
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
  updateMaterials();
  updateProduction();
  updateAiFlags();
  updateFreighters();
  updateDrones();
  updateEnemies();
  updatePlatforms();
  updateBullets();
  updateParticles();
  updateSensors();
  updateResearch();
  checkWinLose();
  updateCamera();
  updateHUD();
}

/* ---------- 6. DRAW ---------- */
function factionColor(owner) {
  if (owner === 'player') return '#2adf6e';
  return CONFIG.factions[owner].color;
}

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
  if (e.faction === 'vorath') {
    ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(e.flicker * 0.03));
  }
  ctx.translate(s.x, s.y);
  ctx.rotate(e.angle);
  ctx.strokeStyle = fac.color;
  ctx.lineWidth = 1.5;
  if (e.faction === 'pale') {
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

// All freighters are commercial gray, with a cargo bar — like the original
function drawFreighter(f) {
  if (!onScreen(f.x, f.y)) return;
  const s = worldToScreen(f.x, f.y);
  const hFrac = Math.max(0.35, f.hull / f.maxHull);
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(f.angle);
  ctx.strokeStyle = '#b8c8d0';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-10, -5 * hFrac, 20, 10 * hFrac);
  ctx.beginPath();
  ctx.moveTo(10, 0); ctx.lineTo(14, -4 * hFrac); ctx.lineTo(14, 4 * hFrac);
  ctx.closePath(); ctx.stroke();
  ctx.restore();

  // Cargo bar (magenta, like the original's materials bars)
  if (f.cargo > 0) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(s.x - 10, s.y + 9, 20, 2.5);
    ctx.fillStyle = '#d66ad0';
    ctx.fillRect(s.x - 10, s.y + 9, 20 * (f.cargo / CONFIG.freighterUnit.cargoCap), 2.5);
  }
  // Tiny allegiance dot so you can tell whose it is up close
  ctx.fillStyle = factionColor(f.owner);
  ctx.beginPath();
  ctx.arc(s.x, s.y - 9, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawDrone(d) {
  if (!onScreen(d.x, d.y)) return;
  const s = worldToScreen(d.x, d.y);
  ctx.save();
  ctx.strokeStyle = '#7ecfff';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(s.x - 4, s.y - 4, 8, 8);
  ctx.beginPath();
  ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#7ecfff';
  ctx.fill();
  ctx.restore();
}

function drawPlanets() {
  for (const p of planets) {
    if (!onScreen(p.x, p.y, p.r + 140)) continue;
    const sc = worldToScreen(p.x, p.y);

    if (!p.revealed) {
      ctx.fillStyle = 'rgba(30,50,70,0.25)';
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, p.r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.arc(sc.x, sc.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.fillColor;
    ctx.fill();
    ctx.strokeStyle = p.owner ? factionColor(p.owner) : p.strokeColor;
    ctx.lineWidth = p.owner ? 1.6 : 1;
    ctx.stroke();

    if (p.owner) {
      const col = factionColor(p.owner);

      ctx.strokeStyle = 'rgba(60, 200, 100, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, p.r + 74, 0, Math.PI * 2);
      ctx.stroke();

      for (const type of Object.keys(p.structures)) {
        const st = STRUCTS[type];
        const s = p.structures[type];
        const pos = structPos(p, type);
        const ps = worldToScreen(pos.x, pos.y);

        ctx.strokeStyle = col;
        ctx.lineWidth = 1.3;
        // Labs flash when a new development is ready to install
        if (type === 'lab' && researchReady && p.owner === 'player') {
          ctx.save();
          ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(Date.now() * 0.006));
          ctx.strokeRect(ps.x - st.w / 2, ps.y - st.h / 2, st.w, st.h);
          ctx.restore();
        } else {
          ctx.strokeRect(ps.x - st.w / 2, ps.y - st.h / 2, st.w, st.h);
        }

        // High Port gets a flight-deck line on top
        if (type === 'highport') {
          ctx.beginPath();
          ctx.moveTo(ps.x - st.w / 2 + 3, ps.y - st.h / 2 - 3);
          ctx.lineTo(ps.x + st.w / 2 - 3, ps.y - st.h / 2 - 3);
          ctx.stroke();
        }

        if (s.hp < s.maxHp) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(ps.x - st.w / 2, ps.y + st.h / 2 + 2, st.w, 2.5);
          ctx.fillStyle = col;
          ctx.fillRect(ps.x - st.w / 2, ps.y + st.h / 2 + 2, st.w * (s.hp / s.maxHp), 2.5);
        }
      }

      // Structure under construction (built by Base or High Port)
      if (p.buildIndex >= FREIGHTER_BUILT && p.buildIndex < BUILD_ORDER.length) {
        const type = BUILD_ORDER[p.buildIndex];
        const builder = PLANETARY.includes(type) ? 'base' : 'highport';
        if (p.structures[builder]) {
          const st = STRUCTS[type];
          const pos = structPos(p, type);
          const ps = worldToScreen(pos.x, pos.y);
          ctx.save();
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.45;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(ps.x - st.w / 2, ps.y - st.h / 2, st.w, st.h);
          ctx.restore();
          ctx.fillStyle = col;
          ctx.fillRect(ps.x - st.w / 2, ps.y + st.h / 2 + 2, st.w * Math.min(1, p.buildProgress), 2);
        }
      }

      // Materials bars: raw (green) and finished (blue)
      const bw = p.r * 1.5;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 80, bw, 3);
      ctx.fillStyle = '#3fae52';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 80, bw * (p.raw / CONFIG.materials.cap), 3);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 85, bw, 3);
      ctx.fillStyle = '#3f6fd0';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 85, bw * (p.finished / CONFIG.materials.cap), 3);
    }

    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = p.owner ? factionColor(p.owner) : p.strokeColor;
    ctx.fillText(p.name, sc.x, sc.y - p.r - 82);
    if (p.owner === 'player') ctx.fillText('YOURS', sc.x, sc.y - p.r - 94);
    else if (p.owner) ctx.fillText(CONFIG.factions[p.owner].label, sc.x, sc.y - p.r - 94);
    else if (p.flaggedBy === 'player') ctx.fillText('FLAGGED — AWAITING FREIGHTER', sc.x, sc.y - p.r - 20);
    else if (p.flaggedBy) ctx.fillText('RIVAL CLAIM DETECTED', sc.x, sc.y - p.r - 20);
  }
}

function drawLandingPrompt() {
  if (ship.dead || gameState !== 'playing') return;
  const s = worldToScreen(ship.x, ship.y);
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';

  if (ship.landedOn) {
    ctx.fillStyle = '#7ef0ff';
    ctx.fillText('PRESS W TO LIFT OFF', s.x, s.y - 24);
    return;
  }

  const p = nearestFlaggablePlanet();
  if (!p) return;
  const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);

  if (!p.owner && p.flaggedBy !== 'player') {
    ctx.fillStyle = speed <= CONFIG.ship.landSpeed ? '#7ef0ff' : '#e8b030';
    ctx.fillText(speed <= CONFIG.ship.landSpeed
      ? 'LAND ON ' + p.name + ' TO PLANT YOUR FLAG'
      : 'SLOW DOWN TO LAND — NOSE AWAY FROM PLANET', s.x, s.y - 22);
  } else if (p.owner && p.owner !== 'player') {
    ctx.fillStyle = CONFIG.factions[p.owner].color;
    ctx.fillText('ENEMY BASE — DESTROY ALL STRUCTURES TO RECLAIM', s.x, s.y - 22);
  }
}

// The original's velocity indicator: fills with your speed, and the
// background turns blue when you are slow enough to land safely
function drawVelocityIndicator() {
  const bw = 110, bh = 10, bx = 14, by = H - bh - 14;
  const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
  const maxShow = 3.0;
  const canLand = speed <= CONFIG.ship.landSpeed;

  ctx.fillStyle = canLand ? 'rgba(30, 70, 190, 0.85)' : 'rgba(10, 16, 26, 0.85)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#2a3f5a';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(bx, by, bw, bh);

  ctx.fillStyle = '#7ef0ff';
  ctx.fillRect(bx + 1, by + 1, (bw - 2) * Math.min(1, speed / maxShow), bh - 2);

  // Threshold tick at the safe-landing speed
  const tick = bx + bw * (CONFIG.ship.landSpeed / maxShow);
  ctx.strokeStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(tick, by - 2);
  ctx.lineTo(tick, by + bh + 2);
  ctx.stroke();

  ctx.fillStyle = '#556a80';
  ctx.font = '9px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('VEL', bx, by - 4);
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
    ctx.fillStyle = p.owner ? factionColor(p.owner) : p.strokeColor;
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
  }

  // Freighters: neutral gray dots, like the original's radar
  ctx.fillStyle = '#b8c8d0';
  for (const f of freighters) {
    ctx.fillRect(mx + f.x * sx - 1.5, my + f.y * sy - 1.5, 3, 3);
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
  for (const f of freighters) drawFreighter(f);
  for (const d of drones) drawDrone(d);

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
  drawVelocityIndicator();
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
