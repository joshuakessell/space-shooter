// ─────────────────────────────────────────────────────────────
// Renderer — Canvas 2D Game Renderer
// Per Phaser 4 skill contract: this is the rendering adapter.
// It reads server state and draws — NO game logic here.
//
// Phase 4: Projectiles are visual-only ("ghosts"). Local player
// uses client-side predictions; remote players get ghost lasers
// from "remote_shoot" events. All tinted by seat color.
// ─────────────────────────────────────────────────────────────

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  SEAT_COORDINATES,
  SEAT_COLORS,
  PROJECTILE_SPEED,
  MAX_BOUNCES,
  MAX_PLAYERS,
  FIXED_TIMESTEP_MS,
  SpaceObjectType,
} from '@space-shooter/shared';
import type {
  GameRoomStateSnapshot,
  SyncedPlayerState,
  SyncedSpaceObjectState,
  PayoutEventData,
} from '../network/ColyseusClient.js';
import type { FXManager } from '../fx/FXManager.js';

/** Color palette for space object types */
const OBJECT_COLORS: Record<string, string> = {
  [SpaceObjectType.ASTEROID]:       '#8B7355',
  [SpaceObjectType.ROCKET]:         '#FF6347',
  [SpaceObjectType.ALIEN_CRAFT]:    '#00FF88',
  [SpaceObjectType.SPACE_JELLY]:    '#DA70D6',
  [SpaceObjectType.ALIEN_CREATURE]: '#FFD700',
  [SpaceObjectType.METEOR_SHOWER]:  '#FF4500',
  [SpaceObjectType.NEBULA_BEAST]:   '#9370DB',
  [SpaceObjectType.COSMIC_WHALE]:   '#00CED1',
};

/** Object radius for rendering */
const OBJECT_RENDER_RADII: Record<string, number> = {
  [SpaceObjectType.ASTEROID]:       40,
  [SpaceObjectType.ROCKET]:         35,
  [SpaceObjectType.ALIEN_CRAFT]:    32,
  [SpaceObjectType.SPACE_JELLY]:    30,
  [SpaceObjectType.ALIEN_CREATURE]: 28,
  [SpaceObjectType.METEOR_SHOWER]:  26,
  [SpaceObjectType.NEBULA_BEAST]:   24,
  [SpaceObjectType.COSMIC_WHALE]:   22,
};

/** Short display names (emoji) */
const OBJECT_NAMES: Record<string, string> = {
  [SpaceObjectType.ASTEROID]:       '🪨',
  [SpaceObjectType.ROCKET]:         '🚀',
  [SpaceObjectType.ALIEN_CRAFT]:    '🛸',
  [SpaceObjectType.SPACE_JELLY]:    '🪼',
  [SpaceObjectType.ALIEN_CREATURE]: '👾',
  [SpaceObjectType.METEOR_SHOWER]:  '☄️',
  [SpaceObjectType.NEBULA_BEAST]:   '🐙',
  [SpaceObjectType.COSMIC_WHALE]:   '🐋',
};

/** Payout notification */
interface PayoutNotification {
  x: number;
  y: number;
  payout: number;
  multiplier: number;
  emoji: string;
  alpha: number;
  age: number;
  color: string; // seat color of player who scored
}

/** Visual-only laser (local predicted or remote ghost) */
export interface GhostLaser {
  x: number;
  y: number;
  angle: number;
  bouncesRemaining: number;
  age: number;
  color: string;     // seat color for tinting
  id: number;
}

/** Coin particle for win shower animation */
interface CoinParticle {
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  age: number;       // seconds
  duration: number;  // total seconds
  burstAngle: number;
  burstDist: number;
  color: string;
  payout: number;
  isLocal: boolean;
}

/** Auto-incrementing ID for ghost lasers */
let nextGhostId = 1;

/** Pool size limits */
const MAX_GHOST_LASERS = 200;
const MAX_COIN_PARTICLES = 120;

/**
 * Canvas 2D Renderer — draws the game state.
 * This is a "dumb renderer" that reads authoritative state
 * and paints pixels. Zero game logic.
 */
