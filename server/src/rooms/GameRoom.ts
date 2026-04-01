// ─────────────────────────────────────────────────────────────
// GameRoom — Authoritative Server-Side Game Room
// ─────────────────────────────────────────────────────────────
// SECURITY: Server is the single source of truth. Client is
// a dumb renderer. All economy, RTP, and hit resolution
// happens here. absorbedCredits and hot-seat ID never leave
// server memory.
// CONFIG-DRIVEN: Economy behavior flows through GameBalanceConfig.
// AUDIT: Every collision resolution is available in tick results.
// ─────────────────────────────────────────────────────────────

import { Room, Client, type CloseCode, type Deferred } from 'colyseus';
import {
  MAX_PLAYERS,
  FIXED_TIMESTEP_MS,
  STARTING_CREDITS,
  SEAT_COORDINATES,
  TurretPosition,
  DEFAULT_BET,
  MIN_BET,
  MAX_BET,
  BET_INCREMENT,
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  WEAPON_COST,
  WEAPON_TYPES,
  clampTurretAngle,
} from '@space-shooter/shared';
import type { WeaponType, FireWeaponMessage, ChangeBetMessage, PointerMoveMessage, SwitchWeaponMessage } from '@space-shooter/shared';

import {
  GameRoomState,
  PlayerSchema,
  SpaceObjectSchema,
} from './schema/GameRoomState.js';

import { World } from '../ecs/World.js';
import { SystemRunner } from '../ecs/systems/SystemRunner.js';
import { SpawnSystem } from '../ecs/systems/SpawnSystem.js';
import { CsprngService } from '../services/CsprngService.js';
import { RtpEngine } from '../services/RtpEngine.js';
import { WalletManager } from '../services/WalletManager.js';
import { RoomEconomyManager } from '../services/RoomEconomyManager.js';
import { GAME_BALANCE_CONFIG } from '../config/GameBalanceConfig.js';
import { prisma } from '../services/prisma.js';
import { randomUUID } from 'node:crypto';

/**
 * Seat management: 6 fixed seats indexed 0–5.
 * null = vacant, string = occupied by sessionId.
 */
type SeatArray = (string | null)[];

/** Sliding window violation tracker */
interface ViolationTracker {
  count: number;
  windowStart: number;
}

export class GameRoom extends Room<{ state: GameRoomState }> {
  maxClients = MAX_PLAYERS;

  /** 
   * Global economy pool to recycle lost credits (missed shots + despawned targets).
   * Used by RtpEngine to subsidize future wins.
   * Server-side only (NOT in Colyseus schema).
   */
  public globalReservePool = 0;

  // ─── ECS + Services ───
  private world!: World;
  private systemRunner!: SystemRunner;
  private wallet!: WalletManager;
  private rng!: CsprngService;
  private rtpEngine!: RtpEngine;
  private economy!: RoomEconomyManager;

  // ─── Tick loop ───
  private simulationInterval: ReturnType<typeof setInterval> | null = null;
  private dbSyncInterval: ReturnType<typeof setInterval> | null = null;
  private auditCleanupInterval: ReturnType<typeof setInterval> | null = null;

  // ─── Seat management ───
  private readonly seats: SeatArray = new Array<string | null>(MAX_PLAYERS).fill(null);
  private readonly playerBets: Map<string, number> = new Map();
  private readonly playerWeapons: Map<string, WeaponType> = new Map();

  // ─── Security: Rate Limiting ───
  private readonly lastShotTimestamp: Map<string, number> = new Map();
  private readonly rateLimitViolations: Map<string, ViolationTracker> = new Map();
  /** Validate bet is within range and on an increment boundary */
  private static isValidBet(amount: number): boolean {
    return amount >= MIN_BET && amount <= MAX_BET && amount % BET_INCREMENT === 0;
  }

  // ─── Reconnection tracking ───
  private readonly reconnections: Map<string, Deferred<Client>> = new Map();

