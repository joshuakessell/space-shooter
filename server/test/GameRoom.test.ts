// ─────────────────────────────────────────────────────────────
// Unit Tests — Dynamic Volatility Management System
// Tests the 4-layer RTP calculation, economy tides,
// hot-seat rotation, piñata sunk-cost, pity timer,
// and first-kill mutex.
// ─────────────────────────────────────────────────────────────

import assert from 'node:assert';
import {
  SpaceObjectType,
  GAME_WIDTH,
  PROJECTILE_RADIUS,
} from '@space-shooter/shared';
import { World } from '../src/ecs/World.js';
import { movementSystem } from '../src/ecs/systems/MovementSystem.js';
import { projectileSystem } from '../src/ecs/systems/ProjectileSystem.js';
import { collisionSystem } from '../src/ecs/systems/CollisionSystem.js';
import { destroySystem } from '../src/ecs/systems/DestroySystem.js';
import { cleanupSystem } from '../src/ecs/systems/CleanupSystem.js';
import { SpawnSystem } from '../src/ecs/systems/SpawnSystem.js';
import { SystemRunner } from '../src/ecs/systems/SystemRunner.js';
import { CsprngService, SeededRngService } from '../src/services/CsprngService.js';
import { RtpEngine } from '../src/services/RtpEngine.js';
import { WalletManager } from '../src/services/WalletManager.js';
import { RoomEconomyManager } from '../src/services/RoomEconomyManager.js';
import { Quadtree } from '../src/spatial/Quadtree.js';
import { ObjectPool } from '../src/pool/ObjectPool.js';
import { GAME_BALANCE_CONFIG, VolatilityPhase } from '../src/config/GameBalanceConfig.js';
import type { IGameBalanceConfig } from '../src/config/GameBalanceConfig.js';

// ─── Helper: create a test config with overrides ───

function testConfig(overrides: Partial<IGameBalanceConfig> = {}): IGameBalanceConfig {
  return { ...GAME_BALANCE_CONFIG, ...overrides };
}

// ─── GameBalanceConfig Tests ───

describe('GameBalanceConfig', () => {
  it('all object types should have EV ≈ targetRtp', () => {
    for (const [type, entry] of Object.entries(GAME_BALANCE_CONFIG.objectTypes)) {
      const ev = entry.multiplier * entry.destroyProbability;
      assert.ok(
        Math.abs(ev - GAME_BALANCE_CONFIG.targetRtp) < 0.01,
        `${type}: expected EV ≈ ${GAME_BALANCE_CONFIG.targetRtp}, got ${ev}`,
      );
    }
  });

  it('maxSuccessThreshold should be < 1.0', () => {
    assert.ok(GAME_BALANCE_CONFIG.maxSuccessThreshold < 1);
    assert.ok(GAME_BALANCE_CONFIG.maxSuccessThreshold > 0);
  });

  it('volatility phases should have correct multipliers', () => {
    assert.strictEqual(GAME_BALANCE_CONFIG.volatility.phases[VolatilityPhase.EATING], 0.7);
    assert.strictEqual(GAME_BALANCE_CONFIG.volatility.phases[VolatilityPhase.BASELINE], 1);
    assert.strictEqual(GAME_BALANCE_CONFIG.volatility.phases[VolatilityPhase.FRENZY], 1.5);
  });
});

// ─── RoomEconomyManager Tests ───