export class GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly notifications: PayoutNotification[] = [];
  private stars: Array<{ x: number; y: number; size: number; alpha: number }> = [];

  // State interpolation buffers
  private currentState: GameRoomStateSnapshot | null = null;
  private stateTimestamp = 0;

  // Ghost lasers (both local predicted and remote)
  private readonly ghostLasers: GhostLaser[] = [];

  // Coin shower particles
  private readonly coinParticles: CoinParticle[] = [];

  /** Callback fired when local player's coin shower reaches turret */
  public onLocalCoinsArrived: ((payout: number) => void) | null = null;

  // Position interpolation for space objects
  private readonly prevObjectPositions: Map<string, { x: number; y: number }> = new Map();

  // Local player info
  public localSessionId = '';

  // ─── Screen Shake ───
  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeElapsed = 0;

  // ─── Camera Flash ───
  private flashAlpha = 0;
  private flashDuration = 0;
  private flashElapsed = 0;

  // ─── Turret Recoil (per seatIndex) ───
  private readonly recoilOffsets: number[] = new Array(MAX_PLAYERS).fill(0);
  private readonly recoilAngles: number[] = new Array(MAX_PLAYERS).fill(0);

  // ─── Jackpot Popup ───
  private jackpotActive = false;
  private jackpotMultiplier = 0;
  private jackpotColor = '#FFD700';
  private jackpotAge = 0;
  private readonly jackpotDuration = 4; // total: 1s scale-in + 2.5s hold + 0.5s fade

  // ─── FX Manager reference ───
  public fxManager: FXManager | null = null;

  constructor(containerId: string) {
    const container = document.getElementById(containerId);
    if (!container) throw new Error(`Container '${containerId}' not found`);

    this.canvas = document.createElement('canvas');
    this.canvas.width = GAME_WIDTH;
    this.canvas.height = GAME_HEIGHT;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.objectFit = 'contain';
    container.appendChild(this.canvas);

    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;

    // Hide loading screen
    const loading = document.getElementById('loading-screen');
    if (loading) loading.style.display = 'none';

    // Generate starfield
    this.generateStars();
  }

  /** Update the synced state from server */
  updateState(state: GameRoomStateSnapshot): void {
    // Capture previous positions for interpolation
    if (this.currentState) {
      this.currentState.spaceObjects.forEach((obj, key) => {
        this.prevObjectPositions.set(key, { x: obj.x, y: obj.y });
      });
    }

    this.currentState = state;
    this.stateTimestamp = performance.now();

    // Clean up stale entries from prevObjectPositions
    for (const key of this.prevObjectPositions.keys()) {
      if (!state.spaceObjects.has(key)) {
        this.prevObjectPositions.delete(key);
      }
    }
  }

  /** Add a payout notification (explosion effect) */
  addPayoutNotification(event: PayoutEventData, x: number, y: number): void {
    this.notifications.push({
      x,
      y,
      payout: event.payout,
      multiplier: event.multiplier,
      emoji: OBJECT_NAMES[event.objectType] ?? '💥',
      alpha: 1,
      age: 0,
      color: SEAT_COLORS[event.seatIndex] ?? '#FFD700',
    });
  }

  /**
   * Spawn a local predicted laser (instant feedback before server confirms).
   */
  addPredictedLaser(x: number, y: number, angle: number, localSeatIndex: number): void {
    if (this.ghostLasers.length >= MAX_GHOST_LASERS) return;
    this.ghostLasers.push({
      x, y, angle,
      bouncesRemaining: MAX_BOUNCES,
      age: 0,
      color: SEAT_COLORS[localSeatIndex] ?? '#00d4ff',
      id: nextGhostId++,
    });
  }

  /**
   * Spawn a ghost laser from a remote player's turret (from remote_shoot event).
   */
  addGhostLaser(seatIndex: number, angle: number): void {
    if (this.ghostLasers.length >= MAX_GHOST_LASERS) return;
    const coords = SEAT_COORDINATES[seatIndex];
    if (!coords) return;
    this.ghostLasers.push({
      x: coords.x,
      y: coords.y,
      angle,
      bouncesRemaining: MAX_BOUNCES,
      age: 0,
      color: SEAT_COLORS[seatIndex] ?? '#ffffff',
      id: nextGhostId++,
    });
  }

  /**
   * Spawn coin shower from destroyed target to the winning player's turret.
   */
  addCoinShower(
    killX: number, killY: number,
    turretX: number, turretY: number,
    seatIndex: number,
    payout: number,
    isLocal: boolean,
  ): void {
    const color = SEAT_COLORS[seatIndex] ?? '#FFD700';
    const count = Math.min(5 + Math.floor(payout / 20), 15);

    for (let i = 0; i < count; i++) {
      if (this.coinParticles.length >= MAX_COIN_PARTICLES) break;
      const burstAngle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const burstDist = 40 + Math.random() * 60;
      this.coinParticles.push({
        x: killX,
        y: killY,
        startX: killX,
        startY: killY,
        targetX: turretX,
        targetY: turretY,
        age: 0,
        duration: 0.8 + Math.random() * 0.4, // 0.8–1.2s
        burstAngle,
        burstDist,
        color,
        payout,
        isLocal,
      });
    }
  }

  /** Main render loop — called via requestAnimationFrame */
  render(
    aimAngle: number,
    localTurretX: number,
    localTurretY: number,
    deltaSec: number,
    lockedTarget?: { id: string; x: number; y: number } | null,
  ): void {
    const ctx = this.ctx;
    const state = this.currentState;

    // ─── Screen Shake Offset ───
    ctx.save();
    if (this.shakeIntensity > 0) {
      this.shakeElapsed += deltaSec;
      if (this.shakeElapsed >= this.shakeDuration) {
        this.shakeIntensity = 0;
      } else {
        const decay = 1 - this.shakeElapsed / this.shakeDuration;
        const offsetX = (Math.random() - 0.5) * GAME_WIDTH * this.shakeIntensity * decay;
        const offsetY = (Math.random() - 0.5) * GAME_HEIGHT * this.shakeIntensity * decay;
        ctx.translate(offsetX, offsetY);
      }
    }

    // ─── Background ───
    this.renderBackground(ctx);

    // ─── Ghost Turrets (empty seats) ───
    this.renderGhostTurrets(ctx, state);

    // ─── Space Objects (with interpolation) ───
    if (state) {
      // Calculate interpolation factor (0–1 between state updates)
      const timeSinceUpdate = performance.now() - this.stateTimestamp;
      const lerpT = Math.min(timeSinceUpdate / FIXED_TIMESTEP_MS, 1);

      state.spaceObjects.forEach((obj, key) => {
        this.renderSpaceObject(ctx, obj, key, lerpT);
      });

      // ─── Lock-On Reticle ───
      if (lockedTarget) {
        this.renderLockOnReticle(ctx, lockedTarget.x, lockedTarget.y);
      }

      // ─── Turrets (seat-colored, with glow for local) ───
      state.players.forEach((player) => {
        const isLocal = player.sessionId === this.localSessionId;
        const displayAngle = isLocal ? aimAngle : player.turretAngle;
        this.renderTurret(ctx, player, displayAngle);
      });
    }

    // ─── Ghost Lasers (local + remote) ───
    this.updateAndRenderGhostLasers(ctx, deltaSec);

    // ─── Coin Shower Particles ───
    this.updateAndRenderCoinParticles(ctx, deltaSec);

    // ─── FX Particles (trails, sparks, explosions) ───
    if (this.fxManager) {
      this.fxManager.update(deltaSec);
      this.fxManager.render(ctx);
    }

    // ─── Aim Laser Line ───
    if (localTurretX > 0) {
      this.renderAimLine(ctx, localTurretX, localTurretY, aimAngle);
    }

    // ─── Payout Notifications ───
    this.renderNotifications(ctx);

    // ─── Jackpot Popup ───
    if (this.jackpotActive) {
      this.renderJackpotPopup(ctx, deltaSec);
    }

    // ─── Restore shake offset ───
    ctx.restore();

    // ─── Camera Flash Overlay (on top of everything) ───
    if (this.flashAlpha > 0) {
      this.flashElapsed += deltaSec;
      if (this.flashElapsed >= this.flashDuration) {
        this.flashAlpha = 0;
      } else {
        const decay = 1 - this.flashElapsed / this.flashDuration;
        this.ctx.globalAlpha = this.flashAlpha * decay;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        this.ctx.globalAlpha = 1;
      }
    }
  }

  // ─── Private Rendering Methods ───

  private generateStars(): void {
    this.stars = [];
    for (let i = 0; i < 200; i++) {
      this.stars.push({
        x: Math.random() * GAME_WIDTH,
        y: Math.random() * GAME_HEIGHT,
        size: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.8 + 0.2,
      });
    }
  }

  private renderBackground(ctx: CanvasRenderingContext2D): void {
    // Deep space gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
    gradient.addColorStop(0, '#0a0a1a');
    gradient.addColorStop(0.5, '#0d0d2b');
    gradient.addColorStop(1, '#0a0a1a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Stars
    for (const star of this.stars) {
      ctx.globalAlpha = star.alpha * (0.5 + 0.5 * Math.sin(performance.now() / 1000 + star.x));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Border glow
    ctx.strokeStyle = 'rgba(123, 47, 247, 0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(10, 10, GAME_WIDTH - 20, GAME_HEIGHT - 20);
  }

  /** Render ghost turrets at unoccupied seat positions */
  private renderGhostTurrets(ctx: CanvasRenderingContext2D, state: GameRoomStateSnapshot | null): void {
    const occupiedSeats = new Set<number>();
    if (state) {
      state.players.forEach((player) => {
        occupiedSeats.add(player.seatIndex);
      });
    }

    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (occupiedSeats.has(i)) continue;
      const coords = SEAT_COORDINATES[i];

      const pulse = 0.15 + 0.05 * Math.sin(performance.now() / 1200 + i);
      ctx.globalAlpha = pulse;

      ctx.beginPath();
      ctx.arc(coords.x, coords.y, 18, 0, Math.PI * 2);
      ctx.strokeStyle = '#555577';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = '#555577';
      ctx.textAlign = 'center';
      const labelY = coords.y > GAME_HEIGHT / 2 ? coords.y + 30 : coords.y - 25;
      ctx.fillText('OPEN', coords.x, labelY);
    }
    ctx.globalAlpha = 1;
  }

  private renderSpaceObject(
    ctx: CanvasRenderingContext2D,
    obj: SyncedSpaceObjectState,
    objKey: string,
    lerpT: number,
  ): void {
    const prev = this.prevObjectPositions.get(objKey);
    const radius = OBJECT_RENDER_RADII[obj.objectType] ?? 25;
    const color = OBJECT_COLORS[obj.objectType] ?? '#ffffff';
    const emoji = OBJECT_NAMES[obj.objectType] ?? '❓';

    let drawX = obj.x;
    let drawY = obj.y;
    let heading = 0;

    if (prev) {
      drawX = prev.x + (obj.x - prev.x) * lerpT;
      drawY = prev.y + (obj.y - prev.y) * lerpT;
      const dx = obj.x - prev.x;
      const dy = obj.y - prev.y;
      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        heading = Math.atan2(dy, dx);
      }
    }

    // Glow ring
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(drawX, drawY, radius + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Emoji with rotation
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.translate(drawX, drawY);
    if (heading !== 0) ctx.rotate(heading);
    ctx.font = `${Math.floor(radius * 1.2)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 0, 0);
    ctx.restore();

    // Multiplier label
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.fillText(`${obj.multiplier}x`, drawX, drawY + radius + 16);

    ctx.shadowBlur = 0;
  }

  /** Render a spinning crosshair reticle on the locked target */
  private renderLockOnReticle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const time = performance.now() / 1000;
    const rotation = time * 2;
    const pulse = 1 + Math.sin(time * 4) * 0.15;
    const radius = 50 * pulse;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.shadowColor = '#ff0000';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.9;
    const lineLen = radius * 0.6;
    const gap = radius * 0.3;
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(cos * gap, sin * gap);
      ctx.lineTo(cos * lineLen, sin * lineLen);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ff3333';
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  /** Render a player turret — seat-colored, with glow ring for local player */
  private renderTurret(ctx: CanvasRenderingContext2D, player: SyncedPlayerState, aimAngle: number): void {
    const x = player.turretX;
    const y = player.turretY;
    const isLocal = player.sessionId === this.localSessionId;
    const seatColor = SEAT_COLORS[player.seatIndex] ?? '#ffffff';

    // ─── Local player glow ring ───
    if (isLocal) {
      const time = performance.now() / 1000;
      const glowPulse = 0.4 + 0.2 * Math.sin(time * 3);
      ctx.globalAlpha = glowPulse;
      ctx.shadowColor = seatColor;
      ctx.shadowBlur = 25;
      ctx.strokeStyle = seatColor;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Apply recoil offset if active
    const recoilDist = this.recoilOffsets[player.seatIndex] ?? 0;
    const recoilX = recoilDist > 0.1 ? -Math.cos(aimAngle) * recoilDist : 0;
    const recoilY = recoilDist > 0.1 ? -Math.sin(aimAngle) * recoilDist : 0;

    // Decay recoil
    if (this.recoilOffsets[player.seatIndex] > 0.1) {
      this.recoilOffsets[player.seatIndex] *= 0.85; // exponential decay ~100ms
    } else {
      this.recoilOffsets[player.seatIndex] = 0;
    }

    // Seat-colored turret body
    ctx.fillStyle = seatColor;
    ctx.strokeStyle = seatColor;
    ctx.lineWidth = 2;

    // Turret body (triangle pointing in aim direction)
    ctx.save();
    ctx.translate(x + recoilX, y + recoilY);
    ctx.rotate(aimAngle);

    ctx.beginPath();
    ctx.moveTo(25, 0);
    ctx.lineTo(-12, -14);
    ctx.lineTo(-12, 14);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.stroke();

    ctx.restore();
    ctx.globalAlpha = 1;

    // Base circle
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.strokeStyle = seatColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Player label + credits
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const labelY = y > GAME_HEIGHT / 2 ? y + 35 : y - 30;
    ctx.fillText(isLocal ? 'YOU' : player.sessionId.substring(0, 4), x, labelY);

    // Credits display next to turret
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = seatColor;
    const creditsY = y > GAME_HEIGHT / 2 ? y + 48 : y - 42;
    ctx.fillText(`$${player.credits.toLocaleString()}`, x, creditsY);
  }

  /** Update physics and render all ghost lasers (local predicted + remote) */
  private updateAndRenderGhostLasers(ctx: CanvasRenderingContext2D, deltaSec: number): void {
    const speed = PROJECTILE_SPEED;

    for (let i = this.ghostLasers.length - 1; i >= 0; i--) {
      const laser = this.ghostLasers[i];

      // Advance position
      const dx = Math.cos(laser.angle) * speed * deltaSec;
      const dy = Math.sin(laser.angle) * speed * deltaSec;

      let newX = laser.x + dx;
      let newY = laser.y + dy;
      let angle = laser.angle;
      let bounced = false;

      if (newX <= 0 || newX >= GAME_WIDTH) {
        angle = Math.PI - angle;
        newX = Math.max(0, Math.min(GAME_WIDTH, newX));
        bounced = true;
      }

      if (newY <= 0 || newY >= GAME_HEIGHT) {
        angle = -angle;
        newY = Math.max(0, Math.min(GAME_HEIGHT, newY));
        bounced = true;
      }

      angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

      laser.x = newX;
      laser.y = newY;
      laser.angle = angle;
      laser.age += deltaSec;

      if (bounced) {
        laser.bouncesRemaining--;
        if (laser.bouncesRemaining <= 0) {
          this.ghostLasers[i] = this.ghostLasers.at(-1)!;
          this.ghostLasers.pop();
          continue;
        }
      }

      // Safety TTL — 5 seconds max
      if (laser.age > 5) {
        this.ghostLasers[i] = this.ghostLasers.at(-1)!;
        this.ghostLasers.pop();
        continue;
      }

      // ─── Render ───
      const trailLen = 25;
      const tdx = -Math.cos(laser.angle) * trailLen;
      const tdy = -Math.sin(laser.angle) * trailLen;

      // Fade slightly as it ages
      ctx.globalAlpha = Math.max(0.3, 1 - laser.age / 4);

      const gradient = ctx.createLinearGradient(laser.x, laser.y, laser.x + tdx, laser.y + tdy);
      gradient.addColorStop(0, laser.color);
      gradient.addColorStop(1, 'transparent');

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(laser.x, laser.y);
      ctx.lineTo(laser.x + tdx, laser.y + tdy);
      ctx.stroke();

      // Head glow
      ctx.shadowColor = laser.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = laser.color;
      ctx.beginPath();
      ctx.arc(laser.x, laser.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  /** Animate coin particles — burst outward then fly to turret */
  private updateAndRenderCoinParticles(ctx: CanvasRenderingContext2D, deltaSec: number): void {
    let localPayoutAccum = 0;

    for (let i = this.coinParticles.length - 1; i >= 0; i--) {
      const coin = this.coinParticles[i];
      coin.age += deltaSec;

      const t = Math.min(coin.age / coin.duration, 1);

      if (t >= 1) {
        // Coin arrived at turret
        if (coin.isLocal) localPayoutAccum += coin.payout;
        this.coinParticles[i] = this.coinParticles.at(-1)!;
        this.coinParticles.pop();
        continue;
      }

      // Two-phase animation:
      // Phase 1 (0-0.3): burst outward from kill point (ease-out)
      // Phase 2 (0.3-1.0): fly to turret (ease-in)
      let drawX: number;
      let drawY: number;

      if (t < 0.3) {
        // Burst phase — ease-out
        const burstT = t / 0.3;
        const eased = 1 - Math.pow(1 - burstT, 3);
        drawX = coin.startX + Math.cos(coin.burstAngle) * coin.burstDist * eased;
        drawY = coin.startY + Math.sin(coin.burstAngle) * coin.burstDist * eased;
      } else {
        // Fly phase — ease-in
        const flyT = (t - 0.3) / 0.7;
        const eased = flyT * flyT * flyT; // cubic ease-in
        const burstX = coin.startX + Math.cos(coin.burstAngle) * coin.burstDist;
        const burstY = coin.startY + Math.sin(coin.burstAngle) * coin.burstDist;
        drawX = burstX + (coin.targetX - burstX) * eased;
        drawY = burstY + (coin.targetY - burstY) * eased;
      }

      coin.x = drawX;
      coin.y = drawY;

      // Render coin
      const size = 6 + 4 * Math.sin(coin.age * 12); // pulsing size
      ctx.shadowColor = coin.color;
      ctx.shadowBlur = 8;
      ctx.fillStyle = coin.color;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(drawX, drawY, Math.abs(size), 0, Math.PI * 2);
      ctx.fill();

      // Coin symbol
      ctx.shadowBlur = 0;
      ctx.font = 'bold 10px serif';
      ctx.fillStyle = '#000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', drawX, drawY);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Fire callback once per frame accumulation
    if (localPayoutAccum > 0 && this.onLocalCoinsArrived) {
      this.onLocalCoinsArrived(localPayoutAccum);
    }
  }

  private renderAimLine(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
    ctx.lineWidth = 1;

    const len = 150;
    const endX = x + Math.cos(angle) * len;
    const endY = y + Math.sin(angle) * len;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private renderNotifications(ctx: CanvasRenderingContext2D): void {
    const dt = 1 / 60;

    for (let i = this.notifications.length - 1; i >= 0; i--) {
      const n = this.notifications[i];
      n.age += dt;
      n.alpha = Math.max(0, 1 - n.age / 2);
      n.y -= 40 * dt;

      if (n.alpha <= 0) {
        this.notifications[i] = this.notifications.at(-1)!;
        this.notifications.pop();
        continue;
      }

      ctx.globalAlpha = n.alpha;
      ctx.font = 'bold 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = n.color; // seat color of winner
      ctx.shadowColor = n.color;
      ctx.shadowBlur = 20;
      ctx.fillText(`${n.emoji} +$${n.payout} (${n.multiplier}x)`, n.x, n.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** Get the canvas element (for input handler) */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  // ─── Juice API ───

  /**
   * Trigger screen shake. Three tiers:
   * - micro: intensity=0.002, 100ms (< 10x)
   * - medium: intensity=0.01, 250ms (10-49x)
   * - severe: intensity=0.02, 500ms (>= 50x) + camera flash
   */
  applyShake(intensity: number, durationMs: number): void {
    // Only override if new shake is stronger
    if (intensity > this.shakeIntensity) {
      this.shakeIntensity = intensity;
      this.shakeDuration = durationMs / 1000;
      this.shakeElapsed = 0;
    }
  }

  /** Trigger shake based on multiplier tier */
  applyShakeForMultiplier(multiplier: number): void {
    if (multiplier >= 50) {
      this.applyShake(0.02, 500);
      this.triggerFlash(0.6, 50);
    } else if (multiplier >= 10) {
      this.applyShake(0.01, 250);
    } else {
      this.applyShake(0.002, 100);
    }
  }

  /** Trigger camera flash (white overlay) */
  triggerFlash(alpha: number, durationMs: number): void {
    this.flashAlpha = alpha;
    this.flashDuration = durationMs / 1000;
    this.flashElapsed = 0;
  }

  /** Trigger turret recoil for a seat */
  triggerRecoil(seatIndex: number, angle: number): void {
    this.recoilOffsets[seatIndex] = 8; // 8px jerk
    this.recoilAngles[seatIndex] = angle;
  }

  /** Show jackpot popup text */
  showJackpotPopup(multiplier: number, color: string): void {
    this.jackpotActive = true;
    this.jackpotMultiplier = multiplier;
    this.jackpotColor = color;
    this.jackpotAge = 0;
  }

  /** Render the jackpot popup with elastic scale-in */
  private renderJackpotPopup(ctx: CanvasRenderingContext2D, deltaSec: number): void {
    this.jackpotAge += deltaSec;

    if (this.jackpotAge >= this.jackpotDuration) {
      this.jackpotActive = false;
      return;
    }

    const t = this.jackpotAge;
    let scale: number;
    let alpha = 1;

    if (t < 1) {
      // Elastic scale-in: 0.1 → 2.0 over 1s
      const p = t / 1;
      // Elastic ease-out approximation
      scale = 0.1 + 1.9 * (1 - Math.pow(2, -10 * p) * Math.cos(p * Math.PI * 3));
      scale = Math.max(0.1, Math.min(2.5, scale));
    } else if (t < 3.5) {
      // Hold at 2.0 with subtle pulse
      scale = 2 + 0.1 * Math.sin((t - 1) * 4);
    } else {
      // Fade out over 0.5s
      const fadeT = (t - 3.5) / 0.5;
      scale = 2;
      alpha = 1 - fadeT;
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.translate(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    ctx.scale(scale, scale);

    // Color pulse
    const pulse = Math.sin(this.jackpotAge * 6);
    const r = Number.parseInt(this.jackpotColor.slice(1, 3), 16);
    const g = Number.parseInt(this.jackpotColor.slice(3, 5), 16);
    const b = Number.parseInt(this.jackpotColor.slice(5, 7), 16);
    const pr = Math.min(255, r + Math.floor(pulse * 50));
    const pg = Math.min(255, g + Math.floor(pulse * 50));
    const pb = Math.min(255, b + Math.floor(pulse * 50));
    const pulseColor = `rgb(${pr},${pg},${pb})`;

    // Shadow glow
    ctx.shadowColor = pulseColor;
    ctx.shadowBlur = 30;

    // JACKPOT text
    ctx.font = 'bold 36px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = pulseColor;
    ctx.fillText(`🎰 JACKPOT! x${this.jackpotMultiplier} 🎰`, 0, 0);

    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Cleanup */
  destroy(): void {
    this.canvas.remove();
  }
}
