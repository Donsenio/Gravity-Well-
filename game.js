const GAME_VERSION = 'v1.1 — save system';
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
  world: { w: 3600, h: 2400 },
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
    shields: 60,            // absorbs damage before the hull (original manual)
    shieldRegen: 0.012,     // slow passive regen; fast while landed at a base
  },
  missiles: {
    max: 5,
    speed: 4.6,
    turnRate: 0.055,        // homing strength
    damage: 45,
    cooldown: 45,
    rearmCost: 3,           // finished materials per missile when rearming
  },
  respawn: {
    delayFrames: 300,       // labs/space docks construct you a new fighter
  },
  research: {
    ratePerLab: 0.00013,    // labs work cooperatively — more labs, faster tech
  },
  gravity: {
    maxPull: 0.55,
    softening: 1600,        // eps added to d^2: smooths force near surfaces
  },
  suns: {
    count: 4,               // manual: 4-6 stars, 1-3 planets each
    radius: 58,             // properly star-sized
    mass: 17000,            // much deeper gravity well than a planet
    maxPull: 0.85,
    killRadius: 6,          // touching a star destroys anything
    edgeMargin: 430,
    minSpacing: 820,        // scattered, never clustered
  },
  planets: {
    count: 7,
    minRadius: 56,          // roomy enough for structures inside, like the original
    maxRadiusExtra: 18,
    minMass: 1500,
    massExtra: 500,
    revealRange: 280,
    coreFrac: 0.28,         // projectiles pass over the disc, stop at the core
  },
  materials: {
    cap: 100,
    rawRate: 0.15,          // raw produced per frame by a Colony
    rawReserve: 12,         // conversion leaves this much raw for freighters
    convertRate: 0.035,     // raw -> finished per frame by a Base (x2 w/ High Port)
    buildDrain: 0.02,       // finished consumed per frame while constructing
    baseBuildRate: 0.0011,
  },
  freighterUnit: {
    speed: 0.85,
    hull: 60,
    cargoCap: 100,
    loadRate: 0.3,          // cargo transfer per frame while loading
    cost: 22,               // finished materials to build one
    maxPerFaction: 4,
    attackRange: 190,
    attackCooldown: 80,
  },
  fighterUnit: {
    cost: 22,               // finished materials per fighter
    maxSpeed: 1.5,
    accel: 0.035,
    bulletSpeed: 3.2,
    perLabCap: 2,
    baseCap: 2,
  },
  production: { checkFrames: 150 },   // how often labs try to build ships
  aiFlagFrames: 420,                  // how often AI factions pick expansion targets
  personalities: {
    aggressive: { label: 'Aggressive', aggro: 1.6, speed: 1.0,  econ: 1.0,  claim: 0.015, fireRate: 1.0 },
    maniacal:   { label: 'Maniacal',   aggro: 2.6, speed: 1.15, econ: 0.85, claim: 0.008, fireRate: 1.5 },
    shrewd:     { label: 'Shrewd',     aggro: 0.6, speed: 0.95, econ: 1.5,  claim: 0.03,  fireRate: 0.8 },
  },
  factions: {
    ashkari: { hull: 40, shootRange: 350, aggression: 0.9,  speedMult: 1.0,  color: '#e85850', label: 'ASHKARI' },
    pale:    { hull: 70, shootRange: 300, aggression: 0.3,  speedMult: 0.7,  color: '#2ab8d6', label: 'PALE SYNDICATE' },
    vorath:  { hull: 30, shootRange: 250, aggression: 0.2,  speedMult: 1.25, color: '#9f6ad6', label: 'VORATH' },
  },
  highport: { range: 250, cooldown: 95 },   // orbital defense garrison
  comm:     { range: 300 },                 // comm center radar reach
  sensor:   { range: 430 },                 // sensor array radar reach
  drone:    { orbit: 42, range: 240, cooldown: 55, hp: 25 },
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

const PLANET_NAMES   = ['HOME', 'KETH-7', 'VORA-2', 'SELUN', 'DRAXI', 'MIRATH', 'TANIS', 'OBERON', 'CINDER', 'HALCYON'];
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
const radarC = document.getElementById('radar');
const rctx = radarC.getContext('2d');
const dialsC = document.getElementById('dials');
const dctx = dialsC.getContext('2d');
const shipListEl = document.getElementById('ship-list');
const sideEls = {
  score: document.getElementById('s-score'),
  credits: document.getElementById('s-credits'),
  raw: document.getElementById('s-raw'),
  fin: document.getElementById('s-fin'),
  planets: document.getElementById('s-planets'),
  hostiles: document.getElementById('s-hostiles'),
  state: document.getElementById('s-state'),
  sector: document.getElementById('s-sector'),
  version: document.getElementById('s-version'),
  barShield: document.getElementById('bar-shield'),
  barDmg: document.getElementById('bar-dmg'),
  barVel: document.getElementById('bar-vel'),
  velWrap: document.getElementById('vel-wrap'),
  pips: document.getElementById('missile-pips'),
  opp: {
    player: document.getElementById('opp-player'),
    ashkari: document.getElementById('opp-ashkari'),
    pale: document.getElementById('opp-pale'),
    vorath: document.getElementById('opp-vorath'),
  },
};

// Unit selection: null = follow your fighter. Click ship list to spectate.
let selected = null;
let listFrame = 0;
let nextFid = 1;

canvas.addEventListener('mousedown', () => { selected = null; });

shipListEl.addEventListener('click', (ev) => {
  try {
    let n = ev.target;
    while (n && n !== shipListEl && !n.dataset.pi && !n.dataset.fi) n = n.parentNode;
    if (!n || n === shipListEl) return;
    if (n.dataset.pi !== undefined && n.dataset.pi !== '') {
      selected = { kind: 'planet', p: planets[+n.dataset.pi] };
    } else if (n.dataset.fi !== undefined && n.dataset.fi !== '') {
      const f = freighters.find(q => q.fid === +n.dataset.fi);
      if (f) selected = { kind: 'freighter', fid: f.fid };
    }
    listFrame = 0;
  } catch (e) {}
});

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
const ZOOMS = [0.6, 0.8, 1.0, 1.3, 1.6];
let zoomIdx = 2;
function vzoom() { return ZOOMS[zoomIdx]; }
function viewW() { return W / vzoom(); }
function viewH() { return H / vzoom(); }

function worldToScreen(wx, wy) { return { x: wx - cam.x, y: wy - cam.y }; }
function onScreen(wx, wy, margin = 100) {
  const s = worldToScreen(wx, wy);
  return s.x > -margin && s.x < viewW() + margin && s.y > -margin && s.y < viewH() + margin;
}

let keys = {};
let shopOpen = false;

function nextSector() {
  sectorNum++;
  init(true);
  saveCampaign();
  flashMsg('Warped to SECTOR ' + sectorNum + ' — deeper space, harder rivals', 3500);
}

/* ---------- Save system (localStorage) ---------- */
const SAVE_KEY = 'gwr_campaign_v1';
const HISCORE_KEY = 'gwr_hiscores_v1';

function saveCampaign() {
  try {
    const data = {
      sector: sectorNum,
      score: score,
      credits: credits,
      upgrades: upgradeLevels,
      leaders: leaderSettings,
      stamp: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) {}
}

function loadCampaign() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) { return null; }
}

function clearCampaign() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
}

