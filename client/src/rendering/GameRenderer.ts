// ─────────────────────────────────────────────────────────────
// Renderer — Canvas 2D Game Renderer
// Per Phaser 4 skill contract: this is the rendering adapter.
// It reads server state and draws — NO game logic here.
// ─────────────────────────────────────────────────────────────

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  TURRET_POSITIONS,
  SpaceObjectType,
} from '@space-shooter/shared';
import type {
  GameRoomStateSnapshot,
  SyncedPlayerState,
  SyncedProjectileState,
  SyncedSpaceObjectState,
  PayoutEventData,
} from '../network/ColyseusClient.js';

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

/** Short display names */
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

/** Explosion/payout notification */
interface PayoutNotification {
  x: number;
  y: number;
  payout: number;
  multiplier: number;
  emoji: string;
  alpha: number;
  age: number;
}

/**
 * Canvas 2D Renderer — draws the game state.
 * This is a "dumb renderer" that reads authoritative state
 * and paints pixels. Zero game logic.
 *
 * NOTE: This is a temporary renderer. When Phaser 4 API
 * stabilizes, this will be replaced with Phaser 4 Sprites
 * and the RenderSyncSystem adapter pattern.
 */
export class GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly notifications: PayoutNotification[] = [];
  private stars: Array<{ x: number; y: number; size: number; alpha: number }> = [];

  // State interpolation buffers
  private prevState: GameRoomStateSnapshot | null = null;
  private currentState: GameRoomStateSnapshot | null = null;
  private stateTimestamp = 0;

  // Local player info
  public localSessionId = '';

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
    this.prevState = this.currentState;
    this.currentState = state;
    this.stateTimestamp = performance.now();
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
    });
  }

  /** Main render loop — called via requestAnimationFrame */
  render(aimAngle: number, localTurretX: number, localTurretY: number): void {
    const ctx = this.ctx;
    const state = this.currentState;

    // ─── Background ───
    this.renderBackground(ctx);

    // ─── Space Objects ───
    if (state) {
      state.spaceObjects.forEach((obj) => {
        this.renderSpaceObject(ctx, obj);
      });

      // ─── Projectiles ───
      state.projectiles.forEach((proj) => {
        this.renderProjectile(ctx, proj);
      });

      // ─── Turrets ───
      state.players.forEach((player) => {
        this.renderTurret(ctx, player, player.sessionId === this.localSessionId ? aimAngle : 0);
      });

      // ─── HUD ───
      this.renderHUD(ctx, state);
    }

    // ─── Aim Laser Line ───
    if (localTurretX > 0) {
      this.renderAimLine(ctx, localTurretX, localTurretY, aimAngle);
    }

    // ─── Payout Notifications ───
    this.renderNotifications(ctx);
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
    const gradient = ctx.createRadialGradient(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, 0,
      GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH * 0.7,
    );
    gradient.addColorStop(0, '#0d0d2b');
    gradient.addColorStop(0.5, '#0a0a1e');
    gradient.addColorStop(1, '#050510');
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

  private renderSpaceObject(ctx: CanvasRenderingContext2D, obj: SyncedSpaceObjectState): void {
    const color = OBJECT_COLORS[obj.objectType] ?? '#ffffff';
    const radius = OBJECT_RENDER_RADII[obj.objectType] ?? 30;
    const emoji = OBJECT_NAMES[obj.objectType] ?? '●';

    // Glow effect
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;

    // Body
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Emoji
    ctx.shadowBlur = 0;
    ctx.font = `${Math.floor(radius * 1.2)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, obj.x, obj.y);

    // Multiplier label
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.fillStyle = '#FFD700';
    ctx.fillText(`${obj.multiplier}x`, obj.x, obj.y + radius + 16);

    ctx.shadowBlur = 0;
  }

  private renderProjectile(ctx: CanvasRenderingContext2D, proj: SyncedProjectileState): void {
    const isLocal = proj.ownerId === this.localSessionId;

    // Laser trail
    const trailLen = 30;
    const dx = -Math.cos(proj.angle) * trailLen;
    const dy = -Math.sin(proj.angle) * trailLen;

    const gradient = ctx.createLinearGradient(proj.x, proj.y, proj.x + dx, proj.y + dy);
    gradient.addColorStop(0, isLocal ? '#00d4ff' : '#ff6b9d');
    gradient.addColorStop(1, 'transparent');

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(proj.x, proj.y);
    ctx.lineTo(proj.x + dx, proj.y + dy);
    ctx.stroke();

    // Head glow
    ctx.shadowColor = isLocal ? '#00d4ff' : '#ff6b9d';
    ctx.shadowBlur = 15;
    ctx.fillStyle = isLocal ? '#00d4ff' : '#ff6b9d';
    ctx.beginPath();
    ctx.arc(proj.x, proj.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
  }

  private renderTurret(ctx: CanvasRenderingContext2D, player: SyncedPlayerState, aimAngle: number): void {
    const x = player.turretX;
    const y = player.turretY;
    const isLocal = player.sessionId === this.localSessionId;

    // Base
    ctx.fillStyle = isLocal ? '#00d4ff' : '#7b2ff7';
    ctx.strokeStyle = isLocal ? '#00d4ff' : '#7b2ff7';
    ctx.lineWidth = 2;

    // Turret body (triangle pointing in aim direction)
    ctx.save();
    ctx.translate(x, y);
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
    ctx.strokeStyle = isLocal ? '#00d4ff' : '#7b2ff7';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Player label
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    const labelY = y > GAME_HEIGHT / 2 ? y + 35 : y - 30;
    ctx.fillText(isLocal ? 'YOU' : player.sessionId.substring(0, 4), x, labelY);
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

  private renderHUD(ctx: CanvasRenderingContext2D, state: GameRoomStateSnapshot): void {
    // Find local player
    const localPlayer = state.players.get(this.localSessionId);

    // Credits + Bet display (top-center)
    ctx.fillStyle = 'rgba(10, 10, 30, 0.8)';
    ctx.strokeStyle = 'rgba(123, 47, 247, 0.4)';
    ctx.lineWidth = 1;

    const hudW = 320;
    const hudH = 60;
    const hudX = (GAME_WIDTH - hudW) / 2;
    const hudY = 15;

    this.roundRect(ctx, hudX, hudY, hudW, hudH, 10);
    ctx.fill();
    ctx.stroke();

    if (localPlayer) {
      ctx.font = 'bold 18px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFD700';
      ctx.fillText(`💰 ${localPlayer.credits.toLocaleString()}`, hudX + 20, hudY + 28);

      ctx.fillStyle = '#00d4ff';
      ctx.fillText(`🎯 Bet: $${localPlayer.betAmount}`, hudX + 20, hudY + 50);

      // Player count
      ctx.textAlign = 'right';
      ctx.fillStyle = '#aaaaaa';
      ctx.font = '14px Inter, sans-serif';
      ctx.fillText(`👥 ${state.players.size}/6`, hudX + hudW - 20, hudY + 28);

      ctx.fillStyle = '#666666';
      ctx.fillText(`Tick: ${state.tick}`, hudX + hudW - 20, hudY + 50);
    }
  }

  private renderNotifications(ctx: CanvasRenderingContext2D): void {
    const dt = 1 / 60; // Approximate frame delta

    for (let i = this.notifications.length - 1; i >= 0; i--) {
      const n = this.notifications[i];
      n.age += dt;
      n.alpha = Math.max(0, 1 - n.age / 2);
      n.y -= 40 * dt; // Float upward

      if (n.alpha <= 0) {
        this.notifications.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = n.alpha;
      ctx.font = 'bold 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFD700';
      ctx.shadowColor = '#FFD700';
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

  /** Cleanup */
  destroy(): void {
    this.canvas.remove();
  }
}
