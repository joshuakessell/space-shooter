// ─────────────────────────────────────────────────────────────
// Main Entry Point — Bootstraps Game Client
// Connects network, input, renderer, HUD, audio, and FX.
//
// Phase 5: Wires AudioManager + FXManager + screen shake +
// turret recoil + jackpot popup + coin shower audio sync.
// ─────────────────────────────────────────────────────────────

import { BET_TIERS, GAME_WIDTH, GAME_HEIGHT, SEAT_COORDINATES, SEAT_COLORS } from '@space-shooter/shared';
import { GameClient } from './network/ColyseusClient.js';
import type { GameRoomStateSnapshot, PayoutEventData } from './network/ColyseusClient.js';
import { GameRenderer } from './rendering/GameRenderer.js';
import { InputHandler } from './input/InputHandler.js';
import { HUDManager } from './ui/HUDManager.js';
import { AudioManager } from './audio/AudioManager.js';
import { FXManager } from './fx/FXManager.js';

// ─── Configuration ───
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';
const FIRE_COOLDOWN_MS = 150;
const POINTER_MOVE_THRESHOLD = 0.05; // radians

// ─── State ───
let renderer: GameRenderer;
let input: InputHandler;
let client: GameClient;
let hud: HUDManager;
let audio: AudioManager;
let fxManager: FXManager;
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
 * 1. Renderer + FXManager
 * 2. AudioManager
 * 3. Input handler
 * 4. HUD overlay
 * 5. Network
 * 6. Render loop
 */
async function boot(): Promise<void> {
  console.log('[SpaceShooter] Booting...');

  // 1. Renderer + FX
  renderer = new GameRenderer('game-container');
  fxManager = new FXManager();
  renderer.fxManager = fxManager;

  // Coin shower → audio sync: play coin sound when coins reach local turret
  renderer.onLocalCoinsArrived = (_payout: number) => {
    audio.playCoinCollect();
  };

  // 2. Audio
  audio = new AudioManager();

  // 3. Input
  input = new InputHandler('game-container');

  // 4. HUD
  hud = new HUDManager('game-container');
  hud.onBetChange = (newBet: number) => {
    currentBet = newBet;
    client.changeBet(currentBet);
    console.log(`[SpaceShooter] Bet changed to $${currentBet}`);
  };

  // 5. Network
  client = new GameClient(SERVER_URL, {
    onJoined: (sessionId: string) => {
      console.log(`[SpaceShooter] Joined as ${sessionId}`);
      renderer.localSessionId = sessionId;
    },
    onStateChange: (state: GameRoomStateSnapshot) => {
      latestState = state;
      renderer.updateState(state);

      const localPlayer = state.players.get(client.sessionId);
      if (localPlayer) {
        localTurretX = localPlayer.turretX;
        localTurretY = localPlayer.turretY;
        localSeatIndex = localPlayer.seatIndex;
        hud.updateCredits(localPlayer.credits);
      }
    },
    onObjectDestroyed: (event: PayoutEventData) => {
      console.log(`[SpaceShooter] 💥 ${event.objectType} destroyed! +$${event.payout} (${event.multiplier}x)`);

      const obj = latestState?.spaceObjects.get(event.objectId);
      const killX = obj?.x ?? GAME_WIDTH / 2;
      const killY = obj?.y ?? GAME_HEIGHT / 2;

      // ─── Payout notification ───
      renderer.addPayoutNotification(event, killX, killY);

      // ─── Explosion FX ───
      const objColor = SEAT_COLORS[event.seatIndex] ?? '#FF6347';
      fxManager.playExplosion(killX, killY, event.multiplier, objColor);

      // ─── Audio: explosion tier ───
      audio.playExplosion(event.multiplier);

      // ─── Screen shake (multiplier-based tier) ───
      renderer.applyShakeForMultiplier(event.multiplier);

      // ─── Jackpot popup for 50x+ ───
      if (event.multiplier >= 50) {
        const seatColor = SEAT_COLORS[event.seatIndex] ?? '#FFD700';
        renderer.showJackpotPopup(event.multiplier, seatColor);
        audio.playJackpotSiren();
      }

      // ─── Coin shower → winning turret ───
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
      // Ghost laser + audio + recoil for remote player
      renderer.addGhostLaser(seatIndex, angle);
      renderer.triggerRecoil(seatIndex, angle);
      audio.playShoot();
    },
    onError: (error: Error) => {
      console.error('[SpaceShooter] Connection error:', error);
    },
  });

  await client.joinRoom();

  // 6. Bet keyboard shortcuts
  setupBetControls();

  // 7. Start render loop
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

    // Client-side prediction: ghost laser + recoil + audio
    renderer.addPredictedLaser(localTurretX, localTurretY, aimAngle, localSeatIndex);
    renderer.triggerRecoil(localSeatIndex, aimAngle);
    audio.playShoot();
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
