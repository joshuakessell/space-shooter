// ─────────────────────────────────────────────────────────────
// Wave Manager — Formation-Based Wave Spawning
// ─────────────────────────────────────────────────────────────
// Produces SpawnRequest arrays that tell SpawnSystem what to
// create. WaveManager does NOT touch the ECS directly.
//
// Three wave types:
//   ASTEROID_BELT   — Staggered sine-wave snake (5-10 units)
//   ALIEN_V_FORMATION — Simultaneous V-shaped Bézier flight
//   BOSS_ESCORT     — Slow linear boss + fast weaving escorts
// ─────────────────────────────────────────────────────────────

import {
  GAME_WIDTH,
  GAME_HEIGHT,
  SpaceObjectType,
} from '@space-shooter/shared';
import type { IVector2 } from '@space-shooter/shared';
import type { PathType } from '../ecs/components.js';
import type { IRngService } from './CsprngService.js';

/** What the SpawnSystem should instantiate */
export interface SpawnRequest {
  readonly type: SpaceObjectType;
  readonly pathType: PathType;
  readonly controlPoints: readonly IVector2[];
  readonly duration: number;
  readonly offset: IVector2;
  readonly sineAmplitude: number;
  readonly sineFrequency: number;
  /** Ticks to delay before actually spawning (for staggered waves) */
  readonly delayTicks: number;
}

/** Wave type identifier */
export type WaveType = 'ASTEROID_BELT' | 'ALIEN_V_FORMATION' | 'BOSS_ESCORT' | 'RANDOM_SINGLE';

/** Weights for random wave selection */
const WAVE_WEIGHTS: Record<WaveType, number> = {
  RANDOM_SINGLE: 40,
  ASTEROID_BELT: 25,
  ALIEN_V_FORMATION: 20,
  BOSS_ESCORT: 15,
};

/** Zero offset constant — reused to avoid allocations */
const ZERO_OFFSET: IVector2 = { x: 0, y: 0 };

/**
 * WaveManager produces wave definitions. It maintains no ECS state —
 * it just returns SpawnRequest arrays for SpawnSystem to process.
 */
export class WaveManager {
  constructor(private readonly rng: IRngService) {}

  /** Select a random wave type via weighted roll */
  selectWaveType(): WaveType {
    let totalWeight = 0;
    const entries = Object.entries(WAVE_WEIGHTS) as Array<[WaveType, number]>;
    for (const [, w] of entries) totalWeight += w;

    let roll = this.rng.randomFloat(0, totalWeight);
    for (const [type, w] of entries) {
      roll -= w;
      if (roll <= 0) return type;
    }
    return 'RANDOM_SINGLE';
  }

  /** Generate spawn requests for the selected wave type */
  generateWave(waveType: WaveType): SpawnRequest[] {
    switch (waveType) {
      case 'ASTEROID_BELT':
        return this.generateAsteroidBelt();
      case 'ALIEN_V_FORMATION':
        return this.generateAlienVFormation();
      case 'BOSS_ESCORT':
        return this.generateBossEscort();
      case 'RANDOM_SINGLE':
        return this.generateRandomSingle();
    }
  }

  // ─── Wave Generators ───

  /**
   * ASTEROID_BELT: 5-10 asteroids spawning 8 ticks (400ms) apart
   * on the exact same sine wave path — creates a snake-like line.
   */
  private generateAsteroidBelt(): SpawnRequest[] {
    const count = this.rng.randomRange(5, 11);
    const requests: SpawnRequest[] = [];

    // Shared sine path: straight line across screen with wave
    const entryEdge = this.rng.randomRange(0, 4);
    const start = this.pointOnEdge(entryEdge);
    const end = this.pointOnEdge((entryEdge + 2) % 4);
    const amplitude = this.rng.randomFloat(60, 140);
    const frequency = this.rng.randomFloat(2, 4);
    const duration = this.rng.randomFloat(8000, 14000);

    for (let i = 0; i < count; i++) {
      requests.push({
        type: SpaceObjectType.ASTEROID,
        pathType: 'sine',
        controlPoints: [start, end],
        duration,
        offset: ZERO_OFFSET,
        sineAmplitude: amplitude,
        sineFrequency: frequency,
        delayTicks: i * 8, // 400ms stagger at 20 ticks/sec
      });
    }

    return requests;
  }

  /**
   * ALIEN_V_FORMATION: 5 alien scouts spawning simultaneously
   * with the same cubic Bézier path but V-shaped offsets.
   */
  private generateAlienVFormation(): SpawnRequest[] {
    const requests: SpawnRequest[] = [];

    // Shared cubic Bézier path across the screen
    const entryEdge = this.rng.randomRange(0, 4);
    const start = this.pointOnEdge(entryEdge);
    const end = this.pointOnEdge((entryEdge + 2) % 4);

    // Two interior control points for the curve
    const cp1: IVector2 = {
      x: this.rng.randomFloat(200, GAME_WIDTH - 200),
      y: this.rng.randomFloat(200, GAME_HEIGHT - 200),
    };
    const cp2: IVector2 = {
      x: this.rng.randomFloat(200, GAME_WIDTH - 200),
      y: this.rng.randomFloat(200, GAME_HEIGHT - 200),
    };

    const controlPoints = [start, cp1, cp2, end];
    const duration = this.rng.randomFloat(10000, 16000);

    // V-formation offsets (relative to leader):
    //     0          ← leader (no offset)
    //   1   2        ← wing pair 1 (±60, +40)
    // 3       4      ← wing pair 2 (±120, +80)
    const vOffsets: IVector2[] = [
      { x: 0, y: 0 },
      { x: -60, y: 40 },
      { x: 60, y: 40 },
      { x: -120, y: 80 },
      { x: 120, y: 80 },
    ];

    for (let i = 0; i < 5; i++) {
      requests.push({
        type: SpaceObjectType.ALIEN_CRAFT,
        pathType: 'bezier',
        controlPoints,
        duration,
        offset: vOffsets[i],
        sineAmplitude: 0,
        sineFrequency: 0,
        delayTicks: 0, // All spawn simultaneously
      });
    }

    return requests;
  }