  // ─── Message handlers ───
  messages = {
    [CLIENT_MESSAGES.FIRE_WEAPON]: (client: Client, message: FireWeaponMessage) => {
      this.handleFireWeapon(client, message);
    },
    [CLIENT_MESSAGES.ADMIN_REFILL]: (client: Client, message: { amount: number }) => {
      // Gated admin refill: only allowed for authenticated admin users
      if (!client.auth?.isAdmin) {
        console.warn(`[SECURITY] Unauthorized admin refill attempt from ${client.sessionId}`);
        return;
      }
      if (typeof message.amount === 'number' && Number.isFinite(message.amount) && message.amount > 0) {
        this.wallet.awardPayout(client.sessionId, message.amount);
        console.log(`[GameRoom] Admin refill granted to ${client.auth?.username || client.sessionId} for ${message.amount} credits`);
      }
    },
    [CLIENT_MESSAGES.CHANGE_BET]: (client: Client, message: ChangeBetMessage) => {
      this.handleChangeBet(client, message);
    },
    [CLIENT_MESSAGES.POINTER_MOVE]: (client: Client, message: PointerMoveMessage) => {
      this.handlePointerMove(client, message);
    },
    [CLIENT_MESSAGES.SWITCH_WEAPON]: (client: Client, message: SwitchWeaponMessage) => {
      this.handleSwitchWeapon(client, message);
    },
  };

  // ─── Lifecycle ───

