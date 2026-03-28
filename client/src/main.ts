// ─────────────────────────────────────────────────────────────
// Main Entry Point — Bootstraps Game Client
// Connects network, input, renderer (Phaser), HUD, audio, FX.
// ─────────────────────────────────────────────────────────────

import { BET_TIERS, GAME_WIDTH, GAME_HEIGHT, SEAT_COORDINATES, SEAT_COLORS, SPREAD_ANGLE_OFFSET, MAX_BOUNCES } from '@space-shooter/shared';
import type { WeaponType } from '@space-shooter/shared';
import { GameClient } from './network/ColyseusClient.js';
import type {
  GameRoomStateSnapshot, PayoutEventData, AoeEventData, ChainHitEventData,
  FeatureActivatedEventData, FeatureVaultRouletteData, FeatureEmpChainData,
  FeatureDrillBounceData, FeatureEndedData,
} from './network/ColyseusClient.js';
import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { MainScene } from './rendering/MainScene.js';
import { InputHandler } from './input/InputHandler.js';
import { HUDManager } from './ui/HUDManager.js';
import { AudioManager } from './audio/AudioManager.js';
// ─── Configuration ───
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:2567';
const FIRE_COOLDOWN_MS = 150;
const POINTER_MOVE_THRESHOLD = 0.05; // radians

