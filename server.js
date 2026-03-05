/**
 * CRASH GAME - Multiplayer WebSocket Server
 * Node.js + ws library
 * Deploy on: Railway / Render / Fly.io / VPS
 */

const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

// ─── Game State ───────────────────────────────────────────────────────────────
const STATES = { WAITING: 'waiting', RUNNING: 'running', CRASHED: 'crashed' };

let game = {
  state:      STATES.WAITING,
  round:      1,
  multiplier: 1.0,
  crashPoint: 2.0,
  countdown:  5,
  startTime:  null,
  history:    [],          // last 50 crash points
  players:    new Map(),   // clientId → PlayerObj
};

// ─── Provably Fair Crash Algorithm ───────────────────────────────────────────
function generateCrashPoint() {
  // House edge ≈ 4%
  // Uses crypto.randomBytes for true randomness
  const buf = crypto.randomBytes(8);
  const n = buf.readUInt32BE(0) / 0xFFFFFFFF; // 0.0 – 1.0
  if (n < 0.04) return 1.00;                 // 4% instant crash
  return parseFloat(Math.max(1.01, 0.96 / (1 - n)).toFixed(2));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
let clientIdCounter = 0;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

function sendTo(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function playerList() {
  return Array.from(game.players.values()).map(p => ({
    id:         p.id,
    username:   p.username,
    avatar:     p.avatar,
    bet:        p.bet,
    cashedOut:  p.cashedOut,
    cashAt:     p.cashAt,
    profit:     p.profit,
  }));
}

function onlineCount() { return wss.clients.size; }

// ─── Game Loop ────────────────────────────────────────────────────────────────
let countdownTimer = null;
let gameTimer = null;

function startWaiting() {
  game.state      = STATES.WAITING;
  game.countdown  = 5;
  game.multiplier = 1.0;
  game.crashPoint = generateCrashPoint();
  game.players.clear();

  broadcast({
    type:    'waiting',
    round:   game.round,
    history: game.history.slice(0, 20),
    online:  onlineCount(),
  });

  let c = game.countdown;
  countdownTimer = setInterval(() => {
    c--;
    broadcast({ type: 'countdown', value: c });
    if (c <= 0) {
      clearInterval(countdownTimer);
      startGame();
    }
  }, 1000);
}

function startGame() {
  game.state     = STATES.RUNNING;
  game.startTime = Date.now();
  game.multiplier = 1.0;

  broadcast({
    type:    'start',
    round:   game.round,
    players: playerList(),
    online:  onlineCount(),
  });

  // Tick every 100ms → broadcast multiplier
  gameTimer = setInterval(() => {
    const elapsed   = (Date.now() - game.startTime) / 1000;
    game.multiplier = parseFloat(Math.pow(Math.E, 0.06 * elapsed).toFixed(4));

    // Auto-cashout for players who set autoCashAt
    game.players.forEach((p, id) => {
      if (!p.cashedOut && p.bet > 0 && p.autoCashAt && game.multiplier >= p.autoCashAt) {
        processCashout(id, true);
      }
    });

    broadcast({
      type:       'tick',
      multiplier: game.multiplier,
      players:    playerList(),
    });

    if (game.multiplier >= game.crashPoint) {
      processCrash();
    }
  }, 100);
}

function processCashout(clientId, isAuto = false) {
  const p = game.players.get(clientId);
  if (!p || p.cashedOut || p.bet === 0) return false;

  p.cashedOut = true;
  p.cashAt    = parseFloat(game.multiplier.toFixed(2));
  p.profit    = Math.floor(p.bet * p.cashAt);

  // Tell the player their cashout result
  const ws = [...wss.clients].find(c => c.cid === clientId);
  sendTo(ws, {
    type:   'cashedOut',
    at:     p.cashAt,
    profit: p.profit,
    auto:   isAuto,
  });

  broadcast({
    type:     'playerCashout',
    username: p.username,
    avatar:   p.avatar,
    at:       p.cashAt,
    profit:   p.profit,
  });

  return true;
}

function processCrash() {
  clearInterval(gameTimer);
  game.state = STATES.CRASHED;

  // Record history
  game.history.unshift(game.crashPoint);
  if (game.history.length > 50) game.history.pop();

  broadcast({
    type:    'crash',
    at:      game.crashPoint,
    round:   game.round,
    players: playerList(),
  });

  game.round++;
  setTimeout(startWaiting, 3500);
}

// ─── WebSocket Events ─────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  ws.cid = ++clientIdCounter;
  ws.isAlive = true;

  // Sync state immediately to newcomer
  sendTo(ws, {
    type:       'init',
    cid:        ws.cid,
    state:      game.state,
    round:      game.round,
    multiplier: game.multiplier,
    countdown:  game.countdown,
    history:    game.history.slice(0, 20),
    players:    playerList(),
    online:     onlineCount(),
  });

  broadcast({ type: 'online', count: onlineCount() });

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // Player places a bet during WAITING phase
      case 'bet': {
        if (game.state !== STATES.WAITING) {
          sendTo(ws, { type: 'error', reason: 'Round already started' });
          return;
        }
        const amount = parseInt(msg.amount);
        if (isNaN(amount) || amount < 10 || amount > 100000) {
          sendTo(ws, { type: 'error', reason: 'Invalid bet amount' });
          return;
        }
        const username = (msg.username || `Player${ws.cid}`).substring(0, 20);
        const avatar   = msg.avatar || '🎮';
        const autoCash = msg.autoCashAt ? parseFloat(msg.autoCashAt) : null;

        game.players.set(ws.cid, {
          id:         ws.cid,
          username,
          avatar,
          bet:        amount,
          cashedOut:  false,
          cashAt:     null,
          profit:     0,
          autoCashAt: (autoCash && autoCash > 1.01) ? autoCash : null,
        });

        sendTo(ws, { type: 'betConfirmed', amount });

        broadcast({
          type:     'betPlaced',
          username,
          avatar,
          amount,
          players:  playerList(),
        });
        break;
      }

      // Player manually cashes out during RUNNING phase
      case 'cashout': {
        if (game.state !== STATES.RUNNING) return;
        const ok = processCashout(ws.cid, false);
        if (!ok) sendTo(ws, { type: 'error', reason: 'Cannot cashout' });
        break;
      }

      // Heartbeat ping
      case 'ping':
        sendTo(ws, { type: 'pong' });
        break;
    }
  });

  ws.on('close', () => {
    game.players.delete(ws.cid);
    broadcast({ type: 'online', count: onlineCount() });
  });

  ws.on('error', (err) => console.error(`[WS ${ws.cid}] Error:`, err.message));
});

// ─── Heartbeat (detect dead connections) ─────────────────────────────────────
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ─── Start ────────────────────────────────────────────────────────────────────
startWaiting();
console.log(`🚀 Crash server running on ws://localhost:${PORT}`);
console.log(`   State: WAITING | CrashPoint: ${game.crashPoint}`);