  onCreate(_options: Record<string, unknown>): void {
    this.state = new GameRoomState();

    // Initialize services
    this.rng = new CsprngService();
    this.wallet = new WalletManager();
    this.economy = new RoomEconomyManager(GAME_BALANCE_CONFIG);
    this.rtpEngine = new RtpEngine(this.rng, this.economy, GAME_BALANCE_CONFIG);

    // Initialize ECS
    this.world = new World();
    const spawnSystem = new SpawnSystem(this.rng, GAME_BALANCE_CONFIG);
    this.systemRunner = new SystemRunner(
      this.world,
      this.rtpEngine,
      this.rng,
      this.wallet,
      this.economy,
      GAME_BALANCE_CONFIG,
      spawnSystem,
      this, // Pass GameRoom as the reserve pool provider
    );

    console.log("[GameRoom] Room Created and Ticking");

    // Restore reserve pool from DB
    this.restoreReservePool().catch(err => {
      console.error('[GameRoom] Failed to restore reserve pool:', err);
    });

    // Start the fixed-timestep simulation loop
    this.simulationInterval = setInterval(() => {
      this.simulateTick();
    }, FIXED_TIMESTEP_MS);

    // 5000ms batch DB sync timer (wallets + reserve pool)
    this.dbSyncInterval = setInterval(async () => {
      try {
        await Promise.all([
          this.wallet.syncToDatabase(),
          this.persistReservePool(),
        ]);
      } catch (err) {
        console.error('[GameRoom] Database Batch Sync Error:', err);
      }
    }, 5000);

    // Audit log retention: purge entries older than 90 days every hour
    this.auditCleanupInterval = setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const { count } = await prisma.auditLog.deleteMany({
          where: { timestamp: { lt: cutoff } },
        });
        if (count > 0) {
          console.log(`[GameRoom] Purged ${count} audit logs older than 90 days`);
        }
      } catch (err) {
        console.error('[GameRoom] Audit log cleanup error:', err);
      }
    }, 60 * 60 * 1000); // Every hour

    console.log(`[GameRoom] Room ${this.roomId} created. Tick rate: ${1000 / FIXED_TIMESTEP_MS} Hz`);
    console.log(`[GameRoom] RTP target: ${GAME_BALANCE_CONFIG.targetRtp * 100}%`);
    console.log(`[GameRoom] Security: fire rate=${GAME_BALANCE_CONFIG.security.maxFireRateMs}ms, auto-ban=${GAME_BALANCE_CONFIG.security.rateLimitViolationThreshold} violations/${GAME_BALANCE_CONFIG.security.rateLimitWindowMs}ms`);
    console.log(`[GameRoom] Max success threshold: ${GAME_BALANCE_CONFIG.maxSuccessThreshold * 100}%`);
  }

  async onAuth(client: Client, options: { token?: string }): Promise<any> {
    console.log(`[GameRoom] onAuth called for client ${client.sessionId} with options:`, options);
    let user;
    const token = options.token;

    try {
      if (token) {
        user = await prisma.user.findUnique({ where: { token } });
      }

      if (!user) {
        // Create guest account
        const newToken = randomUUID();
        user = await prisma.user.create({
          data: {
            username: `Guest-${Math.floor(Math.random() * 10000)}`,
            token: newToken,
            balance: STARTING_CREDITS,
          }
        });
        console.log(`[GameRoom] Created new guest user ${user.id} with token ${user.token}`);
      }
    } catch (err) {
      console.error(`[CRITICAL] Database offline, falling back to guest mode for token ${token || 'none'}`, err);
      // Failsafe Mock User for local testing when DB is down
      user = {
        id: randomUUID(),
        username: `Offline-${Math.floor(Math.random() * 1000)}`,
        token: token || randomUUID(),
        balance: STARTING_CREDITS,
      };
    }

    // Session Lock: prevent double-spending exploit via multiple tabs
    const isAlreadyConnected = this.clients.some(c => c.auth?.id === user.id);
    if (isAlreadyConnected) {
      console.warn(`[GameRoom] Session lock denied for user ${user.id}`);
      throw new Error('User already connected to this room.');
    }

    return user;
  }

  onJoin(client: Client, _options: Record<string, unknown>): void {
    console.log("[GameRoom] Client Joined, assigning turret...");
    
    // Assign the lowest available seat index
    const seatIndex = this.getAvailableSeat();
    if (seatIndex === -1) {
      client.leave(4000); // No seats available
      return;
    }

    this.seats[seatIndex] = client.sessionId;
    this.playerBets.set(client.sessionId, DEFAULT_BET);

    // Get turret coordinates from seat
    const coords = SEAT_COORDINATES[seatIndex];

    const user = client.auth;
    const initialCredits = user ? Number(user.balance) : STARTING_CREDITS;

    // Initialize wallet with DB balance
    this.wallet.initPlayer(client.sessionId, initialCredits);

    // Register player in RTP engine (pity timer tracking)
    this.rtpEngine.addPlayer(client.sessionId);

    // Create turret entity in ECS
    const turretId = this.world.createEntity();
    this.world.positions.set(turretId, { x: coords.x, y: coords.y });
    this.world.turrets.set(turretId, {
      playerId: client.sessionId,
      position: this.seatIndexToPosition(seatIndex),
    });

    // Add to Colyseus state
    const playerSchema = new PlayerSchema();
    playerSchema.sessionId = client.sessionId;
    playerSchema.position = this.seatIndexToPosition(seatIndex);
    playerSchema.seatIndex = seatIndex;
    playerSchema.betAmount = DEFAULT_BET;
    playerSchema.credits = initialCredits;
    playerSchema.turretX = coords.x;
    playerSchema.turretY = coords.y;
    this.state.players.set(client.sessionId, playerSchema);

    // Initialize rate-limit state
    this.lastShotTimestamp.set(client.sessionId, 0);
    this.rateLimitViolations.set(client.sessionId, { count: 0, windowStart: 0 });

    console.log(`[GameRoom] Player ${client.sessionId} joined at seat ${seatIndex} (${coords.x}, ${coords.y})`);
  }

  // ─── Disconnect Handling ───

  /**
   * Called when a client unexpectedly disconnects (network drop, tab close).
   * Reserves their seat for 30 seconds so mid-air projectiles can still
   * resolve payouts. Wallet, RTP state, and turret are preserved.
   */
  async onDrop(client: Client, _code: number): Promise<void> {
    const { reconnectionTimeoutSec } = GAME_BALANCE_CONFIG.security;

    // Mark player as disconnected in schema (for client-side UI)
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
    }

    console.log(`[GameRoom] Player ${client.sessionId} dropped. Reserving seat for ${reconnectionTimeoutSec}s...`);

    try {
      // Reserve seat — mid-air projectiles continue to simulate
      const reconnection = this.allowReconnection(client, reconnectionTimeoutSec);
      this.reconnections.set(client.sessionId, reconnection);

      await reconnection;

      // Player reconnected!
      this.reconnections.delete(client.sessionId);
      if (player) {
        player.connected = true;
      }
      // Reset rate-limit state for fresh session
      this.lastShotTimestamp.set(client.sessionId, 0);
      this.rateLimitViolations.set(client.sessionId, { count: 0, windowStart: 0 });

      console.log(`[GameRoom] Player ${client.sessionId} reconnected! Balance: ${this.wallet.getBalance(client.sessionId)}`);

    } catch (err) {
      // Reconnection timed out or was rejected — full cleanup
      console.log(`[GameRoom] Player ${client.sessionId} reconnection expired:`, err instanceof Error ? err.message : 'timeout');
      this.reconnections.delete(client.sessionId);
      this.performFullCleanup(client.sessionId);
    }
  }

  /**
   * Called when a client intentionally leaves (consented close).
   * Performs immediate full cleanup.
   */
  onLeave(client: Client, _code: CloseCode): void {
    this.performFullCleanup(client.sessionId);
  }

  /** Shared cleanup for both consented leave and reconnection timeout */
  private performFullCleanup(sessionId: string): void {
    const seatIndex = this.seats.indexOf(sessionId);

    // Clean up turret entity
    for (const [entityId, turret] of this.world.turrets) {
      if (turret.playerId === sessionId) {
        this.world.destroyEntity(entityId);
        break;
      }
    }

    // IMPORTANT: Do NOT destroy mid-air projectiles.
    // Per fish-table genre rules, bullets fired by a disconnected
    // player continue to simulate and resolve. Payouts credit
    // their server-side wallet even while offline.
    // The wallet survives until the player's seat reservation expires.

    // Force an immediate DB sync for the departing player (fire-and-forget)
    this.wallet.syncToDatabase(sessionId).catch(err => {
      console.error(`[GameRoom] Failed to sync wallet on disconnect for ${sessionId}:`, err);
    });

    if (seatIndex >= 0) this.seats[seatIndex] = null;
    this.playerBets.delete(sessionId);
    this.playerWeapons.delete(sessionId);
    this.rtpEngine.removePlayer(sessionId);
    this.wallet.removePlayer(sessionId);
    this.state.players.delete(sessionId);

    // Clean up rate-limit state
    this.lastShotTimestamp.delete(sessionId);
    this.rateLimitViolations.delete(sessionId);
    this.reconnections.delete(sessionId);

    console.log(`[GameRoom] Player ${sessionId} fully cleaned up (was at seat ${seatIndex})`);
  }

  onDispose(): void {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    if (this.dbSyncInterval) {
      clearInterval(this.dbSyncInterval);
      this.dbSyncInterval = null;
    }
    if (this.auditCleanupInterval) {
      clearInterval(this.auditCleanupInterval);
      this.auditCleanupInterval = null;
    }
    // Persist reserve pool on shutdown
    this.persistReservePool().catch(err => {
      console.error('[GameRoom] Failed to persist reserve pool on dispose:', err);
    });
    this.world.clear();
    this.wallet.clear();
    this.economy.reset();
    this.rtpEngine.reset();
    console.log(`[GameRoom] Room ${this.roomId} disposed.`);
  }

  // ─── Message Handlers ───

  private handleFireWeapon(client: Client, message: FireWeaponMessage): void {
    const { maxFireRateMs, rateLimitViolationThreshold, rateLimitWindowMs } =
      GAME_BALANCE_CONFIG.security;
    const now = Date.now();
    const sessionId = client.sessionId;

    // ─── Security: Payload Validation ───
    if (!Number.isFinite(message.angle)) {
      console.warn(`[SECURITY] Invalid angle from ${sessionId}: ${message.angle}`);
      return; // Silently drop
    }

    // ─── Security: Bet Tier Validation ───
    const betAmount = this.playerBets.get(sessionId) ?? DEFAULT_BET;
    if (!GameRoom.isValidBet(betAmount)) {
      console.warn(`[SECURITY] Invalid bet from ${sessionId}: ${betAmount}`);
      return; // Silently drop
    }

    // ─── Security: Rate Limiting (O(1) timestamp delta) ───
    const lastShot = this.lastShotTimestamp.get(sessionId) ?? 0;
    if (now - lastShot < maxFireRateMs) {
      // Too fast — silently drop and track violation
      const tracker = this.rateLimitViolations.get(sessionId);
      if (tracker) {
        // Reset window if expired
        if (now - tracker.windowStart > rateLimitWindowMs) {
          tracker.count = 0;
          tracker.windowStart = now;
        }
        tracker.count++;

        if (tracker.count >= rateLimitViolationThreshold) {
          console.warn(`[SECURITY] Auto-kicking ${sessionId}: ${tracker.count} rate-limit violations in ${rateLimitWindowMs}ms`);
          client.leave(4000, 'Auto-clicker detected');
          return;
        }
      }
      return; // Silently drop the shot
    }
    this.lastShotTimestamp.set(sessionId, now);

    // ─── Security: Out-of-funds pre-check (weapon cost scaling) ───
    const weaponType = this.playerWeapons.get(sessionId) ?? 'standard';
    const totalCost = betAmount * WEAPON_COST[weaponType];
    const balance = this.wallet.getBalance(sessionId);
    if (balance < totalCost) {
      client.send(SERVER_MESSAGES.OUT_OF_FUNDS, {
        type: SERVER_MESSAGES.OUT_OF_FUNDS,
        currentCredits: balance,
        requiredBet: totalCost,
      });
      return; // Do NOT create a fire intent
    }

    // Parse and validate optional lock-on target
    let lockedTargetId: number | undefined;
    if (message.lockedTargetId) {
      const parsed = Number(message.lockedTargetId);
      if (Number.isFinite(parsed) && this.world.spaceObjects.has(parsed)) {
        lockedTargetId = parsed;
      }
    }

    // Queue a fire intent for the next tick (never mutate ECS mid-tick)
    const intentId = this.world.createEntity();
    const intent: import('../ecs/components.js').FireIntentComponent = {
      playerId: sessionId,
      angle: message.angle,
      betAmount,
      weaponType,
    };
    if (lockedTargetId !== undefined) {
      (intent as { lockedTargetId?: number }).lockedTargetId = lockedTargetId;
    }
    this.world.fireIntents.set(intentId, intent);
  }

  private handleSwitchWeapon(client: Client, message: SwitchWeaponMessage): void {
    const wt = message.weaponType;
    if (!(WEAPON_TYPES as readonly string[]).includes(wt)) {
      console.warn(`[SECURITY] Invalid weapon type from ${client.sessionId}: ${wt}`);
      return;
    }
    this.playerWeapons.set(client.sessionId, wt as WeaponType);

    // Sync to schema for client UI
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.weaponType = wt;
    }
  }

  private handleChangeBet(client: Client, message: ChangeBetMessage): void {
    if (!Number.isFinite(message.amount)) return;
    // Snap to nearest valid increment within range
    const snapped = Math.round(message.amount / BET_INCREMENT) * BET_INCREMENT;
    const clamped = Math.max(MIN_BET, Math.min(MAX_BET, snapped));

    this.playerBets.set(client.sessionId, clamped);

    // Update Colyseus state for UI sync
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.betAmount = clamped;
    }
  }

  private handlePointerMove(client: Client, message: PointerMoveMessage): void {
    if (!Number.isFinite(message.angle)) return;
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.turretAngle = clampTurretAngle(message.angle, player.seatIndex);
    }
  }

  // ─── Simulation ───

  private simulateTick(): void {
    const startTime = performance.now();

    // Gather active player session IDs for hot-seat rotation
    const activePlayers = this.seats.filter((s): s is string => s !== null);

    // Run the full ECS pipeline
    const result = this.systemRunner.tick(activePlayers);

    // ─── Sync ECS state → Colyseus schema (delta broadcasting) ───
    // NOTE: absorbedCredits and isDead are NEVER synced to clients.
    // NOTE: Projectiles are NOT synced via schema — they use
    //       event-driven "remote_shoot" broadcasts instead.

    // Update space objects
    // SECURITY: Only sync type, position, multiplier. Never absorbedCredits.
    this.state.spaceObjects.clear();
    for (const [entityId, obj] of this.world.spaceObjects) {
      const pos = this.world.positions.get(entityId);
      if (!pos) continue;

      const schema = new SpaceObjectSchema();
      schema.id = String(entityId);
      schema.x = Math.round(pos.x * 10) / 10;
      schema.y = Math.round(pos.y * 10) / 10;
      schema.objectType = obj.type;
      schema.multiplier = obj.multiplier;
      schema.isCaptured = obj.isCaptured;
      this.state.spaceObjects.set(String(entityId), schema);
    }

    // Update player credits
    for (const [playerId, player] of this.state.players) {
      player.credits = this.wallet.getBalance(playerId);
      const buff = this.world.playerBuffs.get(playerId);
      player.activeBuff = buff?.buff ?? 'none';
      player.buffTimeLeft = buff?.timeLeft ?? 0;
    }

    // Update tick counter
    this.state.tick = this.world.currentTick;

    // ─── Broadcast events via messages ───

    // Remote shoot events (ghost projectile visuals for other clients)
    for (const proj of result.newProjectiles) {
      const seatIndex = this.seats.indexOf(proj.ownerId);
      const targetClient = this.clients.find(c => c.sessionId === proj.ownerId);
      if (targetClient && seatIndex >= 0) {
        this.broadcast(SERVER_MESSAGES.REMOTE_SHOOT, {
          type: SERVER_MESSAGES.REMOTE_SHOOT,
          sessionId: proj.ownerId,
          seatIndex,
          angle: proj.angle,
          lockedTargetId: proj.lockedTargetId === undefined ? undefined : String(proj.lockedTargetId),
        }, { except: targetClient });
      }
    }

    // Log RNG audit trail for all resolved hits (for dispute resolution)
    for (const res of result.collisionResolutions) {
      if (res.hitEvaluation.destroyed && res.hitEvaluation.payout >= 100) {
        console.log(`[RNG_AUDIT] kill player=${res.playerId} target=${res.targetEntityId} ` +
          `bet=${res.betAmount} payout=${res.hitEvaluation.payout} mult=${res.hitEvaluation.multiplier} ` +
          `roll=${res.hitEvaluation.rngRoll.toFixed(6)} threshold=${res.hitEvaluation.finalThreshold.toFixed(6)} ` +
          `mods=[gv=${res.hitEvaluation.modifiers.globalVolatility.toFixed(3)} ` +
          `hs=${res.hitEvaluation.modifiers.hotSeatModifier.toFixed(3)} ` +
          `pin=${res.hitEvaluation.modifiers.pinataModifier.toFixed(3)} ` +
          `pity=${res.hitEvaluation.modifiers.pityModifier.toFixed(3)}]`);
      }
    }

    // Payouts (object destroyed events)
    for (const payout of result.payouts) {
      const seatIndex = this.seats.indexOf(payout.playerId);
      this.broadcast('objectDestroyed', {
        objectId: payout.objectId,
        playerId: payout.playerId,
        objectType: payout.objectType,
        hazardType: (payout as any).hazardType,
        payout: payout.payout,
        multiplier: payout.multiplier,
        seatIndex,
      });
    }

    // Rejected shots
    for (const rejected of result.rejectedShots) {
      const targetClient = this.clients.find(c => c.sessionId === rejected.playerId);
      if (targetClient) {
        targetClient.send('shotRejected', { reason: rejected.reason });
      }
    }

    // NOTE: result.collisionResolutions contains every shot's full
    // modifier breakdown for audit logging. In production, pipe this
    // to AuditLogger.logResolutions(result.collisionResolutions).

    // Chain lightning hit events (for frontend trail rendering)
    for (const chainHit of result.chainHits) {
      const seatIndex = this.seats.indexOf(chainHit.projectileOwnerId);
      this.broadcast(SERVER_MESSAGES.CHAIN_HIT, {
        type: SERVER_MESSAGES.CHAIN_HIT,
        targetType: 'emp_relay',
        projectileOwnerId: chainHit.projectileOwnerId,
        seatIndex,
        fromX: chainHit.fromX,
        fromY: chainHit.fromY,
        toX: chainHit.toX,
        toY: chainHit.toY,
        targetId: String(chainHit.targetId),
        payout: chainHit.payout,
      });
    }

    // AoE blast events (for frontend supernova visualization)
    for (const aoe of result.aoeBlasts) {
      const seatIndex = this.seats.indexOf(aoe.playerId);
      this.broadcast(SERVER_MESSAGES.AOE_DESTROYED, {
        type: SERVER_MESSAGES.AOE_DESTROYED,
        targetType: 'supernova_bomb',
        x: aoe.x,
        y: aoe.y,
        totalPayout: aoe.totalPayout,
        playerId: aoe.playerId,
        seatIndex,
        destroyedTargetIds: aoe.destroyedTargetIds.map(String),
      });
    }

    // Feature target spawn events
    for (const spawn of result.featureSpawns) {
      const seatIndex = this.seats.indexOf(spawn.playerId);
      this.broadcast(SERVER_MESSAGES.FEATURE_ACTIVATED, {
        type: SERVER_MESSAGES.FEATURE_ACTIVATED,
        hazardType: spawn.hazardType,
        x: spawn.x,
        y: spawn.y,
        playerId: spawn.playerId,
        seatIndex,
        budget: spawn.budget,
      });

      // Vault-specific roulette message
      if (spawn.hazardType === 'vault' && spawn.vaultMultiplier) {
        const payout = spawn.betAmount * spawn.vaultMultiplier;
        this.broadcast(SERVER_MESSAGES.FEATURE_VAULT_ROULETTE, {
          type: SERVER_MESSAGES.FEATURE_VAULT_ROULETTE,
          targetType: 'cosmic_vault',
          playerId: spawn.playerId,
          multiplier: spawn.vaultMultiplier,
          payout,
        });
      }

      // EMP-specific chain message
      if (spawn.hazardType === 'emp') {
        const capturedIds: string[] = [];
        for (const [eid, obj] of this.world.spaceObjects) {
          if (obj.isCaptured) capturedIds.push(String(eid));
        }
        this.broadcast(SERVER_MESSAGES.FEATURE_EMP_CHAIN, {
          type: SERVER_MESSAGES.FEATURE_EMP_CHAIN,
          victimIds: capturedIds,
          sourceX: spawn.x,
          sourceY: spawn.y,
          playerId: spawn.playerId,
        });
      }

      // Orbital laser buff message
      if (spawn.hazardType === 'orbital_laser') {
        this.broadcast(SERVER_MESSAGES.FEATURE_ORBITAL_LASER, {
          type: SERVER_MESSAGES.FEATURE_ORBITAL_LASER,
          playerId: spawn.playerId,
          seatIndex,
          active: true,
          betAmount: spawn.betAmount,
        });
      }
    }

    // Hazard system events
    for (const evt of result.hazardEvents) {
      if (evt.type === 'hazardEnd') {
        const endEvt = evt as import('../ecs/systems/HazardSystem.js').HazardEndEvent;
        this.broadcast(SERVER_MESSAGES.FEATURE_ENDED, {
          type: SERVER_MESSAGES.FEATURE_ENDED,
          hazardId: String(endEvt.hazardId),
          totalPayout: endEvt.totalPayout,
          playerId: endEvt.ownerSessionId,
        });
      }
    }

    const elapsed = performance.now() - startTime;
    if (elapsed > FIXED_TIMESTEP_MS) {
      console.warn(`[WARN] SERVER LAG DETECTED: Tick took ${elapsed.toFixed(2)} ms (Limit: ${FIXED_TIMESTEP_MS}ms)`);
    }
  }

  // ─── Helpers ───

  /** Get the lowest available seat index, or -1 if full */
  private getAvailableSeat(): number {
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i] === null) return i;
    }
    return -1;
  }

  /** Restore reserve pool from DB on room creation */
  private async restoreReservePool(): Promise<void> {
    const row = await prisma.roomEconomy.findUnique({ where: { id: 'singleton' } });
    if (row) {
      this.globalReservePool = Number(row.reservePool);
      console.log(`[GameRoom] Restored reserve pool: ${this.globalReservePool}`);
    }
  }

  /** Persist reserve pool to DB */
  private async persistReservePool(): Promise<void> {
    await prisma.roomEconomy.upsert({
      where: { id: 'singleton' },
      update: { reservePool: this.globalReservePool },
      create: { id: 'singleton', reservePool: this.globalReservePool },
    });
  }

  /** Map seat index to TurretPosition enum value */
  private seatIndexToPosition(seatIndex: number): TurretPosition {
    const positions: TurretPosition[] = [
      TurretPosition.BOTTOM_LEFT, TurretPosition.BOTTOM_MIDDLE, TurretPosition.BOTTOM_RIGHT,
      TurretPosition.TOP_LEFT, TurretPosition.TOP_MIDDLE, TurretPosition.TOP_RIGHT,
    ];
    return positions[seatIndex] ?? TurretPosition.BOTTOM_LEFT;
  }
}