// ─── State ───
let phaserGame: Phaser.Game;
let mainScene: MainScene;
let input: InputHandler;
let client: GameClient;
let hud: HUDManager;
let audio: AudioManager;
let latestState: GameRoomStateSnapshot | null = null;
let localTurretX = 0;
let localTurretY = 0;
let localSeatIndex = 0;
let lastFireTime = 0;
let lastFrameTime = 0;
let lastSentAngle = 0;
let currentBet: number = BET_TIERS[0];
let currentWeapon: WeaponType = 'standard';

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

  // 1. Phaser + FX
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.WEBGL,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game-container',
    backgroundColor: '#0a0a1a',
    scene: [BootScene, MainScene],
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    banner: false,
    disableContextMenu: true
  };
  
  phaserGame = new Phaser.Game(config);
  
  // Wait for the scene to boot
  await new Promise<void>(resolve => {
      const wait = setInterval(() => {
          mainScene = phaserGame.scene.getScene('MainScene') as MainScene;
          if (mainScene && mainScene.sys && mainScene.sys.isActive()) {
              clearInterval(wait);
              resolve();
          }
      }, 50);
  });

  // Coin shower → audio sync: play coin sound when coins reach local turret
  mainScene.onLocalCoinsArrived = (_payout: number) => {
    audio.playCoinCollect(localTurretX);
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

  // Weapon switching from InputHandler (Keyboard Q, W, E)
  input.onWeaponChange = (weaponType: WeaponType) => {
    currentWeapon = weaponType;
    client.switchWeapon(weaponType);
    hud.selectWeapon(weaponType, true); // Sync UI visual, skip callback
    console.log(`[SpaceShooter] Weapon switched via KB to: ${weaponType}`);
  };

  // Weapon switching from HUD (Mouse Click)
  hud.onWeaponChange = (weaponType: WeaponType) => {
    currentWeapon = weaponType;
    client.switchWeapon(weaponType);
    input.setWeaponType(weaponType); // Sync InputHandler state
    console.log(`[SpaceShooter] Weapon switched via UI to: ${weaponType}`);
  };

  // 5. Network
  client = new GameClient(SERVER_URL, {
    onJoined: (sessionId: string) => {
      console.log(`[SpaceShooter] Joined as ${sessionId}`);
      if (mainScene) mainScene.localSessionId = sessionId;
    },
    onStateChange: (state: GameRoomStateSnapshot) => {
      latestState = state;
      if (mainScene) mainScene.setRoomState(state);

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
      // Phaser MainScene replaces the old renderer call
      mainScene.addPayoutNotification(killX, killY, event.payout, event.multiplier, event.seatIndex, event.objectType);

      // ─── Explosion FX (tiered by multiplier) ───
      const objColor = SEAT_COLORS[event.seatIndex] ?? '#FF6347';
      if (event.multiplier >= 25) {
        // Boss-tier: multi-stage death sequence
        if (mainScene) mainScene.fxManager.playBossKill(killX, killY, event.multiplier, objColor);
      } else if (event.multiplier >= 8) {
        // Elite-tier: glow pulse + moderate burst
        if (mainScene) mainScene.fxManager.playEliteKill(killX, killY, event.multiplier, objColor);
      } else {
        // Standard: quick pop
        if (mainScene) mainScene.fxManager.playExplosion(killX, killY, event.multiplier, objColor);
      }

      // ─── Audio: explosion tier ───
      audio.playExplosion(event.multiplier, killX);

      // ─── Screen shake (multiplier-based tier, boss FX handles its own shake) ───
      if (event.multiplier < 25 && mainScene) mainScene.applyShake(event.multiplier);

      // ─── Jackpot popup for 50x+ ───
      if (event.multiplier >= 50) {
        const seatColor = SEAT_COLORS[event.seatIndex] ?? '#FFD700';
        // mainScene.showJackpotPopup(event.multiplier, seatColor); // TODO
        audio.playJackpotSiren(killX);
        audio.duckMusic(4000);
      }

      // ─── Coin shower → winning turret ───
      const winnerCoords = SEAT_COORDINATES[event.seatIndex];
      if (winnerCoords) {
        const isLocal = event.playerId === client.sessionId;
        mainScene.addCoinShower(
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
      // renderer.addGhostLaser(seatIndex, angle); // TODO
      // renderer.triggerRecoil(seatIndex, angle); // TODO
      const coords = SEAT_COORDINATES[seatIndex];
      audio.playShoot(coords?.x);
    },
    onError: (error: Error) => {
      console.error('[SpaceShooter] Connection error:', error);
    },
    onAoeDestroyed: (event: AoeEventData) => {
      console.log(`[SpaceShooter] ☄️ Supernova blast! +$${event.totalPayout} (${event.destroyedTargetIds.length} targets)`);

      // Supernova blast FX
      if (mainScene) mainScene.fxManager.playSupernovaBlast(event.x, event.y);
      if (mainScene) mainScene.applyShake(50); // Massive screen shake
      audio.playSupernovaBlast(event.x);
      audio.playExplosion(50, event.x);
      audio.duckMusic(3000);

      // Coin shower for the aggregate payout
      const winnerCoords = SEAT_COORDINATES[event.seatIndex];
      if (winnerCoords) {
        const isLocal = event.playerId === client.sessionId;
        mainScene.addCoinShower(
          event.x, event.y,
          winnerCoords.x, winnerCoords.y,
          event.seatIndex,
          event.totalPayout,
          isLocal,
        );
      }
    },
    onChainHit: (event: ChainHitEventData) => {
      // mainScene.addLightningTrail(event.fromX, event.fromY, event.toX, event.toY, event.seatIndex); // TODO
      if (mainScene) mainScene.fxManager.playImpactSpark(event.toX, event.toY, '#00CCFF');
      audio.playShoot(event.toX);
    },

    // ─── Feature Target Event Handlers ───

    onFeatureActivated: (event: FeatureActivatedEventData) => {
      console.log(`[SpaceShooter] 🎯 Feature target activated: ${event.hazardType} by player ${event.playerId}`);
      switch (event.hazardType) {
        case 'blackhole':
          if (mainScene) mainScene.fxManager.playBlackholeVortex(event.x, event.y);
          if (mainScene) mainScene.applyShake(30);
          audio.playBlackholeActivate(event.x);
          break;
        case 'drill':
          if (mainScene) mainScene.fxManager.playDrillTrail(event.x, event.y, 0);
          if (mainScene) mainScene.applyShake(20);
          audio.playDrillLaunch(event.x);
          break;
        case 'emp':
          if (mainScene) mainScene.applyShake(40);
          audio.playEmpDischarge(event.x);
          break;
        case 'orbital_laser':
          if (mainScene) mainScene.fxManager.playOrbitalLaser(event.x, event.y);
          audio.playOrbitalLaser(event.x);
          break;
        case 'vault':
          if (mainScene) mainScene.fxManager.playVaultRoulette(event.x, event.y);
          if (mainScene) mainScene.applyShake(35);
          audio.playVaultOpen(event.x);
          break;
      }
      audio.duckMusic(2500);
    },

    onFeatureVaultRoulette: (event: FeatureVaultRouletteData) => {
      console.log(`[SpaceShooter] 🏆 Vault roulette: ${event.multiplier}× → $${event.payout}`);
      const isLocal = event.playerId === client.sessionId;
      if (isLocal) {
        console.log(`[SpaceShooter] 💰 YOU WON: $${event.payout} (${event.multiplier}×)!`);
      }
    },

    onFeatureEmpChain: (event: FeatureEmpChainData) => {
      console.log(`[SpaceShooter] 📡 EMP chain: ${event.victimIds.length} targets`);
      // Draw chain lines from source to each victim
      for (const victimId of event.victimIds) {
        const obj = latestState?.spaceObjects.get(victimId);
        if (obj) {
          if (mainScene) mainScene.fxManager.playEmpChain(event.sourceX, event.sourceY, obj.x, obj.y);
        }
      }
    },

    onFeatureDrillBounce: (event: FeatureDrillBounceData) => {
      if (mainScene) mainScene.fxManager.playDrillTrail(event.x, event.y, event.angle);
      audio.playShoot();
    },

    onFeatureEnded: (event: FeatureEndedData) => {
      console.log(`[SpaceShooter] ✅ Hazard ended: $${event.totalPayout} total payout`);
    },
  });

  try {
    await client.joinRoom();
    console.log('[CLIENT] Connected to room');
  } catch (err) {
    console.error('[SpaceShooter] connection aborted', err);
    // TODO: Display connection error in HTML over the Phaser canvas instead of drawing to context
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.9)';
    overlay.style.color = '#ff3333';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
      <h1 style="font-family: Inter, sans-serif; font-size: 48px; margin-bottom: 20px;">SERVER CONNECTION FAILED</h1>
      <p style="font-family: Inter, sans-serif; font-size: 24px;">Check Console (F12) or DB Connection</p>
    `;
    document.getElementById('game-container')?.appendChild(overlay);
    return; // Abort further initialization
  }

  // Remove the HTML loading screen overlay
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
      loadingScreen.style.display = 'none';
  }
  
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

    // Client-side prediction: ghost laser(s) + recoil + audio
    // Client-side prediction: ghost laser(s) + audio
    if (currentWeapon === 'spread') {
      const offsets = [-SPREAD_ANGLE_OFFSET, 0, SPREAD_ANGLE_OFFSET];
      for (const offset of offsets) {
        mainScene.addGhostLaser(localTurretX, localTurretY, aimAngle + offset, MAX_BOUNCES, SEAT_COLORS[localSeatIndex]!, currentWeapon);
      }
    } else {
        mainScene.addGhostLaser(localTurretX, localTurretY, aimAngle, MAX_BOUNCES, SEAT_COLORS[localSeatIndex]!, currentWeapon);
    }
    // renderer.triggerRecoil(localSeatIndex, aimAngle);
    audio.playShoot(localTurretX, currentWeapon);
  }

  // Pass latest input state down to the Phaser scene (which calculates its own delta loop via update())
  // renderer.render(aimAngle, localTurretX, localTurretY, deltaSec, lockedTarget);

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
boot().catch(console.error);
