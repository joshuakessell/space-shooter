// ─────────────────────────────────────────────────────────────
// Unit Tests — ECS Systems, RTP Engine, Wallet, Quadtree
// ─────────────────────────────────────────────────────────────

import assert from 'assert';
import { SpaceObjectType, GAME_WIDTH, GAME_HEIGHT, PROJECTILE_RADIUS, RTP_TABLE } from '@space-shooter/shared';
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
import { Quadtree } from '../src/spatial/Quadtree.js';
import { ObjectPool } from '../src/pool/ObjectPool.js';

// ─── RTP Engine Tests ───

describe('RtpEngine', () => {
  it('should return correct payout on destruction', () => {
    // Use seeded RNG with a seed that produces a low value (triggers destroy for Asteroid)
    const rng = new SeededRngService(42);
    const engine = new RtpEngine(rng);

    // Run many iterations and track results
    let totalBet = 0;
    let totalPayout = 0;
    const iterations = 100000;

    for (let i = 0; i < iterations; i++) {
      const bet = 1;
      totalBet += bet;
      const result = engine.rollDestruction(SpaceObjectType.ASTEROID, bet);
      totalPayout += result.payout;
    }

    const observedRtp = totalPayout / totalBet;
    // RTP should be approximately 0.98 (±5% tolerance for statistical variance)
    assert.ok(observedRtp > 0.90, `RTP too low: ${observedRtp}`);
    assert.ok(observedRtp < 1.06, `RTP too high: ${observedRtp}`);
  });

  it('RTP table entries all produce ~98% expected value', () => {
    for (const [type, entry] of RTP_TABLE) {
      const ev = entry.multiplier * entry.destroyProbability;
      assert.ok(
        Math.abs(ev - 0.98) < 0.01,
        `${type}: expected EV ≈ 0.98, got ${ev}`,
      );
    }
  });

  it('should return multiplier for valid object type', () => {
    const rng = new SeededRngService(1);
    const engine = new RtpEngine(rng);
    assert.strictEqual(engine.getMultiplier(SpaceObjectType.COSMIC_WHALE), 100);
    assert.strictEqual(engine.getMultiplier(SpaceObjectType.ASTEROID), 2);
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

  it('should handle concurrent deductions correctly', () => {
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
  it('should move entity along path', () => {
    const world = new World();
    const e = world.createEntity();

    world.positions.set(e, { x: 0, y: 0 });
    world.spaceObjects.set(e, {
      type: SpaceObjectType.ASTEROID,
      multiplier: 2,
      destroyProbability: 0.49,
      pathIndex: 0,
      pathProgress: 0,
      path: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      speed: 100,
    });

    // Advance 0.5 seconds → should move 50px along first segment
    movementSystem(world, 0.5);

    const pos = world.positions.get(e)!;
    assert.ok(Math.abs(pos.x - 50) < 1, `Expected x ≈ 50, got ${pos.x}`);
    assert.ok(Math.abs(pos.y - 0) < 1, `Expected y ≈ 0, got ${pos.y}`);
  });

  it('should mark entity for destroy at path end', () => {
    const world = new World();
    const e = world.createEntity();

    world.positions.set(e, { x: 90, y: 0 });
    world.spaceObjects.set(e, {
      type: SpaceObjectType.ASTEROID,
      multiplier: 2,
      destroyProbability: 0.49,
      pathIndex: 0,
      pathProgress: 0.9,
      path: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      speed: 200,
    });

    movementSystem(world, 1.0);
    assert.ok(world.pendingDestroy.has(e));
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
      angle: 0, // moving right
      bouncesRemaining: 10,
    });

    projectileSystem(world, 0.1);
    const pos = world.positions.get(e)!;
    assert.ok(pos.x > 500, `Should move right: ${pos.x}`);
    assert.ok(Math.abs(pos.y - 500) < 1, `Should not move vertically: ${pos.y}`);
  });

  it('should bounce off walls', () => {
    const world = new World();
    const e = world.createEntity();

    world.positions.set(e, { x: GAME_WIDTH - 1, y: 500 });
    world.projectiles.set(e, {
      ownerId: 'p1',
      betAmount: 1,
      angle: 0, // moving right into wall
      bouncesRemaining: 10,
    });

    projectileSystem(world, 0.1);
    const proj = world.projectiles.get(e)!;
    // Angle should have changed (reflected)
    assert.ok(proj.bouncesRemaining === 9, 'Should have bounced');
  });
});

// ─── Collision System Tests ───

describe('CollisionSystem', () => {
  it('should detect projectile-object collision', () => {
    const world = new World();

    // Space object at (500, 500) with radius 40
    const obj = world.createEntity();
    world.positions.set(obj, { x: 500, y: 500 });
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.ASTEROID,
      multiplier: 2,
      destroyProbability: 0.49,
      pathIndex: 0,
      pathProgress: 0,
      path: [{ x: 500, y: 500 }, { x: 600, y: 500 }],
      speed: 100,
    });
    world.bounds.set(obj, { radius: 40 });

    // Projectile right on top of it
    const proj = world.createEntity();
    world.positions.set(proj, { x: 505, y: 500 });
    world.projectiles.set(proj, {
      ownerId: 'p1',
      betAmount: 5,
      angle: 0,
      bouncesRemaining: 10,
    });
    world.bounds.set(proj, { radius: PROJECTILE_RADIUS });

    const collisions = collisionSystem(world);
    assert.strictEqual(collisions.length, 1);
    assert.strictEqual(collisions[0].projectileId, proj);
    assert.strictEqual(collisions[0].objectId, obj);
  });

  it('should not detect collision between distant entities', () => {
    const world = new World();

    const obj = world.createEntity();
    world.positions.set(obj, { x: 100, y: 100 });
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.ROCKET,
      multiplier: 3,
      destroyProbability: 0.3267,
      pathIndex: 0,
      pathProgress: 0,
      path: [{ x: 100, y: 100 }, { x: 200, y: 100 }],
      speed: 100,
    });
    world.bounds.set(obj, { radius: 30 });

    const proj = world.createEntity();
    world.positions.set(proj, { x: 800, y: 800 });
    world.projectiles.set(proj, {
      ownerId: 'p1',
      betAmount: 1,
      angle: 0,
      bouncesRemaining: 10,
    });
    world.bounds.set(proj, { radius: PROJECTILE_RADIUS });

    const collisions = collisionSystem(world);
    assert.strictEqual(collisions.length, 0);
  });
});

