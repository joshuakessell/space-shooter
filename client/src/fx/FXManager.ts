// ─────────────────────────────────────────────────────────────
// FXManager — Canvas2D Particle System
// Infrastructure adapter: read-only observer, never mutates ECS.
//
// Pre-allocated particle pool with zero per-frame allocations.
// Handles engine trails, impact sparks, and explosions.
// ─────────────────────────────────────────────────────────────

import { GAME_WIDTH, GAME_HEIGHT } from '@space-shooter/shared';

/** Maximum particles in the pool */
const MAX_PARTICLES = 500;

/** Individual particle state */
interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;     // remaining life in seconds
  maxLife: number;   // initial life for alpha calc
  size: number;
  color: string;
  type: 'trail' | 'spark' | 'explosion' | 'smoke';
  gravity: number;
}

/**
 * Manages Canvas2D particle effects using a pre-allocated pool.
 * Called each frame: `update(deltaSec)` then `render(ctx)`.
 */
export class FXManager {
  private readonly pool: Particle[] = [];
  private activeCount = 0;

  constructor() {
    // Pre-allocate pool
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool.push(this.createInactiveParticle());
    }
  }

  private createInactiveParticle(): Particle {
    return {
      active: false,
      x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 0, size: 2,
      color: '#ffffff',
      type: 'spark',
      gravity: 0,
    };
  }

  /** Acquire a particle from the pool */
  private acquire(): Particle | null {
    if (this.activeCount >= MAX_PARTICLES) return null;
    for (const p of this.pool) {
      if (!p.active) {
        p.active = true;
        this.activeCount++;
        return p;
      }
    }
    return null;
  }

  // ─── Public FX Methods ───

  /**
   * Engine trail — continuous small glow behind a space object.
   * Call once per frame for each space object that should have a trail.
   */
  emitTrail(x: number, y: number, color: string): void {
    if (Math.random() > 0.3) return; // Throttle: ~30% chance per frame

    const p = this.acquire();
    if (!p) return;

    p.x = x + (Math.random() - 0.5) * 10;
    p.y = y + (Math.random() - 0.5) * 10;
    p.vx = (Math.random() - 0.5) * 20;
    p.vy = (Math.random() - 0.5) * 20;
    p.life = 0.3 + Math.random() * 0.3;
    p.maxLife = p.life;
    p.size = 2 + Math.random() * 3;
    p.color = color;
    p.type = 'trail';
    p.gravity = 0;
  }

  /**
   * Impact sparks — quick 50ms burst at hit position.
   * Provides instant tactile feedback (piñata mechanic).
   */
  playImpactSpark(x: number, y: number, color = '#FFD700'): void {
    const count = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) break;

      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 100 + Math.random() * 200;

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.05 + Math.random() * 0.1; // Very short: 50-150ms
      p.maxLife = p.life;
      p.size = 2 + Math.random() * 2;
      p.color = color;
      p.type = 'spark';
      p.gravity = 0;
    }
  }

  /**
   * Explosion — fire/smoke burst scaled by multiplier.
   * Low mult = small pop, high = massive blast.
   */
  playExplosion(x: number, y: number, multiplier: number, color = '#FF6347'): void {
    // Scale particle count: 5 for 1x, up to 30 for 50x+
    const count = Math.min(5 + Math.floor(multiplier * 0.5), 30);
    const baseSpeed = 80 + multiplier * 5;

    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = baseSpeed + Math.random() * baseSpeed;

      p.x = x + (Math.random() - 0.5) * 10;
      p.y = y + (Math.random() - 0.5) * 10;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.3 + Math.random() * 0.5;
      p.maxLife = p.life;
      p.size = 4 + Math.random() * 6 + multiplier * 0.2;
      let particleColor = color;
      if (i % 3 === 0) particleColor = '#FF8C00';
      else if (i % 3 === 2) particleColor = '#FFFF00';
      p.color = particleColor;
      p.type = 'explosion';
      p.gravity = 30; // slight downward drift
    }

    // Smoke ring
    const smokeCount = Math.min(Math.floor(count / 2), 10);
    for (let i = 0; i < smokeCount; i++) {
      const p = this.acquire();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = baseSpeed * 0.3 + Math.random() * 40;

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.5 + Math.random() * 0.8;
      p.maxLife = p.life;
      p.size = 8 + Math.random() * 8;
      p.color = '#888888';
      p.type = 'smoke';
      p.gravity = -15; // smoke rises
    }
  }

  /**
   * Supernova blast — massive expanding shockwave ring.
   * Creates a dramatic concentric burst radiating outward.
   */
  playSupernovaBlast(x: number, y: number): void {
    // Outer shockwave ring — white/cyan particles in a circle
    const ringCount = 40;
    for (let i = 0; i < ringCount; i++) {
      const p = this.acquire();
      if (!p) break;

      const angle = (Math.PI * 2 * i) / ringCount;
      const speed = 400 + Math.random() * 200;

      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.6 + Math.random() * 0.4;
      p.maxLife = p.life;
      p.size = 6 + Math.random() * 4;
      const colors = ['#ffffff', '#00FFFF', '#CC44FF'];
      p.color = colors[i % 3];
      p.type = 'explosion';
      p.gravity = 0;
    }

    // Inner golden burst
    const burstCount = 20;
    for (let i = 0; i < burstCount; i++) {
      const p = this.acquire();
      if (!p) break;

      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 150;

      p.x = x + (Math.random() - 0.5) * 20;
      p.y = y + (Math.random() - 0.5) * 20;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0.8 + Math.random() * 0.5;
      p.maxLife = p.life;
      p.size = 3 + Math.random() * 5;
      p.color = '#FFD700';
      p.type = 'explosion';
      p.gravity = 0;
    }
  }

  // ─── Update & Render ───

  /** Advance all active particles by deltaSec */
  update(deltaSec: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;

      p.x += p.vx * deltaSec;
      p.y += p.vy * deltaSec;
      p.vy += p.gravity * deltaSec;
      p.life -= deltaSec;

      // Kill if expired or off-screen
      if (p.life <= 0 || p.x < -50 || p.x > GAME_WIDTH + 50 || p.y < -50 || p.y > GAME_HEIGHT + 50) {
        p.active = false;
        this.activeCount--;
      }
    }
  }

  /** Render all active particles to the canvas context */
  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.active) continue;

      const alpha = Math.max(0, p.life / p.maxLife);

      ctx.globalAlpha = alpha;

      if (p.type === 'smoke') {
        // Soft circle with low alpha
        ctx.globalAlpha = alpha * 0.3;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'trail') {
        // Small glow dot
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        // Spark / explosion — bright core
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;
  }
}
