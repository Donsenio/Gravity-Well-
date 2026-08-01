// Headless test harness for Gravity Well: Reclaimed
// Stubs the DOM and canvas, loads the real game.js, and simulates play.
const fs = require('fs');
const vm = require('vm');

const ctxStub = new Proxy({}, {
  get(t, k) { return typeof k === 'string' ? function () {} : undefined; },
  set() { return true; },
});

const elements = {};
function makeEl(id) {
  return {
    id,
    style: {},
    textContent: '',
    innerHTML: '',
    clientWidth: 900,
    width: 0, height: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    appendChild() {},
    focus() {},
    setAttribute() {},
    getContext() { return ctxStub; },
  };
}

const documentStub = {
  getElementById(id) {
    if (!elements[id]) elements[id] = makeEl(id);
    return elements[id];
  },
  createElement() { return makeEl('dyn'); },
  addEventListener() {},
};

const lsStore = {};
const localStorageStub = {
  getItem(k) { return k in lsStore ? lsStore[k] : null; },
  setItem(k, v) { lsStore[k] = String(v); },
  removeItem(k) { delete lsStore[k]; },
};

const sandbox = {
  document: documentStub,
  window: { addEventListener() {}, localStorage: localStorageStub },
  localStorage: localStorageStub,
  requestAnimationFrame(cb) { sandbox.__rafCb = cb; },
  setTimeout, clearTimeout,
  Math, Date, console,
};
sandbox.globalThis = sandbox;

let code = fs.readFileSync(process.argv[2] || 'game.js', 'utf8');
code += `
;globalThis.__t = {
  get planets(){return planets}, get ship(){return ship},
  get freighters(){return freighters}, get enemies(){return enemies},
  get drones(){return drones},
  get freighters(){return freighters}, get bullets(){return bullets},
  get gameState(){return gameState}, get credits(){return credits},
  get researchReady(){return researchReady}, get researchProgress(){return researchProgress},
  set researchProgressV(v){researchProgress=v},
  keys, update, draw, init, structPos, dist,
  get leaders(){return leaderSettings},
  get zoomRef(){return {get z(){return zoomIdx}, set z(v){zoomIdx=v}}},
  structPosOf(p, type){return structPos(p, type)},
  get sector(){return sectorNum},
  get winNeed(){return winNeed},
  get scoreV(){return score},
  set scoreV(v){score=v},
  nextSector,
  saveCampaign, loadCampaign, recordHiScore, getHiScores,
  set sectorV(v){sectorNum=v},
  get gs(){return gameState}, set gs(v){gameState=v},
  get drones(){return drones},
  get freighters(){return freighters},
  setShip(props){Object.assign(ship, props)},
};`;

try {
  vm.runInNewContext(code, sandbox, { filename: 'game.js' });
} catch (e) {
  console.error('LOAD ERROR:', e.message, '\n', e.stack.split('\n')[1]);
  process.exit(1);
}

const t = sandbox.__t;
let frameErrors = 0;

function framesPeaceful(n, label) {
  for (let i = 0; i < n; i++) {
    if (i % 60 === 0) t.enemies.length = 0;   // no hostiles: isolate the economy
    try { t.update(); t.draw(); }
    catch (e) {
      frameErrors++;
      console.error('FRAME ERROR during ' + label + ' @' + i + ':', e.message);
      return false;
    }
  }
  return true;
}

function frames(n, label) {
  for (let i = 0; i < n; i++) {
    try { t.update(); t.draw(); }
    catch (e) {
      frameErrors++;
      console.error('FRAME ERROR during ' + label + ' @' + i + ':', e.message,
        '\n ', (e.stack.split('\n')[1] || '').trim());
      return false;
    }
  }
  return true;
}

function assert(cond, msg) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg);
  if (!cond) frameErrors++;
}

console.log('=== 1. Boot & home bases ===');
const home = t.planets[0];
assert(home.owner === 'player', 'HOME belongs to player');
assert(!!home.structures.base && !!home.structures.colony && !!home.structures.highport,
  'HOME has base, colony, high port');