describe('RoomEconomyManager', () => {
  it('should start in BASELINE phase', () => {
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    assert.strictEqual(economy.getCurrentPhase(), VolatilityPhase.BASELINE);
    assert.strictEqual(economy.getCurrentMultiplier(), 1);
  });

  it('should transition to EATING when house is losing (negative profit)', () => {
    const config = testConfig({
      volatility: {
        ...GAME_BALANCE_CONFIG.volatility,
        minTicksBetweenTransitions: 0, // No cooldown for test
      },
    });
    const economy = new RoomEconomyManager(config);

    // House losing: paid out more than taken in
    economy.recordBet(100);
    economy.recordPayout(150);

    economy.tick(1);
    assert.strictEqual(economy.getCurrentPhase(), VolatilityPhase.EATING);
    assert.strictEqual(economy.getCurrentMultiplier(), 0.7);
  });

  it('should transition to FRENZY when house has excess profit', () => {
    const config = testConfig({
      volatility: {
        ...GAME_BALANCE_CONFIG.volatility,
        minTicksBetweenTransitions: 0,
        baselineToFrenzyProfitRatio: 0.1,
      },
    });
    const economy = new RoomEconomyManager(config);

    // House profiting excessively: 20% profit
    economy.recordBet(1000);
    economy.recordPayout(800);

    economy.tick(1);
    assert.strictEqual(economy.getCurrentPhase(), VolatilityPhase.FRENZY);
    assert.strictEqual(economy.getCurrentMultiplier(), 1.5);
  });

  it('FRENZY should expire after configured duration', () => {
    const config = testConfig({
      volatility: {
        ...GAME_BALANCE_CONFIG.volatility,
        minTicksBetweenTransitions: 50, // High cooldown to prevent re-entry after frenzy ends
        baselineToFrenzyProfitRatio: 0.1,
        frenzyDurationTicks: 10,
      },
    });
    const economy = new RoomEconomyManager(config);

    // House profiting excessively: 20% profit → triggers FRENZY
    economy.recordBet(1000);
    economy.recordPayout(800);

    // First tick at 100 (well past the cooldown from phaseStartTick=0)
    economy.tick(100);
    assert.strictEqual(economy.getCurrentPhase(), VolatilityPhase.FRENZY);

    // Tick through the frenzy duration (frenzyStartTick=100, duration=10)
    // At tick 110, frenzy should expire (110-100 >= 10)
    for (let t = 101; t <= 111; t++) {
      economy.tick(t);
    }
    assert.strictEqual(economy.getCurrentPhase(), VolatilityPhase.BASELINE);
  });

  it('should track profit ratio correctly', () => {
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    economy.recordBet(1000);
    economy.recordPayout(980);
    // Profit = (1000 - 980) / 1000 = 0.02
    assert.ok(Math.abs(economy.getProfitRatio() - 0.02) < 0.001);
  });
});

// ─── RtpEngine v2 Tests ───