  /**
   * BOSS_ESCORT: 1 high-tier boss (slow linear path) flanked by
   * 3 fast escorts weaving around it on Bézier curves.
   */
  private generateBossEscort(): SpawnRequest[] {
    const requests: SpawnRequest[] = [];

    // Boss: slow linear path across the screen
    const entryEdge = this.rng.randomRange(0, 4);
    const bossStart = this.pointOnEdge(entryEdge);
    const bossEnd = this.pointOnEdge((entryEdge + 2) % 4);
    const bossDuration = this.rng.randomFloat(15000, 22000);

    // Pick a boss-tier type (nebula beast or cosmic whale)
    const bossType = this.rng.randomFloat(0, 1) < 0.5
      ? SpaceObjectType.NEBULA_BEAST
      : SpaceObjectType.COSMIC_WHALE;

    requests.push({
      type: bossType,
      pathType: 'linear',
      controlPoints: [bossStart, bossEnd],
      duration: bossDuration,
      offset: ZERO_OFFSET,
      sineAmplitude: 0,
      sineFrequency: 0,
      delayTicks: 0,
    });

    // 3 fast escorts weaving on Bézier curves
    const escortDuration = bossDuration * 0.7; // Faster than boss
    for (let i = 0; i < 3; i++) {
      const escortCp1: IVector2 = {
        x: this.rng.randomFloat(100, GAME_WIDTH - 100),
        y: this.rng.randomFloat(100, GAME_HEIGHT - 100),
      };
      const escortCp2: IVector2 = {
        x: this.rng.randomFloat(100, GAME_WIDTH - 100),
        y: this.rng.randomFloat(100, GAME_HEIGHT - 100),
      };

      // Escort offsets spread around the boss path
      const angle = ((i / 3) * 2 * Math.PI) + this.rng.randomFloat(-0.3, 0.3);
      const escortOffset: IVector2 = {
        x: Math.cos(angle) * 80,
        y: Math.sin(angle) * 80,
      };

      requests.push({
        type: SpaceObjectType.ROCKET,
        pathType: 'bezier',
        controlPoints: [bossStart, escortCp1, escortCp2, bossEnd],
        duration: escortDuration,
        offset: escortOffset,
        sineAmplitude: 0,
        sineFrequency: 0,
        delayTicks: this.rng.randomRange(0, 6),
      });
    }

    return requests;
  }

  /**
   * RANDOM_SINGLE: Legacy single-target spawn with a random curve.
   * Preserves the old SpawnSystem behavior but with curve pathing.
   */
  private generateRandomSingle(): SpawnRequest[] {
    const entryEdge = this.rng.randomRange(0, 4);
    const start = this.pointOnEdge(entryEdge);
    const end = this.pointOnEdge((entryEdge + 2 + this.rng.randomRange(-1, 2)) % 4);

    // Random curve type
    const pathType: PathType = this.rng.randomFloat(0, 1) < 0.6 ? 'bezier' : 'sine';
    const duration = this.rng.randomFloat(6000, 12000);

    if (pathType === 'sine') {
      return [{
        type: SpaceObjectType.ASTEROID, // Placeholder — SpawnSystem picks weighted type
        pathType: 'sine',
        controlPoints: [start, end],
        duration,
        offset: ZERO_OFFSET,
        sineAmplitude: this.rng.randomFloat(40, 120),
        sineFrequency: this.rng.randomFloat(1.5, 3.5),
        delayTicks: 0,
      }];
    }

    // Cubic Bézier with random interior control points
    const cp1: IVector2 = {
      x: this.rng.randomFloat(100, GAME_WIDTH - 100),
      y: this.rng.randomFloat(100, GAME_HEIGHT - 100),
    };
    const cp2: IVector2 = {
      x: this.rng.randomFloat(100, GAME_WIDTH - 100),
      y: this.rng.randomFloat(100, GAME_HEIGHT - 100),
    };

    return [{
      type: SpaceObjectType.ASTEROID, // Placeholder
      pathType: 'bezier',
      controlPoints: [start, cp1, cp2, end],
      duration,
      offset: ZERO_OFFSET,
      sineAmplitude: 0,
      sineFrequency: 0,
      delayTicks: 0,
    }];
  }

  // ─── Helpers ───

  /** Generate a random point on the specified screen edge */
  private pointOnEdge(edge: number): IVector2 {
    const margin = 60; // Spawn slightly off-screen
    const normalizedEdge = ((edge % 4) + 4) % 4;
    switch (normalizedEdge) {
      case 0: // top
        return { x: this.rng.randomFloat(0, GAME_WIDTH), y: -margin };
      case 1: // right
        return { x: GAME_WIDTH + margin, y: this.rng.randomFloat(0, GAME_HEIGHT) };
      case 2: // bottom
        return { x: this.rng.randomFloat(0, GAME_WIDTH), y: GAME_HEIGHT + margin };
      case 3: // left
        return { x: -margin, y: this.rng.randomFloat(0, GAME_HEIGHT) };
      default:
        return { x: -margin, y: this.rng.randomFloat(0, GAME_HEIGHT) };
    }
  }
}