function getHiScores() {
  try {
    const raw = localStorage.getItem(HISCORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function recordHiScore(finalScore, sectorReached) {
  try {
    const list = getHiScores();
    list.push({ score: finalScore, sector: sectorReached, date: Date.now() });
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 5);
    localStorage.setItem(HISCORE_KEY, JSON.stringify(top));
    return top;
  } catch (e) { return []; }
}

let hiScoreRecorded = false;

canvas.addEventListener('keydown', e => {
  Snd.ensure();
  if (e.key === 'Enter' && gameState === 'won') { nextSector(); return; }
  if (e.key === 'PageUp' || e.key === '+' || e.key === '=') {
    zoomIdx = Math.min(ZOOMS.length - 1, zoomIdx + 1);
    flashMsg('Magnification ' + vzoom() + 'x', 1000);
    e.preventDefault(); return;
  }
  if (e.key === 'PageDown' || e.key === '-' || e.key === '_') {
    zoomIdx = Math.max(0, zoomIdx - 1);
    flashMsg('Magnification ' + vzoom() + 'x', 1000);
    e.preventDefault(); return;
  }
  if (e.key === 'm' || e.key === 'M') { Snd.muted = !Snd.muted; flashMsg(Snd.muted ? 'Sound off' : 'Sound on', 1200); return; }
  if (e.key === 'u' || e.key === 'U') { toggleShop(); e.preventDefault(); return; }
  if (e.key === 'Escape' && shopOpen) { toggleShop(); return; }
  keys[e.key] = true;
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
});
canvas.addEventListener('keyup', e => { keys[e.key] = false; });
function refreshMenu() {
  const save = loadCampaign();
  const contBtn = document.getElementById('gw-continue');
  if (contBtn) {
    if (save) {
      contBtn.style.display = 'block';
      contBtn.textContent = 'CONTINUE — Sector ' + save.sector + ' (score ' + save.score + ')';
    } else {
      contBtn.style.display = 'none';
    }
  }
  const hsEl = document.getElementById('gw-hiscores');
  if (hsEl) {
    const scores = getHiScores();
    if (scores.length === 0) {
      hsEl.innerHTML = '<div class="hs-title">NO CAMPAIGNS YET</div>';
    } else {
      hsEl.innerHTML = '<div class="hs-title">BEST CAMPAIGNS</div>' +
        scores.map((s, i) => '<div class="hs-row"><span>' + (i + 1) + '.</span>' +
          '<span>' + s.score + '</span><span>Sector ' + s.sector + '</span></div>').join('');
    }
  }
}

const continueBtn = document.getElementById('gw-continue');
if (continueBtn) {
  continueBtn.addEventListener('click', (ev) => {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    const save = loadCampaign();
    if (!save) return;
    sectorNum = save.sector;
    score = save.score;
    credits = save.credits;
    upgradeLevels = save.upgrades || {};
    leaderSettings = save.leaders || leaderSettings;
    hiScoreRecorded = false;
    init(true);
    hint.style.display = 'none';
    canvas.focus();
    Snd.ensure();
    flashMsg('Resuming campaign — Sector ' + sectorNum, 3000);
  });
}

const beginBtn = document.getElementById('gw-begin');
if (beginBtn) {
  beginBtn.addEventListener('click', (ev) => {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    for (const f of ['ashkari', 'pale', 'vorath']) {
      const sel = document.getElementById('pers-' + f);
      if (sel && sel.value) leaderSettings[f] = sel.value;
    }
    sectorNum = 1;
    hiScoreRecorded = false;
    init(false);
    saveCampaign();
    hint.style.display = 'none';
    canvas.focus();
    Snd.ensure();
    flashMsg('Campaign begun — ' +
      CONFIG.personalities[leaderSettings.ashkari].label + ' / ' +
      CONFIG.personalities[leaderSettings.pale].label + ' / ' +
      CONFIG.personalities[leaderSettings.vorath].label, 3000);
  });
}
restartBtn.addEventListener('click', () => { hint.style.display = 'flex'; refreshMenu(); });
refreshMenu();
canvas.addEventListener('focus', () => { hint.style.display = 'none'; });
shopCloseBtn.addEventListener('click', () => { toggleShop(); canvas.focus(); });

/* ---------- AUDIO (synthesized retro effects, matching the original's
   sound events: fire, hit, collide, missile, prox, develop, install) ---------- */
const Snd = {
  ctx: null, muted: false, proxAt: 0,
  ensure() {
    if (this.ctx || this.muted) return;
    try {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (AC) this.ctx = new AC();
    } catch (e) { this.ctx = null; }
  },
  tone(f0, f1, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    } catch (e) {}
  },
  fire()    { this.tone(760, 190, 0.07, 'square', 0.025); },
  hit()     { this.tone(210, 70, 0.1, 'sawtooth', 0.05); },
  collide() { this.tone(110, 35, 0.35, 'sawtooth', 0.09); },
  missile() { this.tone(320, 900, 0.3, 'square', 0.045); },
  prox()    {
    const now = Date.now();
    if (now - this.proxAt < 2600) return;
    this.proxAt = now;
    this.tone(980, 980, 0.09, 'sine', 0.05);
    setTimeout(() => this.tone(760, 760, 0.09, 'sine', 0.05), 130);
  },
  develop() { this.tone(420, 840, 0.16, 'triangle', 0.06); setTimeout(() => this.tone(560, 1120, 0.16, 'triangle', 0.06), 170); },
  install() { this.tone(880, 1320, 0.14, 'triangle', 0.06); },
};

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
  else r *= persOf(owner).econ * sectorEcon();
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
let ship, planets, bullets, enemies, freighters, drones, particles, stars, missiles, suns;
let score, credits, gameState, shootCooldown, landCooldown, msgTimer;
let productionTimer, aiFlagTimer, missileCooldown = 0, autosaveTimer = 0;
let researchProgress, researchReady;
let leaderSettings = { ashkari: 'aggressive', pale: 'shrewd', vorath: 'maniacal' };
let sectorNum = 1;
let winNeed = 5;
function sectorEcon() { return 1 + (sectorNum - 1) * 0.12; }   // enemy economies grow
function sectorFire() { return 1 + (sectorNum - 1) * 0.06; }   // enemies shoot faster
const NEUTRAL_PERS = { aggro: 1, speed: 1, econ: 1, claim: 0, fireRate: 1 };
function persOf(faction) {
  if (faction === 'player') return NEUTRAL_PERS;
  return CONFIG.personalities[leaderSettings[faction]] || NEUTRAL_PERS;
}

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
  // Sectors grow with your campaign: more suns, more planets, per the
  // manual's 4-6 stars with 1-3 planets each.
  const sunCount = Math.min(6, 3 + sectorNum);
  const planetCount = Math.min(10, 6 + sectorNum);
  winNeed = Math.ceil(planetCount * 0.65);

  // Suns are scattered randomly across the galaxy with real spacing —
  // no two systems crowd each other
  suns = [];
  let spacing = CONFIG.suns.minSpacing;
  for (let i = 0; i < sunCount; i++) {
    let sx, sy, ok, tries = 0;
    do {
      ok = true;
      sx = CONFIG.suns.edgeMargin + Math.random() * (WORLD_W - CONFIG.suns.edgeMargin * 2);
      sy = CONFIG.suns.edgeMargin + Math.random() * (WORLD_H - CONFIG.suns.edgeMargin * 2);
      for (const s of suns) {
        if (Math.sqrt((s.x - sx) ** 2 + (s.y - sy) ** 2) < spacing) { ok = false; break; }
      }
      tries++;
      if (tries % 120 === 0) spacing *= 0.9;   // relax if the galaxy is crowded
    } while (!ok && tries < 600);
    suns.push({ x: sx, y: sy, r: CONFIG.suns.radius });
  }

  planets = [];
  for (let i = 0; i < planetCount; i++) {
    const p = newPlanet(i, 0, 0);
    if (i < 4) {
      p.sun = suns[i % suns.length]; // faction homes, one per sun
      p.orbitR = 240;
    } else {
      p.sun = suns[(i - 4) % suns.length];
      p.orbitR = 420 + 90 * Math.floor((i - 4) / suns.length);
    }
    p.orbitA = Math.random() * Math.PI * 2;
    p.orbitSpd = (0.00035 + Math.random() * 0.00035) * (i % 2 === 0 ? 1 : -1);
    p.x = p.sun.x + Math.cos(p.orbitA) * p.orbitR;
    p.y = p.sun.y + Math.sin(p.orbitA) * p.orbitR;
    planets.push(p);
  }
}