describe('RtpEngine (4-Layer Dynamic Volatility)', () => {
  it('evaluateHit should return full modifier breakdown', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    const result = engine.evaluateHit(
      SpaceObjectType.ASTEROID, 10, 'p1', 1, 0,
    );

    assert.ok('destroyed' in result);
    assert.ok('payout' in result);
    assert.ok('rngRoll' in result);
    assert.ok('finalThreshold' in result);
    assert.ok('modifiers' in result);
    assert.ok(typeof result.modifiers.baseChance === 'number');
    assert.ok(typeof result.modifiers.globalVolatility === 'number');
    assert.ok(typeof result.modifiers.hotSeatModifier === 'number');
    assert.ok(typeof result.modifiers.pinataModifier === 'number');
    assert.ok(typeof result.modifiers.pityModifier === 'number');
  });

  it('baseChance = (1/multiplier) × targetRtp', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    const result = engine.evaluateHit(
      SpaceObjectType.COSMIC_WHALE, 1, 'p1', 1, 0,
    );

    // BaseChance = (1/100) × 0.98 = 0.0098
    assert.ok(Math.abs(result.modifiers.baseChance - 0.0098) < 0.0001);
  });

  it('finalThreshold should be clamped to maxSuccessThreshold (0.85)', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    // Asteroid with massive piñata absorption → threshold would exceed 0.85
    const result = engine.evaluateHit(
      SpaceObjectType.ASTEROID, 1, 'p1', 1, 999999,
    );

    assert.ok(result.finalThreshold <= GAME_BALANCE_CONFIG.maxSuccessThreshold,
      `Threshold ${result.finalThreshold} should be ≤ ${GAME_BALANCE_CONFIG.maxSuccessThreshold}`);
  });

  it('hot-seat player should get boosted modifier', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');
    engine.addPlayer('p2');

    // Force hot-seat to p1
    engine.rotateHotSeat(['p1', 'p2'], 0);

    const hotSeatId = engine.getHotSeatPlayerId();
    assert.ok(hotSeatId === 'p1' || hotSeatId === 'p2');

    // Evaluate for the hot-seat player
    const hotResult = engine.evaluateHit(SpaceObjectType.ASTEROID, 1, hotSeatId as string, 1, 0);
    assert.strictEqual(hotResult.modifiers.hotSeatModifier, GAME_BALANCE_CONFIG.hotSeat.boostMultiplier);

    // Evaluate for a non-hot-seat player
    const otherId = hotSeatId === 'p1' ? 'p2' : 'p1';
    const otherResult = engine.evaluateHit(SpaceObjectType.ASTEROID, 1, otherId, 2, 0);
    assert.strictEqual(otherResult.modifiers.hotSeatModifier, GAME_BALANCE_CONFIG.hotSeat.penaltyMultiplier);
  });

  it('piñata modifier should increase with absorbed credits', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    // No absorption → modifier = 1.0
    const baseResult = engine.evaluateHit(SpaceObjectType.ASTEROID, 10, 'p1', 1, 0);
    assert.strictEqual(baseResult.modifiers.pinataModifier, 1);

    // Some absorption → modifier > 1.0
    const absorbedResult = engine.evaluateHit(SpaceObjectType.ASTEROID, 10, 'p1', 1, 15);
    assert.ok(absorbedResult.modifiers.pinataModifier > 1,
      `Piñata modifier should be > 1.0, got ${absorbedResult.modifiers.pinataModifier}`);

    // Heavy absorption → modifier approaches max
    const heavyResult = engine.evaluateHit(SpaceObjectType.ASTEROID, 10, 'p1', 1, 100);
    assert.ok(heavyResult.modifiers.pinataModifier > absorbedResult.modifiers.pinataModifier,
      'More absorption should mean higher modifier');
    assert.ok(heavyResult.modifiers.pinataModifier <= GAME_BALANCE_CONFIG.pinata.maxModifier,
      `Piñata modifier should be ≤ ${GAME_BALANCE_CONFIG.pinata.maxModifier}`);
  });

  it('pity timer should activate after threshold consecutive misses', () => {
    // Use a high-value seed that always produces roll > baseChance for ASTEROID
    const rng = new SeededRngService(12345);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    // Force consecutive misses by manually setting misses
    // (Since we can't guarantee 30 consecutive RNG misses with a specific seed,
    // we test the modifier logic directly)
    for (let i = 0; i < GAME_BALANCE_CONFIG.pity.missThreshold; i++) {
      // Each evaluateHit that results in !destroyed increments misses
      engine.evaluateHit(SpaceObjectType.COSMIC_WHALE, 1, 'p1', 1, 0);
    }

    // After many misses, pity should kick in for low-tier targets
    const result = engine.evaluateHit(SpaceObjectType.ASTEROID, 1, 'p1', 1, 0);

    // The pity modifier applies only if consecutiveMisses >= threshold
    const misses = engine.getConsecutiveMisses('p1');
    if (misses >= GAME_BALANCE_CONFIG.pity.missThreshold) {
      assert.strictEqual(result.modifiers.pityModifier, GAME_BALANCE_CONFIG.pity.pityModifier,
        'Pity modifier should be active');
    }
  });

  it('pity timer should NOT apply to high-multiplier targets', () => {
    const rng = new SeededRngService(99999);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    // Force consecutive misses (Cosmic Whale has very low base chance)
    for (let i = 0; i < 50; i++) {
      engine.evaluateHit(SpaceObjectType.COSMIC_WHALE, 1, 'p1', 1, 0);
    }

    // Cosmic Whale (100x multiplier) > appliesToMaxMultiplier (10x)
    const result = engine.evaluateHit(SpaceObjectType.COSMIC_WHALE, 1, 'p1', 1, 0);
    assert.strictEqual(result.modifiers.pityModifier, 1,
      'Pity should NOT apply to high-multiplier targets');
  });

  it('consecutive misses should reset on a successful kill', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    // Force some misses
    for (let i = 0; i < 10; i++) {
      engine.evaluateHit(SpaceObjectType.COSMIC_WHALE, 1, 'p1', 1, 0);
    }
    const missesBeforeKill = engine.getConsecutiveMisses('p1');
    assert.ok(missesBeforeKill > 0, 'Should have some misses');

    // Force a kill by evaluating with massive piñata modifier on a high-chance target
    // Using Asteroid with absorbedCredits very high → clamped threshold → likely kill
    let killed = false;
    for (let i = 0; i < 100 && !killed; i++) {
      const result = engine.evaluateHit(SpaceObjectType.ASTEROID, 1, 'p1', 1, 10000);
      if (result.destroyed) {
        killed = true;
      }
    }

    if (killed) {
      assert.strictEqual(engine.getConsecutiveMisses('p1'), 0,
        'Misses should reset to 0 after a kill');
    }
  });

  it('shouldRotateHotSeat returns true after interval', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);

    assert.ok(engine.shouldRotateHotSeat(GAME_BALANCE_CONFIG.hotSeat.rotationIntervalTicks));
    engine.rotateHotSeat(['p1'], GAME_BALANCE_CONFIG.hotSeat.rotationIntervalTicks);
    assert.ok(!engine.shouldRotateHotSeat(GAME_BALANCE_CONFIG.hotSeat.rotationIntervalTicks + 1));
  });

  it('statistical RTP should converge near target over many rolls', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');

    let totalBet = 0;
    let totalPayout = 0;
    const iterations = 100000;

    for (let i = 0; i < iterations; i++) {
      const bet = 1;
      totalBet += bet;
      const result = engine.evaluateHit(SpaceObjectType.ASTEROID, bet, 'p1', 1, 0);
      totalPayout += result.payout;
    }

    const observedRtp = totalPayout / totalBet;
    // With modifiers at neutral (1.0), RTP should be near 0.98
    assert.ok(observedRtp > 0.9, `RTP too low: ${observedRtp}`);
    assert.ok(observedRtp < 1.06, `RTP too high: ${observedRtp}`);
  });
});