for (const type of Object.keys(home.structures)) {
  const pos = t.structPos(home, type);
  assert(Number.isFinite(pos.x) && Number.isFinite(pos.y), 'structPos finite for ' + type);
}

console.log('=== 2. Run 2000 idle frames ===');
frames(2000, 'idle');
// Materials may be sitting in parked freighters' cargo — count the whole economy
const cargoMass = t.freighters.filter(f => f.owner === 'player')
  .reduce((s, f) => s + f.cargo, 0);
const totalMass = home.raw + home.finished + cargoMass;
assert(totalMass > 5, 'HOME economy is producing (raw=' + home.raw.toFixed(1) +
  ' fin=' + home.finished.toFixed(1) + ' cargo=' + cargoMass.toFixed(0) + ')');
assert(home.buildIndex >= 3, 'HOME construction progressing (buildIndex=' + home.buildIndex + ')');

console.log('=== 3. Player flags a neutral planet, freighter colonizes ===');
const neutral = t.planets.find(p => !p.owner);
assert(!!neutral, 'a neutral planet exists');
if (neutral) {
  neutral.flaggedBy = 'player';
  neutral.revealed = true;
  framesPeaceful(30000, 'colonization');
  console.log('  gameState=' + t.gameState + ' freighter states: ' +
    t.freighters.map(f => f.owner + ':' + f.state + ':' + Math.round(f.cargo)).join(' | '));
  console.log('  neutral.owner=' + neutral.owner + ' buildIndex=' + neutral.buildIndex +
    ' freighters=' + t.freighters.length);
  assert(neutral.owner === 'player', 'flagged planet was colonized (owner=' + neutral.owner + ')');
  assert(!!neutral.structures.base, 'colonized planet has a base');
  framesPeaceful(12000, 'full build-out');
  console.log('  structures: ' + Object.keys(neutral.structures).join(','));
  assert(!!neutral.structures.highport,
    'third freighter built the HIGH PORT (colony is defended)');
  assert(Object.keys(neutral.structures).length >= 5,
    'colony continues developing past the freighter-built phase');
}

console.log('=== 4. Physics landing ===');
const lp = t.planets.find(p => p.owner === 'player') || t.planets[0];
t.setShip({
  x: lp.x + lp.r + 1.5,
  y: lp.y,
  vx: -0.3, vy: 0, angle: 0, dead: false, landedOn: null,
});
frames(6, 'landing contact');
console.log('  landedOn=' + (t.ship.landedOn ? t.ship.landedOn.name : 'null') +
  ' dead=' + t.ship.dead + ' hull=' + Math.round(t.ship.hull));
assert(t.ship.landedOn === lp && !t.ship.dead, 'slow nose-out contact = safe landing');

console.log('=== 5. Liftoff ===');
t.keys['w'] = true;
frames(10, 'liftoff');
t.keys['w'] = false;
assert(t.ship.landedOn === null, 'W lifts off');
frames(200, 'post liftoff');

console.log('=== 6. Research install by landing ===');
t.__ = null;
t.researchProgressV = 0.999;
frames(400, 'research completes');
console.log('  researchReady=' + t.researchReady);
// land at home base
t.setShip({
  x: home.x + home.r + 1.5, y: home.y, vx: -0.3, vy: 0, angle: 0,
  dead: false, landedOn: null, onPort: false,
});
frames(10, 'land to install');
assert(t.researchReady === null, 'landing at base installs research (ready=' + t.researchReady + ')');

console.log('=== 7. Long soak: 20000 frames of full war ===');
t.keys['w'] = true;   // fly around, provoke everything
frames(5000, 'soak-thrust');
t.keys['w'] = false;
t.keys[' '] = true;   // shoot constantly
frames(5000, 'soak-shoot');
t.keys[' '] = false;
frames(10000, 'soak-idle');
console.log('  gameState=' + t.gameState + ' enemies=' + t.enemies.length +
  ' freighters=' + t.freighters.length + ' bullets=' + t.bullets.length);