// ─── Destroy System Tests ───

describe('DestroySystem', () => {
  it('should destroy target when RNG roll succeeds', () => {
    // Seed 0 with a low-value RNG that always passes
    const rng = new SeededRngService(0);
    const engine = new RtpEngine(rng);
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 1000);

    const world = new World();
    const obj = world.createEntity();
    world.spaceObjects.set(obj, {
      type: SpaceObjectType.ASTEROID,
      multiplier: 2,
      destroyProbability: 1.0, // 100% chance for this test
      pathIndex: 0,
      pathProgress: 0,
      path: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      speed: 100,
    });

    const proj = world.createEntity();
    world.projectiles.set(proj, {
      ownerId: 'p1',
      betAmount: 10,
      angle: 0,
      bouncesRemaining: 10,
    });

    const collisions = [{ projectileId: proj, objectId: obj, projectileOwnerId: 'p1', betAmount: 10 }];
    const payouts = destroySystem(world, collisions, engine, wallet);

    assert.strictEqual(payouts.length, 1);
    assert.strictEqual(payouts[0].payout, 20); // 10 × 2 multiplier
    assert.ok(world.pendingDestroy.has(obj));
    assert.ok(world.pendingDestroy.has(proj));
    assert.strictEqual(wallet.getBalance('p1'), 1020);
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
    const ids = results.map(r => r.entityId);
    assert.ok(ids.includes(1), 'Should find entity 1');
    assert.ok(ids.includes(3), 'Should find entity 3');
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
    assert.strictEqual(recycled.value, 0); // Should be reset
  });
});

// ─── System Runner Integration Test ───

describe('SystemRunner', () => {
  it('should run a complete tick cycle', () => {
    const rng = new SeededRngService(42);
    const wallet = new WalletManager();
    wallet.initPlayer('p1', 1000);

    const world = new World();

    // Create a turret for p1
    const turretId = world.createEntity();
    world.positions.set(turretId, { x: 960, y: 1020 });
    world.turrets.set(turretId, {
      playerId: 'p1',
      position: 'BOTTOM_MIDDLE' as any,
    });

    const engine = new RtpEngine(rng);
    const spawnSystem = new SpawnSystem(rng);
    const runner = new SystemRunner(world, engine, wallet, spawnSystem);

    // Queue a fire intent
    const intentId = world.createEntity();
    world.fireIntents.set(intentId, {
      playerId: 'p1',
      angle: -Math.PI / 2, // shooting up
      betAmount: 5,
    });

    // Run one tick
    const result = runner.tick();

    // The fire should have been processed
    assert.strictEqual(world.fireIntents.size, 0, 'Fire intents should be consumed');

    // Bet should have been deducted
    assert.strictEqual(wallet.getBalance('p1'), 995);

    // A projectile should exist
    assert.ok(result.newProjectiles.length === 1, 'Should create one projectile');
    assert.strictEqual(result.rejectedShots.length, 0, 'No shots should be rejected');
  });
});