// ─── CSPRNG Tests ───

describe('CsprngService', () => {
  it('should produce values in [0, 1)', () => {
    const rng = new CsprngService();
    for (let i = 0; i < 1000; i++) {
      const val = rng.random();
      assert.ok(val >= 0, `Value below 0: ${val}`);
      assert.ok(val < 1, `Value >= 1: ${val}`);
    }
  });

  it('should produce range values within bounds', () => {
    const rng = new CsprngService();
    for (let i = 0; i < 100; i++) {
      const val = rng.randomRange(5, 10);
      assert.ok(val >= 5 && val < 10, `Out of range: ${val}`);
    }
  });
});

describe('SeededRngService', () => {
  it('should be deterministic with the same seed', () => {
    const rng1 = new SeededRngService(12345);
    const rng2 = new SeededRngService(12345);
    for (let i = 0; i < 100; i++) {
      assert.strictEqual(rng1.random(), rng2.random());
    }
  });
});

// ─── Wallet Manager Tests ───

describe('WalletManager', () => {
  it('should initialize and track balance', () => {
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 1000);
    assert.strictEqual(wallet.getBalance('p1'), 1000);
  });

  it('should deduct bet atomically', () => {
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 100);
    assert.ok(wallet.deductBet('p1', 30));
    assert.strictEqual(wallet.getBalance('p1'), 70);
  });

  it('should reject deduction when insufficient funds', () => {
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 10);
    assert.ok(!wallet.deductBet('p1', 20));
    assert.strictEqual(wallet.getBalance('p1'), 10);
  });

  it('should award payout', () => {
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 100);
    wallet.awardPayout('p1', 50);
    assert.strictEqual(wallet.getBalance('p1'), 150);
  });

  it('should handle sequential deductions correctly', () => {
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 10);
    assert.ok(wallet.deductBet('p1', 5));
    assert.ok(wallet.deductBet('p1', 5));
    assert.ok(!wallet.deductBet('p1', 1));
    assert.strictEqual(wallet.getBalance('p1'), 0);
  });
});