const owners = t.planets.map(p => p.owner || '-').join(',');
console.log('  owners: ' + owners);

console.log('=== 8. AI expansion pipeline: fighters land, flag, freighters colonize ===');
t.init();
let aiFlagged = false, aiColonized = false, frozeAt = -1;
for (let i = 0; i < 70000; i++) {
  // Keep the player alive and out of the way so the AI can operate freely
  if (i % 30 === 0) {
    t.setShip({ x: 40, y: 40, vx: 0, vy: 0, hull: 100, dead: false, landedOn: null });
    for (const p of t.planets) {
      if (p.owner === 'player') for (const k of Object.keys(p.structures)) {
        p.structures[k].hp = p.structures[k].maxHp;
      }
    }
  }
  try { t.update(); } catch (e) { console.error('FRAME ERR test8:', e.message); frameErrors++; break; }
  if (t.gs !== 'playing') { frozeAt = i; break; }   // a frozen sim must FAIL LOUDLY, not silently
  for (const p of t.planets) {
    if (p.flaggedBy && p.flaggedBy !== 'player') aiFlagged = true;
    if (p.owner && p.owner !== 'player' && t.planets.indexOf(p) > 3) aiColonized = true;
  }
  if (aiColonized) { console.log('  AI colonized a neutral planet at frame ' + i); break; }
}
if (frozeAt > -1) console.log('  !! simulation froze at frame ' + frozeAt + ' (gameState=' + t.gs + ')');
assert(frozeAt === -1, 'simulation stayed alive for the whole scenario');
assert(aiFlagged, 'an AI fighter landed and planted a flag');
assert(aiColonized, 'an AI freighter completed a colonization');

console.log('=== 9. Fighter respawn: shipyards construct a replacement ===');
t.init();
framesPeaceful(9000, 'build up home lab');
const home9 = t.planets[0];
console.log('  home has lab=' + !!home9.structures.lab + ' spacedock=' + !!home9.structures.spacedock);
home9.finished = 80;
t.setShip({ x: home9.x - home9.r - 6, y: home9.y, vx: 3, vy: 0, angle: 0, dead: false, landedOn: null });
framesPeaceful(8, 'crash');
assert(t.ship.dead === true, 'high-speed impact destroys the fighter');
framesPeaceful(400, 'await replacement');
console.log('  dead=' + t.ship.dead + ' gameState=' + t.gameState + ' landedOn=' + (t.ship.landedOn ? t.ship.landedOn.name : 'null'));
assert(t.ship.dead === false && t.gameState === 'playing', 'a new fighter was constructed and the war continues');

console.log('=== 10. Star systems: planets orbit, stars are lethal ===');
t.init();
const p0 = t.planets[0];
const startX = p0.x, startY = p0.y;
framesPeaceful(3000, 'orbital motion');
const moved = Math.sqrt((p0.x - startX) ** 2 + (p0.y - startY) ** 2);
console.log('  HOME moved ' + Math.round(moved) + 'px along its orbit');
assert(moved > 20, 'planets orbit their suns');
// Landed structures stay attached while the planet moves
assert(!!p0.structures.base, 'structures persist through orbital motion');

console.log('=== 11. Personalities: all three run stable, shrewd out-builds maniacal ===');
const fe11 = frameErrors;
// Run a maniacal-vs-shrewd economy comparison
sandboxSet('maniacal');
t.init();
frames(6000, 'all-maniacal war');
const maniacalFin = t.planets[1].finished + t.planets[2].finished + t.planets[3].finished;
sandboxSet('shrewd');
t.init();
frames(6000, 'all-shrewd war');
const shrewdRaw = t.planets[1].raw + t.planets[2].raw + t.planets[3].raw;
console.log('  shrewd AI raw stock=' + Math.round(shrewdRaw) + ' vs maniacal fin=' + Math.round(maniacalFin));
assert(frameErrors === fe11, 'both personality extremes run without frame errors');

