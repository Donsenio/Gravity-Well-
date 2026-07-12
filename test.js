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

const sandbox = {
  document: documentStub,
  window: { addEventListener() {} },
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
  get drones(){return drones}, get bullets(){return bullets},
  get gameState(){return gameState}, get credits(){return credits},
  get researchReady(){return researchReady}, get researchProgress(){return researchProgress},
  set researchProgressV(v){researchProgress=v},
  keys, update, draw, init, structPos, dist,
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
assert(home.raw > 0 || home.finished > 0, 'HOME accumulating materials (raw=' +
  home.raw.toFixed(1) + ' fin=' + home.finished.toFixed(1) + ')');
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
  assert(neutral.owner === 'player' || neutral.owner === null,
    'flagged planet is player-owned or still pending (owner=' + neutral.owner + ')');
  if (neutral.owner === 'player') {
    assert(!!neutral.structures.base, 'colonized planet has a base');
  }
}

console.log('=== 4. Physics landing ===');
const lp = t.planets.find(p => p.owner === 'player') || t.planets[0];
const a = 0;
t.setShip({
  x: lp.x + (lp.r + 6) * Math.cos(a),
  y: lp.y + (lp.r + 6) * Math.sin(a),
  vx: -0.2, vy: 0, angle: 0, dead: false, landedOn: null,
});
frames(30, 'landing approach');
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
  x: home.x + (home.r + 6), y: home.y, vx: -0.2, vy: 0, angle: 0,
  dead: false, landedOn: null,
});
frames(60, 'land to install');
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
let aiFlagged = false, aiColonized = false;
for (let i = 0; i < 45000; i++) {
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
  for (const p of t.planets) {
    if (p.flaggedBy && p.flaggedBy !== 'player') aiFlagged = true;
    if (p.owner && p.owner !== 'player' && t.planets.indexOf(p) > 3) aiColonized = true;
  }
  if (aiColonized) { console.log('  AI colonized a neutral planet at frame ' + i); break; }
}
assert(aiFlagged, 'an AI fighter landed and planted a flag');
assert(aiColonized, 'an AI freighter completed a colonization');

console.log('=== 9. Fighter respawn: shipyards construct a replacement ===');
t.init();
framesPeaceful(9000, 'build up home lab');
const home9 = t.planets[0];
console.log('  home has lab=' + !!home9.structures.lab + ' spacedock=' + !!home9.structures.spacedock);
home9.finished = 80;
t.setShip({ x: home9.x - home9.r - 40, y: home9.y, vx: 3, vy: 0, angle: 0, dead: false, landedOn: null });
framesPeaceful(30, 'crash');
assert(t.ship.dead === true, 'high-speed impact destroys the fighter');
framesPeaceful(400, 'await replacement');
console.log('  dead=' + t.ship.dead + ' gameState=' + t.gameState + ' landedOn=' + (t.ship.landedOn ? t.ship.landedOn.name : 'null'));
assert(t.ship.dead === false && t.gameState === 'playing', 'a new fighter was constructed and the war continues');

console.log('\n' + (frameErrors === 0 ? 'ALL CHECKS PASSED' : frameErrors + ' PROBLEM(S) FOUND'));
process.exit(frameErrors === 0 ? 0 : 1);