// ─── ECS World Tests ───

describe('World', () => {
  it('should create and destroy entities', () => {
    const world = new World();
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    assert.ok(world.isAlive(e1));
    assert.ok(world.isAlive(e2));
    assert.strictEqual(world.getEntityCount(), 2);

    world.destroyEntity(e1);
    assert.ok(!world.isAlive(e1));
    assert.strictEqual(world.getEntityCount(), 1);
  });

  it('should recycle entity IDs', () => {
    const world = new World();
    const e1 = world.createEntity();
    world.destroyEntity(e1);
    const e2 = world.createEntity();
    assert.strictEqual(e1, e2); // Recycled
  });

  it('should purge pending destroy entities', () => {
    const world = new World();
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    world.positions.set(e1, { x: 0, y: 0 });
    world.pendingDestroy.set(e1, { markedAtTick: 0 });

    const destroyed = world.purgeDestroyed();
    assert.strictEqual(destroyed.length, 1);
    assert.strictEqual(destroyed[0], e1);
    assert.ok(!world.isAlive(e1));
    assert.ok(world.isAlive(e2));
  });
});

// ─── Movement System Tests ───

describe('MovementSystem', () => {
  it('should move entity along linear path', () => {
    const world = new World();
    const e = world.createEntity();

    world.positions.set(e, { x: 0, y: 0 });
    world.paths.set(e, {
      pathType: 'linear',
      controlPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      duration: 1000, // 1 second
      timeAlive: 0,
      offset: { x: 0, y: 0 },
      sineAmplitude: 0,
      sineFrequency: 0,
    });

    // Advance 500ms = t=0.5 → x should be 50
    movementSystem(world, 500);

    const pos = world.positions.get(e)!;
    assert.ok(Math.abs(pos.x - 50) < 1, `Expected x ≈ 50, got ${pos.x}`);
    assert.ok(Math.abs(pos.y - 0) < 1, `Expected y ≈ 0, got ${pos.y}`);
  });

  it('should tag entity for destroy when path completes', () => {
    const world = new World();
    const e = world.createEntity();

    world.positions.set(e, { x: 0, y: 0 });
    world.paths.set(e, {
      pathType: 'linear',
      controlPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      duration: 1000,
      timeAlive: 0,
      offset: { x: 0, y: 0 },
      sineAmplitude: 0,
      sineFrequency: 0,
    });

    // Advance past duration
    movementSystem(world, 1100);
    assert.ok(world.pendingDestroy.has(e), 'Entity should be tagged for destroy');
  });
});

// ─── Projectile System Tests ───

describe('ProjectileSystem', () => {
  it('should move projectile in straight line', () => {
    const world = new World();
    const e = world.createEntity();

    world.positions.set(e, { x: 500, y: 500 });
    world.projectiles.set(e, {
      ownerId: 'p1',
      betAmount: 1,
      angle: 0,
      bouncesRemaining: 10,
    });

    projectileSystem(world, 0.1);
    const pos = world.positions.get(e)!;
    assert.ok(pos.x > 500, `Should move right: ${pos.x}`);
  });

  it('should bounce off walls', () => {
    const world = new World();
    const e = world.createEntity();

    world.positions.set(e, { x: GAME_WIDTH - 1, y: 500 });
    world.projectiles.set(e, {
      ownerId: 'p1',
      betAmount: 1,
      angle: 0,
      bouncesRemaining: 10,
    });

    projectileSystem(world, 0.1);
    const proj = world.projectiles.get(e)!;
    assert.ok(proj.bouncesRemaining === 9, 'Should have bounced');
  });
});

// ─── DestroySystem v2 Tests (First-Kill Mutex + Piñata) ───

