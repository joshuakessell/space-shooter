// ─────────────────────────────────────────────────────────────
// Main Entry Point — Bootstraps Game Client
// Connects network, input, and renderer.
// ─────────────────────────────────────────────────────────────

import { DEFAULT_BET, TURRET_POSITIONS } from '@space-shooter/shared';
import { GameClient } from './network/ColyseusClient.js';
import type { GameRoomStateSnapshot, PayoutEventData } from './network/ColyseusClient.js';
import { GameRenderer } from './rendering/GameRenderer.js';
import { InputHandler } from './input/InputHandler.js';

// ─── Configuration ───
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';
const FIRE_COOLDOWN_MS = 150; // Minimum ms between shots

// ─── State ───
let renderer: GameRenderer;
let input: InputHandler;
let client: GameClient;
let latestState: GameRoomStateSnapshot | null = null;
let localTurretX = 0;
let localTurretY = 0;
let lastFireTime = 0;
let currentBet = DEFAULT_BET;

/**
 * Boot sequence:
 * 1. Create renderer (Canvas 2D)
 * 2. Create input handler
 * 3. Connect to Colyseus server
 * 4. Start render loop
 */
async function boot(): Promise<void> {
  console.log('[SpaceShooter] Booting...');

  // 1. Renderer
  renderer = new GameRenderer('game-container');

  // 2. Input
  input = new InputHandler('game-container');

  // 3. Network
  client = new GameClient(SERVER_URL, {
    onJoined: (sessionId: string) => {
      console.log(`[SpaceShooter] Joined as ${sessionId}`);
      renderer.localSessionId = sessionId;
    },
    onStateChange: (state: GameRoomStateSnapshot) => {
      latestState = state;
      renderer.updateState(state);

      // Update local turret position
      const localPlayer = state.players.get(client.sessionId);
      if (localPlayer) {
        localTurretX = localPlayer.turretX;
        localTurretY = localPlayer.turretY;
      }
    },
    onObjectDestroyed: (event: PayoutEventData) => {
      console.log(`[SpaceShooter] 💥 ${event.objectType} destroyed! +$${event.payout} (${event.multiplier}x)`);

      // Find the object's last position for the notification
      const obj = latestState?.spaceObjects.get(event.objectId);
      const x = obj?.x ?? TURRET_POSITIONS['BOTTOM_MIDDLE'].x;
      const y = obj?.y ?? TURRET_POSITIONS['BOTTOM_MIDDLE'].y;
      renderer.addPayoutNotification(event, x, y);
    },
    onShotRejected: (reason: string) => {
      console.warn(`[SpaceShooter] Shot rejected: ${reason}`);
    },
    onError: (error: Error) => {
      console.error('[SpaceShooter] Connection error:', error);
    },
  });

  await client.joinRoom();

  // 4. Bet controls (keyboard shortcuts)
  setupBetControls();

  // 5. Start render loop
  requestAnimationFrame(gameLoop);
  console.log('[SpaceShooter] Ready!');
}

/**
 * Main game loop — runs at display refresh rate.
 * Only rendering and input processing happens here.
 * All game logic is on the server.
 */
function gameLoop(): void {
  // Process input
  input.update();
  const aimAngle = input.getAimAngle(localTurretX, localTurretY);

  // Check for fire
  const fireIntent = input.getFireIntent(localTurretX, localTurretY);
  const now = performance.now();

  if (fireIntent && now - lastFireTime > FIRE_COOLDOWN_MS) {
    client.fireWeapon(fireIntent.angle, currentBet);
    lastFireTime = now;
  }

  // Render
  renderer.render(aimAngle, localTurretX, localTurretY);

  // Continue loop
  requestAnimationFrame(gameLoop);
}

/**
 * Setup keyboard controls for bet adjustment.
 * Up/Down arrows or +/- keys.
 */
function setupBetControls(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    let newBet = currentBet;

    switch (e.key) {
      case 'ArrowUp':
      case '+':
      case '=':
        newBet = Math.min(100, currentBet + 1);
        break;
      case 'ArrowDown':
      case '-':
        newBet = Math.max(1, currentBet - 1);
        break;
      case '1': newBet = 1; break;
      case '2': newBet = 5; break;
      case '3': newBet = 10; break;
      case '4': newBet = 25; break;
      case '5': newBet = 50; break;
      case '6': newBet = 100; break;
    }

    if (newBet !== currentBet) {
      currentBet = newBet;
      client.changeBet(currentBet);
      console.log(`[SpaceShooter] Bet changed to $${currentBet}`);
    }
  });
}

// ─── Bootstrap ───
boot().catch(console.error);