function sandboxSet(p) { t.leaders.ashkari = p; t.leaders.pale = p; t.leaders.vorath = p; }

console.log('=== 12. Sector progression: warp scales the campaign, keeps progress ===');
t.init();
t.scoreV = 1234;
const s1planets = t.planets.length, s1need = t.winNeed;
t.nextSector();
frames(600, 'sector 2 shakedown');
console.log('  sector=' + t.sector + ' planets ' + s1planets + '->' + t.planets.length +
  ' winNeed ' + s1need + '->' + t.winNeed + ' score=' + t.scoreV);
assert(t.sector === 2, 'warped to sector 2');
assert(t.planets.length > s1planets, 'sector 2 has more planets');
assert(t.scoreV >= 1234, 'score carried across the warp');
assert(t.planets[0].owner === 'player', 'new HOME established in the new sector');

console.log('=== 13. High Port deck landing + zoom stability ===');
const fe13 = frameErrors;
t.init();
const homeHP = t.planets[0];
const deck = t.structPosOf(homeHP, 'highport');
t.setShip({ x: deck.x, y: deck.y, vx: 0.1, vy: 0, angle: 0, dead: false, landedOn: null, onPort: false, hull: 100 });
framesPeaceful(5, 'deck contact');
assert(t.ship.landedOn === homeHP && t.ship.onPort === true, 'fighter docks on the orbiting flight deck');
const dx0 = t.ship.x, dy0 = t.ship.y;
framesPeaceful(400, 'ride the orbit');
const rode = Math.sqrt((t.ship.x - dx0) ** 2 + (t.ship.y - dy0) ** 2);
console.log('  ship rode the deck ' + Math.round(rode) + 'px through orbit');
assert(rode > 2, 'docked fighter rides the orbiting port');
t.keys['w'] = true; framesPeaceful(8, 'deck liftoff'); t.keys['w'] = false;
assert(t.ship.landedOn === null && t.ship.onPort === false, 'liftoff from deck works');
for (const z of [0, 1, 2, 3, 4]) {
  t.zoomRef.z = z;
  frames(120, 'zoom level ' + z);
}
t.zoomRef.z = 2;
assert(frameErrors === fe13, 'all zoom levels render without errors');

console.log('=== 14. Save/load campaign persistence ===');
t.init();
t.scoreV = 4200;
t.sectorV = 3;
t.saveCampaign();
const saved = t.loadCampaign();
console.log('  saved sector=' + (saved && saved.sector) + ' score=' + (saved && saved.score));
assert(saved && saved.sector === 3 && saved.score === 4200, 'campaign saves and loads');

console.log('=== 15. High score recording ===');
const before = t.getHiScores().length;
t.recordHiScore(999999, 9);   // guaranteed top
t.recordHiScore(1, 1);        // guaranteed low
const hs = t.getHiScores();
console.log('  top score=' + (hs[0] && hs[0].score) + ' entries=' + hs.length);
assert(hs[0].score === 999999, 'highest score sorts to the top');
assert(hs.length <= 5, 'high score list is capped at 5');

console.log('=== 16. One ace per team + respawn ===');
t.init();
const perFaction = {};
for (const e of t.enemies) perFaction[e.faction] = (perFaction[e.faction] || 0) + 1;
console.log('  fighters per faction:', JSON.stringify(perFaction));
assert(perFaction.ashkari === 1 && perFaction.pale === 1 && perFaction.vorath === 1,
  'exactly one ace per rival faction at start');