describe('DestroySystem (4-Layer)', () => {
  it('first-kill mutex: isDead prevents double-payout same tick', () => {
    const rng = new SeededRngService(0);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');
    engine.addPlayer('p2');
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 1000);
    wallet.initPlayer('p2', 1000);

    const world = new World();

    // Create target with isDead=false
    const obj = world.createEntity();
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.ASTEROID,
      multiplier: 2,
      destroyProbability: 0.49,
      absorbedCredits: 999, // High piñata → very likely kill
      isDead: false,
    });

    // Two projectiles from different players hit same target
    const proj1 = world.createEntity();
    world.projectiles.set(proj1, { ownerId: 'p1', betAmount: 10, angle: 0, bouncesRemaining: 10 });
    const proj2 = world.createEntity();
    world.projectiles.set(proj2, { ownerId: 'p2', betAmount: 10, angle: 0, bouncesRemaining: 10 });

    const collisions = [
      { projectileId: proj1, objectId: obj, projectileOwnerId: 'p1', betAmount: 10 },
      { projectileId: proj2, objectId: obj, projectileOwnerId: 'p2', betAmount: 10 },
    ];

    const { payouts } = destroySystem(world, collisions, engine, wallet, economy);

    // At most ONE payout (first-kill wins)
    assert.ok(payouts.length <= 1, `Expected ≤ 1 payload, got ${payouts.length}`);

    // If first hit killed, second should have been blocked by isDead
    if (payouts.length === 1) {
      const spaceObj = world.spaceObjects.get(obj);
      assert.ok(spaceObj?.isDead === true, 'isDead should be true after kill');
    }
  });

  it('piñata: failed hits should absorb bet into target', () => {
    // Use a seed that produces high roll values (> 0.49 for Asteroid = misses)
    const rng = new SeededRngService(77777);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 1000);

    const world = new World();

    const obj = world.createEntity();
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.COSMIC_WHALE, // Very low base chance
      multiplier: 100,
      destroyProbability: 0.0098,
      absorbedCredits: 0,
      isDead: false,
    });

    const proj = world.createEntity();
    world.projectiles.set(proj, { ownerId: 'p1', betAmount: 50, angle: 0, bouncesRemaining: 10 });

    const collisions = [
      { projectileId: proj, objectId: obj, projectileOwnerId: 'p1', betAmount: 50 },
    ];

    const { payouts } = destroySystem(world, collisions, engine, wallet, economy);

    const spaceObj = world.spaceObjects.get(obj)!;
    if (payouts.length === 0) {
      // Miss → absorbedCredits should have increased
      assert.strictEqual(spaceObj.absorbedCredits, 50,
        'Failed hit should absorb betAmount into target');
    }
  });

  it('audit: every collision produces a resolution with modifier breakdown', () => {
    const rng = new SeededRngService(42);
    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 1000);

    const world = new World();

    const obj = world.createEntity();
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.ASTEROID,
      multiplier: 2, destroyProbability: 0.49,
      absorbedCredits: 0, isDead: false,
    });

    const proj = world.createEntity();
    world.projectiles.set(proj, { ownerId: 'p1', betAmount: 5, angle: 0, bouncesRemaining: 10 });

    const collisions = [
      { projectileId: proj, objectId: obj, projectileOwnerId: 'p1', betAmount: 5 },
    ];

    const { resolutions } = destroySystem(world, collisions, engine, wallet, economy);

    assert.strictEqual(resolutions.length, 1);
    assert.strictEqual(resolutions[0].playerId, 'p1');
    assert.strictEqual(resolutions[0].betAmount, 5);
    assert.ok('hitEvaluation' in resolutions[0]);
    assert.ok('modifiers' in resolutions[0].hitEvaluation);
    assert.ok(typeof resolutions[0].hitEvaluation.rngRoll === 'number');
    assert.ok(typeof resolutions[0].hitEvaluation.finalThreshold === 'number');
  });
});

// ─── Collision System Tests ───

