// ─────────────────────────────────────────────────────────────
// Main Entry Point — Bootstraps Game Client
// Connects network, input, renderer, and HUD.
//
// Phase 4: Wires remote_shoot → ghost lasers, pointer_move
// angle sync, coin shower → slot-roll credit animation.
// ─────────────────────────────────────────────────────────────

import { BET_TIERS, GAME_WIDTH, GAME_HEIGHT, SEAT_COORDINATES } from '@space-shooter/shared';
import { GameClient } from './network/ColyseusClient.js';
import type { GameRoomStateSnapshot, PayoutEventData } from './network/ColyseusClient.js';
import { GameRenderer } from './rendering/GameRenderer.js';
import { InputHandler } from './input/InputHandler.js';
import { HUDManager } from './ui/HUDManager.js';

// ─── Configuration ───
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';
const FIRE_COOLDOWN_MS = 150;
const POINTER_MOVE_THRESHOLD = 0.05; // radians — only send when angle changes this much

// ─── State ───
let renderer: GameRenderer;
let input: InputHandler;
let client: GameClient;
let hud: HUDManager;
let latestState: GameRoomStateSnapshot | null = null;
let localTurretX = 0;
let localTurretY = 0;
let localSeatIndex = 0;
let lastFireTime = 0;
let lastFrameTime = 0;
let lastSentAngle = 0;
let currentBet: number = BET_TIERS[0];

/**
 * Boot sequence:
 * 1. Create renderer
 * 2. Create input handler
 * 3. Create HUD overlay
 * 4. Connect to Colyseus server
 * 5. Start render loop
 */
async function boot(): Promise<void> {
  console.log('[SpaceShooter] Booting...');

  // 1. Renderer
  renderer = new GameRenderer('game-container');

  // Coin shower → slot roll: only trigger credit roll when coins reach local turret
  renderer.onLocalCoinsArrived = (_payout: number) => {
    // Credits are already updated via state change; the animation delay
    // is handled by the coin flight time. HUD updates on each state change.
  };

  // 2. Input
  input = new InputHandler('game-container');

  // 3. HUD
  hud = new HUDManager('game-container');
  hud.onBetChange = (newBet: number) => {
    currentBet = newBet;
    client.changeBet(currentBet);
    console.log(`[SpaceShooter] Bet changed to $${currentBet}`);
  };

  // 4. Network
  client = new GameClient(SERVER_URL, {
    onJoined: (sessionId: string) => {
      console.log(`[SpaceShooter] Joined as ${sessionId}`);
      renderer.localSessionId = sessionId;
    },
    onStateChange: (state: GameRoomStateSnapshot) => {
      latestState = state;
      renderer.updateState(state);

      // Update local turret position + seat
      const localPlayer = state.players.get(client.sessionId);
      if (localPlayer) {
        localTurretX = localPlayer.turretX;
        localTurretY = localPlayer.turretY;
        localSeatIndex = localPlayer.seatIndex;

        // Update HUD credits
        hud.updateCredits(localPlayer.credits);
      }
    },
    onObjectDestroyed: (event: PayoutEventData) => {
      console.log(`[SpaceShooter] 💥 ${event.objectType} destroyed! +$${event.payout} (${event.multiplier}x)`);

      // Find the object's last position for the coin shower
      const obj = latestState?.spaceObjects.get(event.objectId);
      const killX = obj?.x ?? GAME_WIDTH / 2;
      const killY = obj?.y ?? GAME_HEIGHT / 2;

      // Payout notification at kill position
      renderer.addPayoutNotification(event, killX, killY);

      // Coin shower: fly from kill position to winning player's turret
      const winnerCoords = SEAT_COORDINATES[event.seatIndex];
      if (winnerCoords) {
        const isLocal = event.playerId === client.sessionId;
        renderer.addCoinShower(
          killX, killY,
          winnerCoords.x, winnerCoords.y,
          event.seatIndex,
          event.payout,
          isLocal,
        );
      }
    },
    onShotRejected: (reason: string) => {
      console.warn(`[SpaceShooter] Shot rejected: ${reason}`);
    },
    onOutOfFunds: (_currentCredits: number, _requiredBet: number) => {
      console.warn('[SpaceShooter] 💸 Insufficient funds!');
      hud.flashInsufficientFunds();
    },
    onRemoteShoot: (seatIndex: number, angle: number, _lockedTargetId?: string) => {
      // Spawn a ghost laser from the remote player's turret
      renderer.addGhostLaser(seatIndex, angle);
    },
    onError: (error: Error) => {
      console.error('[SpaceShooter] Connection error:', error);
    },
  });

  await client.joinRoom();

  // 5. Bet keyboard shortcuts
  setupBetControls();

  // 6. Start render loop
  lastFrameTime = performance.now();
  requestAnimationFrame(gameLoop);
  console.log('[SpaceShooter] Ready!');
}

/**
 * Main game loop — runs at display refresh rate.
 */
function gameLoop(timestamp: number): void {
  const deltaSec = Math.min((timestamp - lastFrameTime) / 1000, 0.1);
  lastFrameTime = timestamp;

  // Process input
  input.update();

  // Update lock-on target tracking
  if (latestState) {
    input.tryLockOn(latestState.spaceObjects);
    input.updateLockedTarget(latestState.spaceObjects);
  }

  const aimAngle = input.getAimAngle(localTurretX, localTurretY);
  const lockedTarget = input.getLockedTarget();

  // ─── Pointer move throttle ───
  if (Math.abs(aimAngle - lastSentAngle) > POINTER_MOVE_THRESHOLD) {
    client.sendPointerMove(aimAngle);
    lastSentAngle = aimAngle;
  }

  // ─── Auto-fire on mouse hold ───
  const now = performance.now();
  if (input.isMouseDown() && localTurretX > 0 && now - lastFireTime > FIRE_COOLDOWN_MS) {
    client.fireWeapon(aimAngle, currentBet, lockedTarget?.id);
    lastFireTime = now;

    // Client-side prediction: spawn a local ghost laser immediately
    renderer.addPredictedLaser(localTurretX, localTurretY, aimAngle, localSeatIndex);
  }

  // Render
  renderer.render(aimAngle, localTurretX, localTurretY, deltaSec, lockedTarget);

  requestAnimationFrame(gameLoop);
}

/**
 * Keyboard shortcuts for bet tier cycling.
 */
function setupBetControls(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const currentIndex = (BET_TIERS as readonly number[]).indexOf(currentBet);
    let newBet: number = currentBet;

    switch (e.key) {
      case 'ArrowUp':
      case '+':
      case '=':
        if (currentIndex < BET_TIERS.length - 1) newBet = BET_TIERS[currentIndex + 1];
        break;
      case 'ArrowDown':
      case '-':
        if (currentIndex > 0) newBet = BET_TIERS[currentIndex - 1];
        break;
      case '1': newBet = BET_TIERS[0]; break;
      case '2': newBet = BET_TIERS[1]; break;
      case '3': newBet = BET_TIERS[2]; break;
      case '4': newBet = BET_TIERS[3]; break;
      case '5': newBet = BET_TIERS[4]; break;
    }

    if (newBet !== currentBet) {
      currentBet = newBet;
      client.changeBet(currentBet);
      console.log(`[SpaceShooter] Bet changed to $${currentBet}`);
    }
  });
}

// ─── Bootstrap ───
try {
  await boot();
} catch (err) {
  console.error(err);
}