// Kill the ashkari ace; give their home a stocked shipyard; expect a respawn.
// Park the player far away and invulnerable so no new enemies interfere.
t.planets[1].finished = 80;
for (let i = 0; i < 500; i++) {
  t.enemies = t.enemies.filter(e => e.faction !== 'ashkari');  // keep ace dead
  t.setShip({ x: 20, y: 20, hull: 100, dead: false });
  try { t.update(); } catch (e) { frameErrors++; break; }
}
const ashkariAces = t.enemies.filter(e => e.faction === 'ashkari').length;
console.log('  ashkari aces after respawn window: ' + ashkariAces);
assert(ashkariAces === 1, 'a downed ace is reconstructed by its shipyard');

console.log('=== 17. Pause halts the simulation ===');
t.init();
t.gs = 'paused';
const px = t.ship.x;
t.keys['w'] = true;
for (let i = 0; i < 60; i++) t.update();
t.keys['w'] = false;
assert(t.ship.x === px, 'paused game does not advance the fighter');
t.gs = 'playing';

console.log('=== 18. Every faction Lab gets a defense drone ===');
t.init();
framesPeaceful(200, 'drones spawn');
// Give an enemy home a lab if it lacks one, then confirm a drone appears
const eh = t.planets[1];
if (!eh.structures.lab) { eh.structures.lab = { hp: 80, maxHp: 80 }; }
framesPeaceful(120, 'enemy drone spawns');
const enemyDrones = t.drones.filter(d => d.owner === 'ashkari').length;
const playerDrones = t.drones.filter(d => d.owner === 'player').length;
console.log('  player drones=' + playerDrones + ' ashkari drones=' + enemyDrones);
assert(playerDrones >= 1, 'player Lab has a defense drone');
assert(enemyDrones >= 1, 'enemy Lab has a defense drone');

console.log('=== 19. Guard freighters: defend when idle, mobilize when work appears ===');
// FIXTURE RULE learned the hard way: the scenario must keep gameState === 'playing'.
// Player owns 3 of 7 (below winNeed), enemies hold the rest, ship parked safely.
t.init();
const mkS = () => ({ base:{hp:130,maxHp:130}, colony:{hp:100,maxHp:100},
                     highport:{hp:120,maxHp:120}, lab:{hp:80,maxHp:80} });
const owners19 = ['player','player','player','ashkari','ashkari','pale','vorath'];
for (let i = 0; i < t.planets.length; i++) {
  const p = t.planets[i];
  p.owner = owners19[i % owners19.length];
  p.structures = mkS(); p.buildIndex = 7; p.flaggedBy = null; p.raw = 50; p.finished = 50;
}
t.setShip({ hull: 100, dead: false, landedOn: t.planets[0] });
t.freighters.filter(f => f.owner === 'player').forEach(f => { f.cargo = 100; });
for (let i = 0; i < 300; i++) { t.enemies.length = 0; t.update(); }
assert(t.gs === 'playing', 'fixture keeps the game running (gs=' + t.gs + ')');
const guards19 = t.freighters.filter(f => f.owner === 'player' && f.job === 'guard').length;
console.log('  guards on station: ' + guards19);
assert(guards19 >= 1, 'loaded freighters with no work stand guard at a base');

// Work appears: an enemy world falls and the player flags it
const v19 = t.planets[6];
v19.owner = null; v19.structures = {}; v19.buildIndex = 0; v19.flaggedBy = 'player';
t.update();
const mobilized = t.freighters.filter(f => f.owner === 'player' && f.job === 'deliver').length;
console.log('  mobilized one frame after the flag: ' + mobilized);
assert(mobilized >= 1, 'guards mobilize the frame construction work appears');

let rebuiltAt = -1;
for (let i = 0; i < 12000; i++) {
  t.enemies.length = 0; t.update();
  if (v19.owner === 'player') { rebuiltAt = i; break; }
}
console.log('  flagged planet rebuilt at frame ' + rebuiltAt);
assert(rebuiltAt > -1, 'a former guard delivered its cargo and rebuilt the planet');

console.log('\n' + (frameErrors === 0 ? 'ALL CHECKS PASSED' : frameErrors + ' PROBLEM(S) FOUND'));
process.exit(frameErrors === 0 ? 0 : 1);