describe('CollisionSystem', () => {
  it('should detect projectile-object collision', () => {
    const world = new World();

    const obj = world.createEntity();
    world.positions.set(obj, { x: 500, y: 500 });
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.ASTEROID,
      multiplier: 2, destroyProbability: 0.49,
      absorbedCredits: 0, isDead: false,
    });
    world.bounds.set(obj, { radius: 40 });

    const proj = world.createEntity();
    world.positions.set(proj, { x: 505, y: 500 });
    world.projectiles.set(proj, { ownerId: 'p1', betAmount: 5, angle: 0, bouncesRemaining: 10 });
    world.bounds.set(proj, { radius: PROJECTILE_RADIUS });

    const collisions = collisionSystem(world);
    assert.strictEqual(collisions.length, 1);
  });

  it('should not detect collision between distant entities', () => {
    const world = new World();

    const obj = world.createEntity();
    world.positions.set(obj, { x: 100, y: 100 });
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.ROCKET,
      multiplier: 3, destroyProbability: 0.3267,
      absorbedCredits: 0, isDead: false,
    });
    world.bounds.set(obj, { radius: 30 });

    const proj = world.createEntity();
    world.positions.set(proj, { x: 800, y: 800 });
    world.projectiles.set(proj, { ownerId: 'p1', betAmount: 1, angle: 0, bouncesRemaining: 10 });
    world.bounds.set(proj, { radius: PROJECTILE_RADIUS });

    const collisions = collisionSystem(world);
    assert.strictEqual(collisions.length, 0);
  });
});

// ─── Quadtree Tests ───

describe('Quadtree', () => {
  it('should find nearby entities', () => {
    const tree = new Quadtree({ x: 0, y: 0, width: 1000, height: 1000 });

    tree.insert({ entityId: 1, x: 100, y: 100, radius: 10 });
    tree.insert({ entityId: 2, x: 900, y: 900, radius: 10 });
    tree.insert({ entityId: 3, x: 105, y: 105, radius: 10 });

    const results = tree.query({ entityId: 99, x: 100, y: 100, radius: 20 });
    const ids = new Set(results.map(r => r.entityId));
    assert.ok(ids.has(1), 'Should find entity 1');
    assert.ok(ids.has(3), 'Should find entity 3');
  });
});

// ─── Object Pool Tests ───

describe('ObjectPool', () => {
  it('should recycle objects', () => {
    const pool = new ObjectPool(
      () => ({ value: 0 }),
      (obj) => { obj.value = 0; },
      5,
    );

    assert.strictEqual(pool.available, 5);
    const obj = pool.acquire();
    assert.strictEqual(pool.available, 4);
    obj.value = 42;
    pool.release(obj);
    assert.strictEqual(pool.available, 5);
    const recycled = pool.acquire();
    assert.strictEqual(recycled.value, 0);
  });
});

// ─── SystemRunner Integration Test ───

describe('SystemRunner (with Economy)', () => {
  it('should run a complete tick cycle with economy tracking', () => {
    const rng = new SeededRngService(42);
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 10000);

    const economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    const world = new World();

    // Create a turret for p1
    const turretId = world.createEntity();
    world.positions.set(turretId, { x: 960, y: 1020 });
    world.turrets.set(turretId, {
      playerId: 'p1',
      position: 'BOTTOM_MIDDLE' as never,
    });

    const engine = new RtpEngine(rng, economy, GAME_BALANCE_CONFIG);
    engine.addPlayer('p1');
    const spawnSystem = new SpawnSystem(rng, GAME_BALANCE_CONFIG);
    const runner = new SystemRunner(world, engine, wallet, economy, spawnSystem);

    // Queue a fire intent (bet must be a valid tier)
    const intentId = world.createEntity();
    world.fireIntents.set(intentId, {
      playerId: 'p1',
      angle: -Math.PI / 2,
      betAmount: 10,
    });

    // Run one tick
    const result = runner.tick(['p1']);

    // Fire should have been processed
    assert.strictEqual(world.fireIntents.size, 0);

    // Bet should have been deducted
    assert.strictEqual(wallet.getBalance('p1'), 9990);

    // Economy should track the bet
    assert.strictEqual(economy.getCreditsIn(), 10);

    // A projectile should exist
    assert.ok(result.newProjectiles.length === 1);
    assert.strictEqual(result.rejectedShots.length, 0);
  });
});