// Planets slowly orbit their suns — every destination is a moving target
function updateOrbits() {
  for (const p of planets) {
    p.orbitA += p.orbitSpd;
    p.x = p.sun.x + Math.cos(p.orbitA) * p.orbitR;
    p.y = p.sun.y + Math.sin(p.orbitA) * p.orbitR;
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
  addStructure(p, 'lab');     // a "well established complex" — the manual's words
  p.buildIndex = 4;           // next up: comm center
  p.buildProgress = 0;
  p.raw = 60;
  p.finished = 50;
  p.revealed = (owner === 'player');
}

function structPos(p, type) {
  if (PLANETARY.includes(type)) {
    // Ground structures sit INSIDE the planet circle, like the original
    const a = GROUND_ANGLES[type];
    return {
      x: p.x + Math.cos(a) * (p.r * 0.5),
      y: p.y + Math.sin(a) * (p.r * 0.5),
    };
  }
  // Orbital: High Port leads, Space Dock and Sensor Array trail behind it
  const a = p.orbitAng + ORBIT_OFFSET[type];
  return {
    x: p.x + Math.cos(a) * (p.r + 24),
    y: p.y + Math.sin(a) * (p.r + 24),
  };
}

function init(keepProgress) {
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
    shields: CONFIG.ship.shields,
    maxShields: CONFIG.ship.shields,
    missiles: CONFIG.missiles.max,
    thrust: 0,
    dead: false,
    deadTimer: 0,
    landedOn: null,          // planet the fighter is currently landed on
  };
  missiles = [];

  bullets = []; enemies = []; freighters = []; drones = []; particles = [];
  missiles = [];
  if (!keepProgress) {
    score = 0; credits = 100;
    upgradeLevels = {};
  }
  researchProgress = 0;
  researchReady = null;
  gameState = 'playing';
  shootCooldown = 0; landCooldown = 0;
  productionTimer = 0; aiFlagTimer = 0;
  shopOpen = false;
  shopEl.classList.add('hidden');
  selected = null;
  listFrame = 0;

  // Every faction begins with two freighters
  for (let i = 0; i < 4; i++) {
    spawnFreighterUnit(FACTION_LIST[i], planets[i]);
    spawnFreighterUnit(FACTION_LIST[i], planets[i]);
  }
  const startFighters = Math.min(4, 1 + sectorNum);
  for (let n = 0; n < startFighters; n++) {
    spawnFighter('ashkari', planets[1]);
    spawnFighter('pale',    planets[2]);
    spawnFighter('vorath',  planets[3]);
  }
  spawnDrone(planets[0]);     // HOME's lab launches its defense drone

  flashMsg('SECTOR ' + sectorNum + ' — HOME is secure. Colonies make RAW, bases make FINISHED. Expand!', 4000);
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
    state: 'hunt',
    landTimer: 0,
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    flicker: Math.random() * 100,
  });
}

function spawnFreighterUnit(owner, nearPlanet) {
  const a = Math.random() * Math.PI * 2;
  freighters.push({
    fid: nextFid++,
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
  const eps = CONFIG.gravity.softening;
  for (const p of planets) {
    if (!p.revealed) continue;
    const dx = p.x - obj.x, dy = p.y - obj.y;
    const d2 = dx * dx + dy * dy;
    const d = Math.max(Math.sqrt(d2), 1);
    const f = Math.min(p.mass / (d2 + eps), CONFIG.gravity.maxPull);
    obj.vx += (dx / d) * f * 0.016;
    obj.vy += (dy / d) * f * 0.016;
  }
  // Stars are far deeper gravity wells — respect them or be eaten
  for (const s of suns) {
    const dx = s.x - obj.x, dy = s.y - obj.y;
    const d2 = dx * dx + dy * dy;
    const d = Math.max(Math.sqrt(d2), 1);
    const f = Math.min(CONFIG.suns.mass / (d2 + eps), CONFIG.suns.maxPull);
    obj.vx += (dx / d) * f * 0.016;
    obj.vy += (dy / d) * f * 0.016;
  }
}

function sunContact(obj, margin) {
  for (const s of suns) {
    if (dist(obj, s) < s.r + (margin || CONFIG.suns.killRadius)) return s;
  }
  return null;
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
  sideEls.score.textContent = score;
  sideEls.credits.textContent = Math.round(credits);
  let raw = 0, fin = 0, owned = 0;
  const counts = { player: 0, ashkari: 0, pale: 0, vorath: 0 };
  for (const p of planets) {
    if (p.owner) counts[p.owner]++;
    if (p.owner === 'player') { raw += p.raw; fin += p.finished; owned++; }
  }
  sideEls.raw.textContent = Math.round(raw);
  sideEls.fin.textContent = Math.round(fin);
  sideEls.planets.textContent = owned + '/' + planets.length;
  if (sideEls.sector) sideEls.sector.textContent = sectorNum;
  sideEls.hostiles.textContent = enemies.length;
  sideEls.state.textContent =
    ship.dead ? 'CONSTRUCTING NEW FIGHTER...' :
    ship.landedOn ? 'LANDED' :
    gameState === 'won' ? 'VICTORY' :
    gameState === 'dead' ? 'DEFEATED' : 'FLYING';

  // Indicator bars
  sideEls.barShield.style.width = (100 * ship.shields / ship.maxShields) + '%';
  sideEls.barDmg.style.width = (100 * (1 - Math.max(0, ship.hull) / ship.maxHull)) + '%';
  const speed = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
  sideEls.barVel.style.width = Math.min(100, 100 * speed / 3.0) + '%';
  sideEls.velWrap.classList.toggle('landable', speed <= CONFIG.ship.landSpeed && !ship.dead);
  sideEls.pips.textContent = '\u258e'.repeat(ship.missiles);

  // Opponent boxes: black when eliminated; yours flashes when labs have tech
  for (const f of ['player', 'ashkari', 'pale', 'vorath']) {
    sideEls.opp[f].classList.toggle('dead', counts[f] === 0);
  }
  sideEls.opp.player.classList.toggle('flash', !!researchReady);

  // Ship list rebuild (throttled)
  listFrame--;
  if (listFrame <= 0) { rebuildShipList(); listFrame = 30; }
}

function rebuildShipList() {
  let html = '';
  for (let i = 0; i < planets.length; i++) {
    const p = planets[i];
    if (p.owner !== 'player') continue;
    const selP = selected && selected.kind === 'planet' && selected.p === p;
    html += '<div class="sl-planet' + (selP ? ' sel' : '') + '" data-pi="' + i + '">' + p.name + '</div>';
    for (const type of BUILD_ORDER) {
      const s = p.structures[type];
      if (!s) continue;
      html += '<div class="sl-unit" data-pi="' + i + '">' +
        '<span class="sl-name">' + STRUCTS[type].name + '</span>' +
        '<div class="sl-bar hp"><div style="width:' + Math.round(100 * s.hp / s.maxHp) + '%"></div></div></div>';
    }
    html += '<div class="sl-unit" data-pi="' + i + '"><span class="sl-name">MATERIALS</span>' +
      '<div class="sl-bar raw"><div style="width:' + Math.round(100 * p.raw / CONFIG.materials.cap) + '%"></div></div>' +
      '<div class="sl-bar fin"><div style="width:' + Math.round(100 * p.finished / CONFIG.materials.cap) + '%"></div></div></div>';
  }
  const mine = freighters.filter(f => f.owner === 'player');
  if (mine.length > 0) {
    html += '<div class="sl-planet" style="cursor:default">FREIGHTERS</div>';
    for (const f of mine) {
      const selF = selected && selected.kind === 'freighter' && selected.fid === f.fid;
      html += '<div class="sl-unit clickable' + (selF ? ' sel' : '') + '" data-fi="' + f.fid + '">' +
        '<span class="sl-name">Freighter ' + f.fid + '</span>' +
        '<div class="sl-bar hp"><div style="width:' + Math.round(100 * f.hull / f.maxHull) + '%"></div></div>' +
        '<div class="sl-bar cargo"><div style="width:' + Math.round(100 * f.cargo / CONFIG.freighterUnit.cargoCap) + '%"></div></div></div>';
    }
  }
  shipListEl.innerHTML = html;
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
      // Lift off: push away from the surface or deck
      const p = ship.landedOn;
      const a = Math.atan2(ship.y - p.y, ship.x - p.x);
      ship.landedOn = null;
      ship.onPort = false;
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
    Snd.fire();
    shootCooldown = fireCooldown();
  }
  if (shootCooldown > 0) shootCooldown--;

  if ((keys['f'] || keys['F']) && missileCooldown <= 0 && canControl && !ship.landedOn) {
    if (ship.missiles > 0) {
      fireMissile();
      missileCooldown = CONFIG.missiles.cooldown;
    } else {
      flashMsg('No missiles — rearm at a base', 1500);
      missileCooldown = 40;
    }
  }
  if (missileCooldown > 0) missileCooldown--;
}

// In the original, your fighter is just a unit: when it is destroyed,
// your Labs and Space Docks construct a new one — if your economy can pay.
function shipDestroyed() {
  ship.dead = true;
  ship.landedOn = null;
  ship.deadTimer = CONFIG.respawn.delayFrames;
  spawnPart(ship.x, ship.y, '#e87a30', 45);
  Snd.collide();
  const yard = respawnYard();
  if (yard) {
    flashMsg('Fighter destroyed — ' + yard.name + ' is constructing a replacement...', 4000);
  } else {
    flashMsg('Fighter destroyed — no facility can construct a replacement!', 4000);
  }
}

function endCampaign(kind) {
  if (!hiScoreRecorded) {
    hiScoreRecorded = true;
    recordHiScore(score, sectorNum);
    clearCampaign();
  }
}

function respawnYard() {
  // Prefer a shipyard that can pay full price; fall back to any shipyard
  return planets.find(p =>
    p.owner === 'player' &&
    (p.structures.lab || p.structures.spacedock) &&
    p.finished >= CONFIG.fighterUnit.cost
  ) || planets.find(p =>
    p.owner === 'player' && (p.structures.lab || p.structures.spacedock)
  ) || null;
}

function updateRespawn() {
  if (!ship.dead || gameState !== 'playing') return;
  ship.deadTimer--;
  if (ship.deadTimer > 0) return;
  const yard = respawnYard();
  if (!yard) {
    gameState = 'dead';
    endCampaign('DEFEAT');
    return;
  }
  yard.finished = Math.max(0, yard.finished - CONFIG.fighterUnit.cost);
  const a = Math.random() * Math.PI * 2;
  ship.x = yard.x + Math.cos(a) * (yard.r + 8);
  ship.y = yard.y + Math.sin(a) * (yard.r + 8);
  ship.angle = a;
  ship.vx = 0; ship.vy = 0;
  ship.hull = ship.maxHull;
  ship.shields = ship.maxShields;
  ship.missiles = CONFIG.missiles.max;
  ship.dead = false;
  ship.landedOn = yard;
  flashMsg('New fighter constructed at ' + yard.name + ' — fitted with all upgrades', 3000);
}

function updateShip() {
  if (ship.dead) return;
  if (ship.landedOn) {
    const p = ship.landedOn;
    if (ship.onPort) {
      // Riding the orbiting flight deck
      if (!p.structures.highport || p.owner !== 'player') {
        // Deck destroyed or lost under you — thrown clear
        ship.onPort = false;
        ship.landedOn = null;
        ship.hull -= 10;
        flashMsg('The flight deck is gone — thrown clear!', 2200);
        return;
      }
      const pp = structPos(p, 'highport');
      const oa = Math.atan2(pp.y - p.y, pp.x - p.x);
      ship.x = pp.x + Math.cos(oa) * 12;
      ship.y = pp.y + Math.sin(oa) * 12;
      ship.angle = oa;
      ship.vx = 0; ship.vy = 0;
    } else {
      // Pinned to the surface at the stored landing bearing, nose out.
      // The planet translates along its orbit; the fighter rides it.
      const a = (ship.landAngle !== undefined) ? ship.landAngle : ship.angle;
      ship.angle = a;
      ship.x = p.x + Math.cos(a) * (p.r + 8);
      ship.y = p.y + Math.sin(a) * (p.r + 8);
      ship.vx = 0; ship.vy = 0;
    }

    // Repairs at your own base or High Port, consuming finished materials
    const serviced = p.owner === 'player' && (p.structures.base || (ship.onPort && p.structures.highport));
    if (serviced && ship.hull < ship.maxHull && p.finished > 0.1) {
      ship.hull = Math.min(ship.maxHull, ship.hull + CONFIG.ship.repairRate);
      p.finished = Math.max(0, p.finished - CONFIG.ship.repairCost);
    }
    // Shields recharge quickly and missiles rearm while docked
    if (serviced) {
      ship.shields = Math.min(ship.maxShields, ship.shields + 0.15);
      if (ship.missiles < CONFIG.missiles.max && p.finished >= CONFIG.missiles.rearmCost) {
        p.finished -= CONFIG.missiles.rearmCost;
        ship.missiles++;
        flashMsg('Missile loaded (' + ship.missiles + '/' + CONFIG.missiles.max + ')', 1200);
      }
    }

    // Install lab research when landed at a base or High Port
    if (researchReady && serviced) {
      const u = UPGRADES[researchReady];
      upgradeLevels[researchReady] = upgradeLevel(researchReady) + 1;
      u.apply();
      Snd.install();
      flashMsg('Labs installed ' + u.name + ' LVL ' + upgradeLevel(researchReady) + '!', 3000);
      researchReady = null;
      researchProgress = 0;
    }
  } else if (!ship.dead) {
    applyGravityTo(ship);
    ship.x += ship.vx; ship.y += ship.vy;
    ship.vx *= CONFIG.ship.drag; ship.vy *= CONFIG.ship.drag;
    ship.shields = Math.min(ship.maxShields, ship.shields + CONFIG.ship.shieldRegen);
    if (ship.thrust) {
      spawnPart(ship.x - Math.cos(ship.angle) * 12, ship.y - Math.sin(ship.angle) * 12, '#e87030', 2);
    }
    // Proximity alert when an enemy closes in
    for (const e of enemies) {
      if (dist(e, ship) < 320) { Snd.prox(); break; }
    }
  }

  ship.x = Math.max(0, Math.min(WORLD_W, ship.x));
  ship.y = Math.max(0, Math.min(WORLD_H, ship.y));

  revealAround(ship.x, ship.y, CONFIG.planets.revealRange);

  // Deck landing: touch down on your own orbiting High Port
  if (!ship.dead && !ship.landedOn) {
    const speed0 = Math.sqrt(ship.vx * ship.vx + ship.vy * ship.vy);
    if (speed0 <= CONFIG.ship.landSpeed) {
      for (const p of planets) {
        if (p.owner !== 'player' || !p.structures.highport) continue;
        const pp = structPos(p, 'highport');
        if (dist(ship, pp) < 16) {
          ship.landedOn = p;
          ship.onPort = true;
          flashMsg('Docked on ' + p.name + ' High Port flight deck', 2200);
          break;
        }
      }
    }
  }

  // Flying into a star is not survivable
  if (!ship.dead && !ship.landedOn && sunContact(ship)) {
    shipDestroyed();
    flashMsg('Your fighter fell into a star', 3500);
  }

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
        shipDestroyed();
      } else if (speed <= CONFIG.ship.landSpeed && noseOut) {
        // TOUCHDOWN — store the landing bearing explicitly
        ship.landedOn = p;
        ship.landAngle = outward;
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
        Snd.collide();
        if (ship.hull <= 0) {
          shipDestroyed();
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

    // Colonies produce raw materials (personality affects AI economies)
    if (p.structures.colony) {
      p.raw = Math.min(M.cap, p.raw + M.rawRate * persOf(p.owner).econ * (p.owner === 'player' ? 1 : sectorEcon()));
    }
    // Bases convert raw into finished, but leave a reserve of raw
    // for freighters to load — otherwise expansion starves
    if (p.structures.base && p.raw > M.rawReserve && p.finished < M.cap) {
      let rate = M.convertRate;
      if (p.structures.highport) rate *= 2;
      const amt = Math.min(rate, p.raw - M.rawReserve);
      p.raw -= amt;
      p.finished = Math.min(M.cap, p.finished + amt);
    }
    // Construction of later structures consumes finished materials.
    // Lab and Comm Center are built by the Base; Space Dock and Sensor
    // Array are built by the High Port — each must still be standing.
    if (p.buildIndex >= FREIGHTER_BUILT && p.buildIndex < BUILD_ORDER.length) {
      const type = BUILD_ORDER[p.buildIndex];
      const builder = PLANETARY.includes(type) ? 'base' : 'highport';
      if (p.structures[builder] && p.finished > M.buildDrain + 8) {
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
// AI factions no longer flag planets abstractly — their fighters must
// physically fly to a neutral planet and land, just like the player.
// This function only expires stale claims so planets don't lock forever.
function updateAiFlags() {
  for (const p of planets) {
    if (p.flaggedBy && p.flaggedBy !== 'player' && !p.owner) {
      p.flagAge = (p.flagAge || 0) + 1;
      if (p.flagAge > 4200) { p.flaggedBy = null; p.flagAge = 0; }
    } else {
      p.flagAge = 0;
    }
  }
}

/* --- Freighter unit AI: load raw cargo, deliver, be consumed building --- */
function updateFreighters() {
  for (const f of freighters) {
    const spd = freighterSpd(f.owner);

    if (f.state === 'idle') {
      if (f.cargo >= CONFIG.freighterUnit.cargoCap) {
        // Full: FINISH existing colonies first (they're defenseless
        // without a High Port), then answer new flags
        let target = planets.find(p =>
          p.owner === f.owner && p.buildIndex < FREIGHTER_BUILT
        );
        if (!target) {
          target = planets.find(p => p.flaggedBy === f.owner && !p.owner);
        }
        if (target) { f.target = target; f.state = 'toTarget'; }
        // else: stay idle, loaded and ready
      } else {
        // Not full: find a colony to load from, preferring one that no
        // other freighter of ours is already working
        let best = null, bd = Infinity;
        for (const p of planets) {
          if (p.owner === f.owner && p.structures.colony) {
            const busy = freighters.some(q =>
              q !== f && q.owner === f.owner && q.target === p &&
              (q.state === 'loading' || q.state === 'toColony'));
            const d = dist(f, p) + (busy ? 100000 : 0);
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
        // Park at the colony and load until FULL — if the raw pool runs
        // momentarily dry, wait for production rather than wandering off
        const amt = Math.min(CONFIG.freighterUnit.loadRate, Math.max(0, p.raw),
                             CONFIG.freighterUnit.cargoCap - f.cargo);
        p.raw -= amt;
        f.cargo += amt;
        if (f.cargo >= CONFIG.freighterUnit.cargoCap) { f.state = 'idle'; f.target = null; }
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
        if (dist(f, p) < p.r + 42) {
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
            // Build whatever the chain needs next (Colony, then High Port)
            const type = BUILD_ORDER[p.buildIndex];
            addStructure(p, type);
            p.buildIndex++;
            p.buildProgress = 0;
            if (f.owner === 'player') {
              score += 150;
              flashMsg('Freighter consumed — ' + STRUCTS[type].name + ' constructed on ' + p.name, 2500);
            } else if (p.revealed) {
              flashMsg(CONFIG.factions[f.owner].label + ' built a ' + STRUCTS[type].name + ' on ' + p.name, 2200);
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
  // Detour around planets that are not the destination — and all stars
  for (const p of planets) {
    if (p === target) continue;
    const pd = dist(obj, p);
    const margin = p.r + 26;
    if (pd < margin && pd > 0.1) {
      const nx = (obj.x - p.x) / pd, ny = (obj.y - p.y) / pd;
      obj.x += nx * (margin - pd) * 0.35;
      obj.y += ny * (margin - pd) * 0.35;
    }
  }
  for (const s of suns) {
    const sd = dist(obj, s);
    const margin = s.r + 110;
    if (sd < margin && sd > 0.1) {
      const nx = (obj.x - s.x) / sd, ny = (obj.y - s.y) / sd;
      const push = (margin - sd);
      // Tangential steering: slide AROUND the sun toward the target side,
      // not just straight back — prevents pursuit-orbit traps
      let tx2 = -ny, ty2 = nx;
      const wantX = target.x - obj.x, wantY = target.y - obj.y;
      if (tx2 * wantX + ty2 * wantY < 0) { tx2 = -tx2; ty2 = -ty2; }
      obj.x += nx * push * 0.25 + tx2 * push * 0.35;
      obj.y += ny * push * 0.25 + ty2 * push * 0.35;
    }
  }
}

function fireMissile() {
  ship.missiles--;
  Snd.missile();
  // Lock the nearest enemy within range at launch
  let lock = null, ld = 520;
  for (const e of enemies) {
    const d = dist(ship, e);
    if (d < ld) { ld = d; lock = e; }
  }
  missiles.push({
    x: ship.x + Math.cos(ship.angle) * 15,
    y: ship.y + Math.sin(ship.angle) * 15,
    vx: Math.cos(ship.angle) * CONFIG.missiles.speed + ship.vx * 0.4,
    vy: Math.sin(ship.angle) * CONFIG.missiles.speed + ship.vy * 0.4,
    target: lock,
    life: 1,
  });
}

function updateMissiles() {
  for (const m of missiles) {
    m.life -= 0.006;

    // Homing: white missiles steer toward their locked target
    if (m.target && m.target.hull > 0) {
      const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
      const cur = Math.atan2(m.vy, m.vx);
      let diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const turn = Math.max(-CONFIG.missiles.turnRate, Math.min(CONFIG.missiles.turnRate, diff));
      const spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
      const na = cur + turn;
      m.vx = Math.cos(na) * spd;
      m.vy = Math.sin(na) * spd;
    } else {
      m.target = null;
    }
    m.x += m.vx; m.y += m.vy;

    // Impact: enemy fighters
    for (const e of enemies) {
      if (dist(m, e) < e.r + 6) {
        e.hull -= CONFIG.missiles.damage;
        m.life = 0;
        spawnPart(e.x, e.y, '#fff', 20);
        Snd.hit();
        if (e.hull <= 0) {
          spawnPart(e.x, e.y, CONFIG.factions[e.faction].color, 30);
          score += 150; credits += 15;
          e.hull = -999;
        }
        break;
      }
    }
    if (m.life <= 0) continue;

    // Impact: enemy structures, then planet cores
    for (const p of planets) {
      if (p.owner && p.owner !== 'player') {
        for (const type of Object.keys(p.structures)) {
          if (dist(m, structPos(p, type)) < 15) {
            damageStructure(p, type, 40, m.x, m.y);
            m.life = 0;
            Snd.hit();
            break;
          }
        }
      }
      if (m.life <= 0) break;
      if (dist(m, p) < p.r * CONFIG.planets.coreFrac) { m.life = 0; spawnPart(m.x, m.y, '#fff', 10); break; }
    }
    if (m.life > 0 && sunContact(m, 0)) { m.life = 0; spawnPart(m.x, m.y, '#ffd94a', 8); }
  }
  enemies = enemies.filter(e => e.hull > -900);
  missiles = missiles.filter(m => m.life > 0 && m.x > -100 && m.x < WORLD_W + 100 && m.y > -100 && m.y < WORLD_H + 100);
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
    const fac = CONFIG.factions[e.faction];
    e.flicker += 1;
    if (e.shootTimer > 0) e.shootTimer--;

    /* --- LANDED: sitting on a planet planting a flag (vulnerable!) --- */
    if (e.state === 'landed') {
      const p = e.targetPlanet;
      if (!p || p.owner || (p.flaggedBy && p.flaggedBy !== e.faction)) {
        // Beaten to it — lift off
        e.state = 'hunt'; e.targetPlanet = null;
        e.landAngle = undefined;
        continue;
      }
      // Pinned to the rim at the stored landing bearing, nose out
      if (e.landAngle === undefined) e.landAngle = Math.atan2(e.y - p.y, e.x - p.x);
      const a = e.landAngle;
      e.x = p.x + Math.cos(a) * (p.r + 7);
      e.y = p.y + Math.sin(a) * (p.r + 7);
      e.vx = 0; e.vy = 0;
      e.angle = a;
      e.landTimer--;
      if (e.landTimer <= 0) {
        p.flaggedBy = e.faction;
        if (p.revealed) flashMsg(p.name + ' flagged by ' + fac.label + ' — their freighters are coming', 2800);
        // Lift off
        e.state = 'hunt'; e.targetPlanet = null;
        e.landAngle = undefined;
        e.vx = Math.cos(a) * 0.9; e.vy = Math.sin(a) * 0.9;
      }
      continue;
    }

    applyGravityTo(e);

    /* --- APPROACH: decelerating in to land and plant a flag --- */
    if (e.state === 'approach') {
      const p = e.targetPlanet;
      if (!p || p.owner || (p.flaggedBy && p.flaggedBy !== e.faction)) {
        e.state = 'hunt'; e.targetPlanet = null;
      } else {
        const dx = p.x - e.x, dy = p.y - e.y, dd = Math.sqrt(dx * dx + dy * dy);
        const spd = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
        if (dd > p.r + 110) {
          // Cruise toward the planet
          e.angle = Math.atan2(dy, dx);
          e.vx += Math.cos(e.angle) * CONFIG.fighterUnit.accel * fac.speedMult;
          e.vy += Math.sin(e.angle) * CONFIG.fighterUnit.accel * fac.speedMult;
        } else {
          // Final descent, flown like the player: rotate nose-out,
          // retro-burn against velocity, let gravity settle them down
          e.angle = Math.atan2(e.y - p.y, e.x - p.x);
          e.vx *= 0.955; e.vy *= 0.955;
          e.vx += (dx / dd) * 0.008;
          e.vy += (dy / dd) * 0.008;
        }
        if (dd < p.r + 10 && spd < 0.7) {
          e.state = 'landed';
          e.landAngle = Math.atan2(e.y - p.y, e.x - p.x);
          e.landTimer = 160;   // time to plant the flag — shoot them before it's up!
          if (p.revealed) flashMsg(fac.label + ' scout landing on ' + p.name + '!', 2200);
          continue;            // pinned starting next frame
        }
      }
    }

    /* --- HUNT: pick objectives, dogfight, raid --- */
    if (e.state === 'hunt') {

      // Priority 1: intercept player freighters nearby
      const pers = persOf(e.faction);
      if (!e.targetFreighter || e.targetFreighter.hull <= 0) {
        e.targetFreighter = null;
        if (Math.random() < fac.aggression * pers.aggro * 0.03) {
          for (const f of freighters) {
            if (f.owner === 'player' && dist(e, f) < 420) { e.targetFreighter = f; break; }
          }
        }
      }

      // Priority 2: claim missions — land on a neutral planet to flag it,
      // just like the player does (only if the faction has no pending claim)
      if (!e.targetFreighter && Math.random() < pers.claim) {
        const pending = planets.some(q => q.flaggedBy === e.faction && !q.owner);
        if (!pending) {
          const neutral = planets.filter(q => !q.owner && !q.flaggedBy);
          if (neutral.length > 0) {
            e.targetPlanet = neutral[Math.floor(Math.random() * neutral.length)];
            e.state = 'approach';
          }
        }
      }

      // Priority 3: raid player planets
      if (e.state === 'hunt' && !e.targetFreighter) {
        if (!e.targetPlanet || e.targetPlanet.owner !== 'player') {
          const yours = planets.filter(q => q.owner === 'player');
          e.targetPlanet = (yours.length > 0 && Math.random() < Math.min(0.95, fac.aggression * pers.aggro))
            ? yours[Math.floor(Math.random() * yours.length)]
            : null;
        }
      }
    }

    if (e.state === 'hunt') {
      const pers2 = persOf(e.faction);
      let tx, ty, dogfight = false;
      const distToShip = dist(e, ship);
      if (e.targetFreighter) {
        tx = e.targetFreighter.x; ty = e.targetFreighter.y; dogfight = true;
      } else if ((!e.targetPlanet || (Math.random() < fac.aggression * pers2.aggro * 0.02 && distToShip < 500)) && !ship.dead) {
        tx = ship.x; ty = ship.y; dogfight = true;
      } else if (e.targetPlanet) {
        tx = e.targetPlanet.x; ty = e.targetPlanet.y;
      } else {
        tx = ship.x; ty = ship.y; dogfight = true;
      }

      const dx = tx - e.x, dy = ty - e.y, dd = Math.sqrt(dx * dx + dy * dy);
      const toTarget = Math.atan2(dy, dx);
      e.angle = toTarget + (Math.random() - 0.5) * 0.2;

      if (dogfight && dd < 150) {
        // Air combat: don't ram — break into a strafing arc around the target
        if (!e.strafeDir) e.strafeDir = Math.random() < 0.5 ? 1 : -1;
        const strafe = toTarget + e.strafeDir * 1.35;
        e.vx += Math.cos(strafe) * CONFIG.fighterUnit.accel * fac.speedMult;
        e.vy += Math.sin(strafe) * CONFIG.fighterUnit.accel * fac.speedMult;
      } else if (dd > 110) {
        e.vx += Math.cos(e.angle) * CONFIG.fighterUnit.accel * fac.speedMult;
        e.vy += Math.sin(e.angle) * CONFIG.fighterUnit.accel * fac.speedMult;
      }

      // Shoot at the intercepted freighter
      if (e.targetFreighter && dd < 260 && e.shootTimer <= 0) {
        fireAimedShot(e.x, e.y, e.targetFreighter, true, e.r + 5);
        e.shootTimer = (90 + Math.random() * 100) / (pers2.fireRate * sectorFire());
      }

      // Raid player structures
      if (e.targetPlanet && e.targetPlanet.owner === 'player' && dd < e.targetPlanet.r + 240) {
        if (e.shootTimer <= 0) {
          const types = Object.keys(e.targetPlanet.structures);
          if (types.length > 0) {
            const t = types[Math.floor(Math.random() * types.length)];
            fireAimedShot(e.x, e.y, structPos(e.targetPlanet, t), true, e.r + 5);
            e.shootTimer = (100 + Math.random() * 120) / (pers2.fireRate * sectorFire());
          }
        }
      }

      // Fire at the player's fighter
      if (e.shootTimer <= 0 && distToShip < fac.shootRange && !ship.dead) {
        fireShot(e, true);
        e.shootTimer = (110 + Math.random() * 130) / (pers2.fireRate * sectorFire());
      }
    }

    // Stars consume careless fighters
    const sHit = sunContact(e);
    if (sHit) {
      e.hull = -999;
      spawnPart(e.x, e.y, '#ffd94a', 30);
      continue;
    }
    // Steer well clear of stars: radial push + tangential slide
    for (const s of suns) {
      const d = dist(e, s);
      const margin = s.r + 100;
      if (d < margin && d > 0.1) {
        const push = (margin - d) / margin;
        const nx = (e.x - s.x) / d, ny = (e.y - s.y) / d;
        let tx2 = -ny, ty2 = nx;
        if (tx2 * e.vx + ty2 * e.vy < 0) { tx2 = -tx2; ty2 = -ty2; }
        e.vx += nx * push * 0.2 + tx2 * push * 0.22;
        e.vy += ny * push * 0.2 + ty2 * push * 0.22;
      }
    }

    /* --- Planet avoidance: steer around surfaces they aren't landing on --- */
    for (const p of planets) {
      if (e.state === 'approach' && p === e.targetPlanet) continue;
      const d = dist(e, p);
      const margin = p.r + 48;
      if (d < margin && d > 0.1) {
        const push = (margin - d) / margin;          // stronger the deeper they are
        const nx = (e.x - p.x) / d, ny = (e.y - p.y) / d;
        e.vx += nx * push * 0.2;
        e.vy += ny * push * 0.2;
      }
    }

    /* --- Movement, speed cap, and REAL crashes (no more teleporting) --- */
    const maxSpd = CONFIG.fighterUnit.maxSpeed * fac.speedMult * persOf(e.faction).speed;
    const spd2 = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
    if (spd2 > maxSpd) { e.vx = e.vx / spd2 * maxSpd; e.vy = e.vy / spd2 * maxSpd; }
    e.x += e.vx; e.y += e.vy;
    e.x = Math.max(0, Math.min(WORLD_W, e.x));
    e.y = Math.max(0, Math.min(WORLD_H, e.y));

    // Surface contact: identical rules to the player's fighter.
    // Fast impact destroys them; slow contact damages and bounces —
    // unless they are on final approach to land on this planet.
    for (const p of planets) {
      const d = dist(e, p);
      if (d >= p.r + 2) continue;
      const spd3 = Math.sqrt(e.vx * e.vx + e.vy * e.vy);

      if (e.state === 'approach' && p === e.targetPlanet && spd3 < 0.9) {
        // Clipped the rim during a slow final approach: touchdown
        e.state = 'landed';
        e.landAngle = Math.atan2(e.y - p.y, e.x - p.x);
        e.landTimer = 160;
        if (p.revealed) flashMsg(fac.label + ' scout landing on ' + p.name + '!', 2200);
        break;
      }

      if (spd3 > CONFIG.ship.crashSpeed) {
        e.hull = -999;
        spawnPart(e.x, e.y, fac.color, 30);
        if (p.revealed) flashMsg(fac.label + ' fighter crashed on ' + p.name, 1800);
      } else {
        // Rough contact: hull damage and a bounce off the surface
        e.hull -= 7;
        spawnPart(e.x, e.y, '#e8b030', 8);
        const nx = (e.x - p.x) / Math.max(d, 0.1), ny = (e.y - p.y) / Math.max(d, 0.1);
        e.x = p.x + nx * (p.r + 3);
        e.y = p.y + ny * (p.r + 3);
        const inward = e.vx * -nx + e.vy * -ny;
        if (inward > 0) {
          e.vx += nx * inward * 1.5;
          e.vy += ny * inward * 1.5;
        }
        if (e.hull <= 0) {
          e.hull = -999;
          spawnPart(e.x, e.y, fac.color, 25);
        }
      }
      break;
    }
  }
  enemies = enemies.filter(e => e.hull > -900);
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
      if (b.life <= 0) break;

      // Structures inside the disc are hittable — check them first
      if (p.owner) {
        const hostileToPlanet = (p.owner === 'player') === b.isEnemy;
        if (hostileToPlanet) {
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
      if (b.life <= 0) break;

      // Shots only stop at the planet's dense core, so you can
      // fire across the disc at the buildings — like the original
      if (dist(b, p) < p.r * CONFIG.planets.coreFrac) { b.life = 0; break; }
    }
    if (b.life > 0 && sunContact(b, 0)) b.life = 0;
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
        b.life = 0;
        Snd.hit();
        // Shields absorb damage before the hull, like the original
        if (ship.shields > 0) {
          ship.shields = Math.max(0, ship.shields - 12);
          spawnPart(ship.x, ship.y, '#7ecfff', 8);
        } else {
          ship.hull -= 10;
          spawnPart(ship.x, ship.y, '#e87a30', 10);
          if (ship.hull <= 0) shipDestroyed();
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
    Snd.develop();
    flashMsg('LABS HAVE A NEW DEVELOPMENT — land at a base to install!', 4000);
  }
}

function checkWinLose() {
  if (gameState !== 'playing') return;

  const counts = { player: 0, ashkari: 0, pale: 0, vorath: 0 };
  for (const p of planets) if (p.owner) counts[p.owner]++;

  if (counts.player === 0) {
    gameState = 'dead';
    endCampaign('DEFEAT');
    return;
  }
  if (counts.player >= winNeed) {
    gameState = 'won';
    score += 500 * sectorNum;
    flashMsg('SECTOR ' + sectorNum + ' SECURED — press ENTER to warp to the next sector', 99999);
    return;
  }
  if (counts.ashkari === 0 && counts.pale === 0 && counts.vorath === 0) {
    gameState = 'won';
    score += 800 * sectorNum;
    flashMsg('Sector ' + sectorNum + ' cleansed of rivals — press ENTER to warp onward', 99999);
    return;
  }
  for (const f of ['ashkari', 'pale', 'vorath']) {
    if (counts[f] >= winNeed) {
      gameState = 'dead';
      flashMsg('Sector lost to ' + CONFIG.factions[f].label + ' — Restart to try again', 9999);
    }
  }
}

function selTarget() {
  if (selected) {
    if (selected.kind === 'freighter') {
      const f = freighters.find(q => q.fid === selected.fid);
      if (f) return f;
      selected = null;
    } else if (selected.kind === 'planet') {
      if (selected.p.owner === 'player') return selected.p;
      selected = null;
    }
  }
  return ship;
}

function updateCamera() {
  const t = selTarget();
  cam.x = t.x - viewW() / 2;
  cam.y = t.y - viewH() / 2;
  cam.x = Math.max(0, Math.min(WORLD_W - viewW(), cam.x));
  cam.y = Math.max(0, Math.min(WORLD_H - viewH(), cam.y));
}

function update() {
  if (gameState !== 'playing' || shopOpen) return;
  updateOrbits();
  handleInput();
  updateShip();
  updateRespawn();
  updateMissiles();
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

  autosaveTimer++;
  if (autosaveTimer >= 600) { autosaveTimer = 0; saveCampaign(); }
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
  if (selected && selected.kind === 'freighter' && selected.fid === f.fid) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(s.x - 16, s.y - 12, 32, 24);
  }
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

    // Planet disc: dark ground with the classic perimeter circle
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12, 18, 28, 0.9)';
    ctx.fill();
    ctx.strokeStyle = p.owner ? 'rgba(60, 200, 100, 0.75)' : p.strokeColor;
    ctx.lineWidth = p.owner ? 1.4 : 1;
    ctx.stroke();

    if (p.owner) {
      const col = factionColor(p.owner);

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
      const bw = p.r * 1.3;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 34, bw, 3);
      ctx.fillStyle = '#3fae52';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 34, bw * (p.raw / CONFIG.materials.cap), 3);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 39, bw, 3);
      ctx.fillStyle = '#3f6fd0';
      ctx.fillRect(sc.x - bw / 2, sc.y + p.r + 39, bw * (p.finished / CONFIG.materials.cap), 3);
    }

    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = p.owner ? factionColor(p.owner) : p.strokeColor;
    ctx.fillText(p.name, sc.x, sc.y - p.r - 34);
    if (p.owner === 'player') ctx.fillText('YOURS', sc.x, sc.y - p.r - 46);
    else if (p.owner) ctx.fillText(CONFIG.factions[p.owner].label, sc.x, sc.y - p.r - 46);
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
function drawRadar() {
  const rw = radarC.width, rh = radarC.height;
  rctx.fillStyle = '#05070c';
  rctx.fillRect(0, 0, rw, rh);
  const sx = rw / WORLD_W, sy = rh / WORLD_H;

  rctx.fillStyle = '#ffd94a';
  for (const s of suns) {
    rctx.beginPath(); rctx.arc(s.x * sx, s.y * sy, 3.5, 0, Math.PI * 2); rctx.fill();
  }

  for (const p of planets) {
    const px = p.x * sx, py = p.y * sy;
    if (!p.revealed) {
      rctx.fillStyle = '#1a2535';
      rctx.beginPath(); rctx.arc(px, py, 2, 0, Math.PI * 2); rctx.fill();
      continue;
    }
    rctx.fillStyle = '#2ad67a';
    rctx.beginPath(); rctx.arc(px, py, 2.5, 0, Math.PI * 2); rctx.fill();
    if (p.owner) {
      rctx.strokeStyle = factionColor(p.owner);
      rctx.lineWidth = 1;
      rctx.strokeRect(px - 5, py - 5, 10, 10);
    }
  }

  rctx.fillStyle = '#b8c8d0';
  for (const f of freighters) rctx.fillRect(f.x * sx - 1, f.y * sy - 1, 2, 2);

  for (const e of enemies) {
    rctx.fillStyle = CONFIG.factions[e.faction].color;
    rctx.fillRect(e.x * sx - 1, e.y * sy - 1, 2, 2);
  }

  if (!ship.dead) {
    rctx.fillStyle = '#fff';
    rctx.fillRect(ship.x * sx - 1.5, ship.y * sy - 1.5, 3, 3);
  }

  // White box around the selected unit
  const t = selTarget();
  rctx.strokeStyle = '#fff';
  rctx.lineWidth = 1;
  rctx.strokeRect(t.x * sx - 6, t.y * sy - 6, 12, 12);

  // Current view window
  rctx.strokeStyle = 'rgba(100,180,255,0.35)';
  rctx.strokeRect(cam.x * sx, cam.y * sy, viewW() * sx, viewH() * sy);
}

function drawDial(cx, cy, r, angle, color, bgAlert) {
  dctx.beginPath();
  dctx.arc(cx, cy, r, 0, Math.PI * 2);
  dctx.fillStyle = bgAlert ? 'rgba(140,25,25,0.75)' : '#0a1018';
  dctx.fill();
  dctx.strokeStyle = '#2a3f5a';
  dctx.lineWidth = 1;
  dctx.stroke();
  if (angle !== null) {
    dctx.strokeStyle = color;
    dctx.lineWidth = 1.6;
    dctx.beginPath();
    dctx.moveTo(cx, cy);
    dctx.lineTo(cx + Math.cos(angle) * (r - 3), cy + Math.sin(angle) * (r - 3));
    dctx.stroke();
  }
}

function drawDials() {
  dctx.fillStyle = '#05070c';
  dctx.fillRect(0, 0, dialsC.width, dialsC.height);

  // Nearest star (yellow)
  let ns = null, nsd = Infinity;
  for (const s of suns) {
    const d = dist(ship, s);
    if (d < nsd) { nsd = d; ns = s; }
  }
  drawDial(24, 23, 13, ns ? Math.atan2(ns.y - ship.y, ns.x - ship.x) : null, '#ffd94a', false);

  // Nearest planet (green)
  let np = null, npd = Infinity;
  for (const p of planets) {
    if (!p.revealed) continue;
    const d = dist(ship, p);
    if (d < npd) { npd = d; np = p; }
  }
  drawDial(66, 23, 13, np ? Math.atan2(np.y - ship.y, np.x - ship.x) : null, '#2ad67a', false);

  // Nearest enemy (red, background alerts when close)
  let ne = null, ned = Infinity;
  for (const e of enemies) {
    const d = dist(ship, e);
    if (d < ned) { ned = d; ne = e; }
  }
  drawDial(110, 23, 13, ne ? Math.atan2(ne.y - ship.y, ne.x - ship.x) : null, '#e85850', ned < 320);

  // Fighter orientation (white)
  drawDial(152, 23, 13, ship.angle, '#fff', false);
}


function draw() {
  const vz = vzoom();
  ctx.setTransform(vz, 0, 0, vz, 0, 0);
  ctx.fillStyle = '#07090f';
  ctx.fillRect(0, 0, viewW(), viewH());

  for (const s of stars) {
    let px = (s.x - cam.x * s.layer) % viewW();
    let py = (s.y - cam.y * s.layer) % viewH();
    if (px < 0) px += viewW();
    if (py < 0) py += viewH();
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, py, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Suns with a layered glow
  for (const s of suns) {
    if (!onScreen(s.x, s.y, 120)) continue;
    const sc = worldToScreen(s.x, s.y);
    ctx.save();
    ctx.fillStyle = 'rgba(255,217,74,0.06)';
    ctx.beginPath(); ctx.arc(sc.x, sc.y, s.r * 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,217,74,0.14)';
    ctx.beginPath(); ctx.arc(sc.x, sc.y, s.r * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd94a';
    ctx.beginPath(); ctx.arc(sc.x, sc.y, s.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff2c0';
    ctx.beginPath(); ctx.arc(sc.x, sc.y, s.r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // Faint orbit paths
  ctx.strokeStyle = 'rgba(80,120,160,0.10)';
  ctx.lineWidth = 1;
  for (const p of planets) {
    const sc = worldToScreen(p.sun.x, p.sun.y);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, p.orbitR, 0, Math.PI * 2);
    ctx.stroke();
  }

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

  for (const m of missiles) {
    if (!onScreen(m.x, m.y, 10)) continue;
    const s = worldToScreen(m.x, m.y);
    const a = Math.atan2(m.vy, m.vx);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-5, 0); ctx.stroke();
    ctx.restore();
    spawnPart(m.x - Math.cos(a) * 6, m.y - Math.sin(a) * 6, '#e8c060', 1);
  }

  if (!ship.dead) drawShip(ship.x, ship.y, ship.angle, ship.thrust);

  drawLandingPrompt();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (gameState === 'won' || gameState === 'dead') drawEndScreen();

  drawRadar();
  drawDials();
}

function drawEndScreen() {
  ctx.save();
  ctx.fillStyle = gameState === 'won' ? 'rgba(6, 20, 10, 0.72)' : 'rgba(20, 6, 6, 0.72)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = gameState === 'won' ? '#5dffaa' : '#ff8080';
  ctx.font = '30px monospace';
  ctx.fillText(gameState === 'won' ? 'SECTOR ' + sectorNum + ' SECURED' : 'CAMPAIGN LOST', W / 2, H / 2 - 30);

  ctx.fillStyle = '#cfe4f4';
  ctx.font = '14px monospace';
  ctx.fillText('Score ' + score + '  ·  Sector ' + sectorNum, W / 2, H / 2 + 2);

  ctx.fillStyle = '#8ab4d4';
  ctx.font = '13px monospace';
  if (gameState === 'won') {
    ctx.fillText('press ENTER to warp to the next sector', W / 2, H / 2 + 34);
  } else {
    ctx.fillText('press the Restart button for a new campaign', W / 2, H / 2 + 34);
    const scores = getHiScores();
    if (scores.length && scores[0].score === score) {
      ctx.fillStyle = '#ffd94a';
      ctx.fillText('★ NEW BEST CAMPAIGN ★', W / 2, H / 2 + 58);
    }
  }
  ctx.restore();
}

/* ---------- 7. LOOP ---------- */
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

if (sideEls.version) sideEls.version.textContent = GAME_VERSION;
try { console.log('Gravity Well: Reclaimed — ' + GAME_VERSION); } catch (e) {}

init();
loop();
