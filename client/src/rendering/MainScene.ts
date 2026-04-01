import * as Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  SEAT_COORDINATES,
  SEAT_COLORS,
  SpaceObjectType,
  OBJECT_RADII,
} from '@space-shooter/shared';
import { FXManager } from '../fx/FXManager.js';

/**
 * Sprite-to-SpaceObjectType mapping for animation keys
 */
const SPRITE_KEY_MAP: Record<string, string> = {
  [SpaceObjectType.ASTEROID]: 'asteroid',
  [SpaceObjectType.ROCKET]: 'rocket',
  [SpaceObjectType.ALIEN_CRAFT]: 'alien_craft',
  [SpaceObjectType.SPACE_JELLY]: 'space_jelly',
  [SpaceObjectType.ALIEN_CREATURE]: 'alien_creature',
  [SpaceObjectType.METEOR_SHOWER]: 'meteor_shower',
  [SpaceObjectType.NEBULA_BEAST]: 'nebula_beast',
  [SpaceObjectType.COSMIC_WHALE]: 'cosmic_whale',
  [SpaceObjectType.SUPERNOVA_BOMB]: 'supernova_bomb',
  [SpaceObjectType.BLACKHOLE_GEN]: 'blackhole_gen',
  [SpaceObjectType.QUANTUM_DRILL]: 'quantum_drill',
  [SpaceObjectType.EMP_RELAY]: 'emp_relay',
  [SpaceObjectType.ORBITAL_CORE]: 'orbital_core',
  [SpaceObjectType.COSMIC_VAULT]: 'cosmic_vault',
};

/**
 * Color palette for space objects
 */
const OBJECT_COLORS: Record<string, string> = {
  [SpaceObjectType.ASTEROID]: '#8B7355',
  [SpaceObjectType.ROCKET]: '#FF6347',
  [SpaceObjectType.ALIEN_CRAFT]: '#00FF88',
  [SpaceObjectType.SPACE_JELLY]: '#DA70D6',
  [SpaceObjectType.ALIEN_CREATURE]: '#FFD700',
  [SpaceObjectType.METEOR_SHOWER]: '#FF4500',
  [SpaceObjectType.NEBULA_BEAST]: '#9370DB',
  [SpaceObjectType.COSMIC_WHALE]: '#00CED1',
  [SpaceObjectType.SUPERNOVA_BOMB]: '#FF00FF',
  [SpaceObjectType.BLACKHOLE_GEN]: '#1A0033',
  [SpaceObjectType.QUANTUM_DRILL]: '#FF3300',
  [SpaceObjectType.EMP_RELAY]: '#00CCFF',
  [SpaceObjectType.ORBITAL_CORE]: '#FFAA00',
  [SpaceObjectType.COSMIC_VAULT]: '#FFD700',
};

/**
 * Sprite container for space objects with animated sprite + multiplier text
 */
interface SpaceObjectContainer {
  sprite: Phaser.GameObjects.Sprite;
  multText: Phaser.GameObjects.Text;
  container: Phaser.GameObjects.Container;
  /** Per-instance rotation speed in radians/sec (asteroids only) */
  rotationSpeed?: number;
  /** Previous server position for heading calculation */
  prevX: number;
  prevY: number;
  /** Whether this sprite should face its travel direction */
  faceHeading: boolean;
}

export class MainScene extends Phaser.Scene {
  private roomState: any;
  public localSessionId = '';
  public fxManager: FXManager;

  // Dictionaries tracking active Phaser objects linked to Server Entities
  private readonly spaceObjectSprites: Map<string, SpaceObjectContainer> = new Map();
  private readonly turretSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Background layer
  private backgroundImage!: Phaser.GameObjects.Image;
  private parallaxLayer!: Phaser.GameObjects.Layer;

  // Ghost lasers layer (ring buffer for O(1) add/remove)
  private ghostLaserGraphics!: Phaser.GameObjects.Graphics;
  private static readonly MAX_GHOST_LASERS = 200;
  private readonly ghostLaserBuffer: Array<{
    id: number;
    x: number;
    y: number;
    angle: number;
    bouncesRemaining: number;
    age: number;
    color: string;
    weaponType: string;
    alpha: number;
    active: boolean;
  } | null> = new Array(MainScene.MAX_GHOST_LASERS).fill(null);
  private ghostLaserHead = 0;
  private ghostLaserCount = 0;

  // Coin particles (swap-and-pop for O(1) removal)
  private static readonly MAX_COIN_PARTICLES = 120;
  private readonly coinParticles: Array<{
    x: number;
    y: number;
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    age: number;
    duration: number;
    burstAngle: number;
    burstDist: number;
    color: string;
    payout: number;
    isLocal: boolean;
  }> = [];

  // Payout notifications
  private readonly payoutNotifications: Array<{
    x: number;
    y: number;
    payout: number;
    multiplier: number;
    emoji: string;
    alpha: number;
    age: number;
    color: string;
    textObj?: Phaser.GameObjects.Text;
  }> = [];

  public onLocalCoinsArrived: ((payout: number) => void) | null = null;
  private nextGhostId = 1;

  constructor() {
    super({ key: 'MainScene' });
    this.fxManager = new FXManager();
  }

  init(data: { roomState: any; localSessionId: string }) {
    this.roomState = data.roomState;
    this.localSessionId = data.localSessionId;
  }

  public setRoomState(state: any) {
    this.roomState = state;
  }

  create() {
    console.log('[Phaser] MainScene created');
    this.cameras.main.setBackgroundColor('#0a0a1a');
    this.fxManager.init(this);

    // 1. Background image
    this.backgroundImage = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'background');
    this.backgroundImage.setOrigin(0.5, 0.5);
    this.backgroundImage.setDepth(0);

    // 2. Parallax layer for subtle floating particles/starfield (optional)
    this.parallaxLayer = this.add.layer();
    this.parallaxLayer.setDepth(1);
    this.createParallaxEffect();

    // 3. Ghost Lasers Layer
    this.ghostLaserGraphics = this.add.graphics();
    this.ghostLaserGraphics.setDepth(10);

    // 4. Draw initial ghost turrets (empty seats)
    this.renderGhostTurrets();
  }

  update(time: number, delta: number) {
    if (!this.roomState) return;

    this.syncSpaceObjects(delta);
    this.syncTurrets();
    this.updateAndRenderVFX(delta / 1000, delta);
  }

  /**
   * Create a subtle parallax effect with floating particles
   */
  private createParallaxEffect() {
    // Create subtle twinkling stars or particles
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * GAME_WIDTH;
      const y = Math.random() * GAME_HEIGHT;
      const size = Math.random() * 1.5 + 0.5;
      const alpha = Math.random() * 0.6 + 0.2;

      const particle = this.add.graphics();
      particle.fillStyle(0xffffff, alpha);
      particle.fillCircle(x, y, size);
      particle.setDepth(1);

      // Subtle floating animation
      this.tweens.add({
        targets: particle,
        y: y - 50,
        alpha: alpha * 0.3,
        duration: 8000 + Math.random() * 4000,
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /**
   * Render empty seats as ghost turrets
   */
  private renderGhostTurrets() {
    const occupiedSeats = new Set<number>();
    if (this.roomState) {
      this.roomState.players.forEach((player: any) => {
        occupiedSeats.add(player.seatIndex);
      });
    }

    const g = this.add.graphics({ lineStyle: { width: 1, color: 0x555577 } });
    g.setDepth(5);
    for (let i = 0; i < 6; i++) {
      if (occupiedSeats.has(i)) continue;
      const coords = SEAT_COORDINATES[i];

      g.strokeCircle(coords.x, coords.y, 18);
      const yOffset = coords.y > GAME_HEIGHT / 2 ? 30 : -25;
      this.add
        .text(coords.x, coords.y + yOffset, 'OPEN', {
          fontSize: '10px',
          color: '#555577',
          fontFamily: 'Inter',
        })
        .setOrigin(0.5)
        .setDepth(5);
    }
  }

  /**
   * Sync server space objects to Phaser sprites with animations
   */
  private syncSpaceObjects(deltaMs: number) {
    const activeIds = new Set<string>();

    this.roomState.spaceObjects.forEach((obj: any, key: string) => {
      activeIds.add(key);

      const spriteKey = SPRITE_KEY_MAP[obj.objectType] ?? 'asteroid';
      const colorHex = Phaser.Display.Color.HexStringToColor(
        OBJECT_COLORS[obj.objectType] ?? '#ffffff'
      ).color;

      // Create if not exists
      if (!this.spaceObjectSprites.has(key)) {
        const container = this.add.container(obj.x, obj.y);
        container.setDepth(20);

        const isAsteroid = obj.objectType === SpaceObjectType.ASTEROID;

        // Create sprite — asteroids are static images, everything else is animated
        const sprite = this.add.sprite(0, 0, spriteKey);
        sprite.setOrigin(0.5, 0.5);
        if (!isAsteroid) {
          sprite.play(`${spriteKey}_idle`);
        }

        // Asteroids: random scale variation (0.6x to 1.3x)
        let rotationSpeed = 0;
        if (isAsteroid) {
          const scale = 0.6 + Math.random() * 0.7;
          sprite.setScale(scale);
          // Random rotation speed: -2 to +2 rad/s (some spin fast, some slow, some reversed)
          rotationSpeed = (Math.random() - 0.5) * 4;
          // Random initial rotation so they don't all start the same
          sprite.setRotation(Math.random() * Math.PI * 2);
        }

        // Add multiplier text below sprite
        const multText = this.add.text(0, 50, `${obj.multiplier}x`, {
          fontSize: '14px',
          color: '#FFD700',
          fontFamily: 'Inter',
          fontStyle: 'bold',
        });
        multText.setOrigin(0.5, 0.5);

        container.add([sprite, multText]);

        // Apply post-processing effects based on object type
        this.applyObjectEffects(container, sprite, obj.objectType, colorHex);

        // Breathing scale-pulse for boss-tier targets
        if (
          obj.objectType === SpaceObjectType.COSMIC_WHALE ||
          obj.objectType === SpaceObjectType.NEBULA_BEAST ||
          obj.objectType === SpaceObjectType.ALIEN_CREATURE
        ) {
          this.tweens.add({
            targets: container,
            scaleX: 1.08,
            scaleY: 1.08,
            duration: 1200,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        }

        const faceHeading = !isAsteroid;
        this.spaceObjectSprites.set(key, { sprite, multText, container, rotationSpeed, prevX: obj.x, prevY: obj.y, faceHeading });
      }

      // Update position with lerp smoothing
      const objContainer = this.spaceObjectSprites.get(key)!;
      const lerpFactor = 0.15 * (deltaMs / 16.66);
      objContainer.container.x += (obj.x - objContainer.container.x) * lerpFactor;
      objContainer.container.y += (obj.y - objContainer.container.y) * lerpFactor;

      // Asteroids: rotate the sprite each frame (tumbling)
      if (objContainer.rotationSpeed) {
        objContainer.sprite.rotation += objContainer.rotationSpeed * (deltaMs / 1000);
      }

      // Non-asteroids: rotate sprite to face direction of travel
      if (objContainer.faceHeading) {
        const dx = obj.x - objContainer.prevX;
        const dy = obj.y - objContainer.prevY;
        // Only update if there's meaningful movement (avoid jitter at rest)
        if (dx * dx + dy * dy > 1) {
          // Sprites face "up" by default, so subtract PI/2 to align with atan2
          objContainer.sprite.rotation = Math.atan2(dy, dx) + Math.PI / 2;
        }
        objContainer.prevX = obj.x;
        objContainer.prevY = obj.y;
      }

      // Update multiplier text
      objContainer.multText.setText(`${obj.multiplier}x`);
    });

    // Cleanup despawned objects
    for (const [key, objContainer] of this.spaceObjectSprites.entries()) {
      if (!activeIds.has(key)) {
        this.tweens.killTweensOf(objContainer.container);
        objContainer.container.destroy();
        this.spaceObjectSprites.delete(key);
      }
    }
  }

  /**
   * Apply post-processing effects to space objects based on their type
   */
  private applyObjectEffects(
    container: Phaser.GameObjects.Container,
    sprite: Phaser.GameObjects.Sprite,
    objectType: string,
    colorHex: number
  ) {
    if (objectType === SpaceObjectType.BLACKHOLE_GEN) {
      sprite.preFX?.addGlow(0x9933ff, 2, 0, false, 0.1, 32);
      const barrel = sprite.preFX?.addBarrel(1);
      if (barrel) {
        this.tweens.add({
          targets: barrel,
          amount: 2.5,
          duration: 2000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } else if (objectType === SpaceObjectType.ORBITAL_CORE) {
      sprite.preFX?.addBloom(0xffffff, 1, 1, 1, 1.2);
    } else if (
      objectType === SpaceObjectType.COSMIC_WHALE ||
      objectType === SpaceObjectType.SPACE_JELLY
    ) {
      sprite.preFX?.addGlow(colorHex, 1, 0, false, 0.1, 32);
    }

    // Optional: Add subtle CRT scanline overlay effect
    sprite.preFX?.addShadow(0, 0, 0.1, 0.5, 0x000000);
  }

  /**
   * Sync player turrets with sprite rendering
   */
  private syncTurrets() {
    const activeIds = new Set<string>();

    this.roomState.players.forEach((player: any, sessionId: string) => {
      activeIds.add(sessionId);

      if (!this.turretSprites.has(sessionId)) {
        const container = this.add.container(player.turretX, player.turretY);
        container.setDepth(30);

        const seatColorStr = SEAT_COLORS[player.seatIndex] || '#ffffff';
        const colorHex = Phaser.Display.Color.HexStringToColor(seatColorStr).color;

        // Turret base sprite — no tint, natural gray color; 2x scale for HD
        const base = this.add.sprite(0, 0, 'turret');
        base.setOrigin(0.5, 0.5);
        base.setScale(2);
        // Player-colored glow on the base lights
        base.preFX?.addGlow(colorHex, 4, 0, false, 0.15, 24);

        // Turret barrel sprite — weapon-specific animated barrel; 4x scale for HD
        const weaponType = player.weaponType || 'standard';
        const barrelKey = `turret_barrel_${weaponType}`;
        const barrel = this.add.sprite(0, 0, barrelKey);
        barrel.setOrigin(0.5, 0.84);
        barrel.setScale(4);
        // Player-colored glow on barrel effects (lights/electricity)
        barrel.preFX?.addGlow(colorHex, 4, 0, false, 0.15, 24);
        barrel.play(`${barrelKey}_idle`);

        container.add([base, barrel]);

        // Local player gets a glow ring underneath
        if (sessionId === this.localSessionId) {
          const glow = this.add.graphics();
          glow.lineStyle(2, colorHex, 0.5);
          glow.strokeCircle(0, 0, 68);
          container.addAt(glow, 0);
        }

        this.turretSprites.set(sessionId, container);
      }

      const container = this.turretSprites.get(sessionId)!;
      const barrel = container.list[container.list.length - 1] as Phaser.GameObjects.Sprite;

      // Swap barrel sprite if weapon type changed
      const expectedBarrelKey = `turret_barrel_${player.weaponType || 'standard'}`;
      if (barrel.texture.key !== expectedBarrelKey) {
        const seatColorStr = SEAT_COLORS[player.seatIndex] || '#ffffff';
        const colorHex = Phaser.Display.Color.HexStringToColor(seatColorStr).color;
        barrel.setTexture(expectedBarrelKey);
        // Refresh glow with player color on new barrel
        barrel.preFX?.clear();
        barrel.preFX?.addGlow(colorHex, 4, 0, false, 0.15, 24);
        barrel.play(`${expectedBarrelKey}_idle`);
      }

      // Rotate barrel to face target angle
      // Barrel art points UP; atan2 gives 0 = right, so offset by +π/2
      barrel.rotation = player.turretAngle + Math.PI / 2;
    });

    // Cleanup disconnected players
    for (const [key, sprite] of this.turretSprites.entries()) {
      if (!activeIds.has(key)) {
        sprite.destroy();
        this.turretSprites.delete(key);
      }
    }
  }

  // ─── VFX Hooks ───

  public applyShake(intensity: number) {
    this.cameras.main.shake(200, intensity * 0.0005);
  }

  public addGhostLaser(
    x: number,
    y: number,
    angle: number,
    bounces: number,
    color: string,
    weaponType: string,
    alpha = 1,
  ) {
    // Ring buffer: overwrite oldest slot at head, O(1)
    this.ghostLaserBuffer[this.ghostLaserHead] = {
      id: this.nextGhostId++,
      x,
      y,
      angle,
      bouncesRemaining: bounces,
      age: 0,
      color,
      weaponType,
      alpha,
      active: true,
    };
    this.ghostLaserHead = (this.ghostLaserHead + 1) % MainScene.MAX_GHOST_LASERS;
    if (this.ghostLaserCount < MainScene.MAX_GHOST_LASERS) this.ghostLaserCount++;
  }

  public addCoinShower(
    killX: number,
    killY: number,
    turretX: number,
    turretY: number,
    seatIndex: number,
    payout: number,
    isLocal: boolean
  ) {
    const color = SEAT_COLORS[seatIndex] ?? '#FFD700';
    const count = Math.min(8 + Math.floor(payout / 10), 30);

    for (let i = 0; i < count; i++) {
      if (this.coinParticles.length >= MainScene.MAX_COIN_PARTICLES) break;
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
        duration: 0.8 + Math.random() * 0.4,
        burstAngle,
        burstDist,
        color,
        payout: Math.floor(payout / count),
        isLocal,
      });
    }
  }

  public addPayoutNotification(
    killX: number,
    killY: number,
    payout: number,
    multiplier: number,
    seatIndex: number,
    objectType: string
  ) {
    const color = SEAT_COLORS[seatIndex] ?? '#FFD700';
    const emoji = '💥'; // Generic explosion emoji for now

    this.payoutNotifications.push({
      x: killX,
      y: killY,
      payout,
      multiplier,
      emoji,
      alpha: 1,
      age: 0,
      color,
    });
  }

  private updateAndRenderVFX(deltaSec: number, deltaMs: number) {
    // 1. Ghost Lasers (ring buffer iteration)
    this.ghostLaserGraphics.clear();
    for (let i = 0; i < MainScene.MAX_GHOST_LASERS; i++) {
      const l = this.ghostLaserBuffer[i];
      if (!l?.active) continue;

      l.age += deltaSec;

      // Move laser
      const speed = 1000;
      l.x += Math.cos(l.angle) * speed * deltaSec;
      l.y += Math.sin(l.angle) * speed * deltaSec;

      // Bounding box bounce
      if (l.x < 0 || l.x > GAME_WIDTH) {
        l.angle = Math.PI - l.angle;
        l.x = Phaser.Math.Clamp(l.x, 0, GAME_WIDTH);
      }
      if (l.y < 0 || l.y > GAME_HEIGHT) {
        l.angle = -l.angle;
        l.y = Phaser.Math.Clamp(l.y, 0, GAME_HEIGHT);
      }

      // Client-side collision check
      let hasHit = false;
      if (this.roomState?.spaceObjects) {
        for (const [, target] of this.roomState.spaceObjects.entries()) {
          const dist = Math.hypot(target.x - l.x, target.y - l.y);
          const radius = OBJECT_RADII.get(target.objectType as SpaceObjectType) ?? 30;
          if (dist < radius + 10) {
            hasHit = true;
            break;
          }
        }
      }

      if (hasHit) {
        // Lightning impacts show a cyan spark at the hit point
        if (l.weaponType === 'lightning') {
          this.fxManager.playImpactSpark(l.x, l.y, '#00CCFF');
        }
        l.active = false;
        this.ghostLaserCount--;
        continue;
      }

      // Draw laser based on weapon type (alpha dims remote player shots)
      const a = l.alpha;
      const colorHex = Phaser.Display.Color.HexStringToColor(l.color).color;
      this.ghostLaserGraphics.beginPath();

      if (l.weaponType === 'lightning') {
        this.ghostLaserGraphics.lineStyle(3, colorHex, a);
        let px = l.x;
        let py = l.y;
        this.ghostLaserGraphics.moveTo(px, py);
        // Draw 3 jagged segments
        for (let j = 0; j < 3; j++) {
          const segOffset = (Math.random() - 0.5) * 20;
          const segAngle = l.angle + Math.PI / 2;
          px -= Math.cos(l.angle) * 15;
          py -= Math.sin(l.angle) * 15;
          this.ghostLaserGraphics.lineTo(
            px + Math.cos(segAngle) * segOffset,
            py + Math.sin(segAngle) * segOffset
          );
        }
      } else if (l.weaponType === 'spread') {
        this.ghostLaserGraphics.lineStyle(8, colorHex, a);
        this.ghostLaserGraphics.moveTo(l.x, l.y);
        this.ghostLaserGraphics.lineTo(l.x - Math.cos(l.angle) * 20, l.y - Math.sin(l.angle) * 20);
      } else {
        // Standard
        this.ghostLaserGraphics.lineStyle(4, colorHex, a);
        this.ghostLaserGraphics.moveTo(l.x, l.y);
        this.ghostLaserGraphics.lineTo(l.x - Math.cos(l.angle) * 40, l.y - Math.sin(l.angle) * 40);
      }
      this.ghostLaserGraphics.strokePath();
    }

    // 2. Coin particles (swap-and-pop for O(1) removal)
    for (let i = this.coinParticles.length - 1; i >= 0; i--) {
      const p = this.coinParticles[i];
      p.age += deltaSec;

      if (p.age >= p.duration) {
        if (p.isLocal && this.onLocalCoinsArrived) {
          this.onLocalCoinsArrived(p.payout);
        }
        // Swap-and-pop: O(1) removal
        this.coinParticles[i] = this.coinParticles.at(-1)!;
        this.coinParticles.pop();
        continue;
      }

      const t = p.age / p.duration;
      // Easing
      const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

      // Burst phase
      const burstX = p.startX + Math.cos(p.burstAngle) * p.burstDist * Math.sin(Math.PI * t);
      const burstY = p.startY + Math.sin(p.burstAngle) * p.burstDist * Math.sin(Math.PI * t);

      p.x = burstX + (p.targetX - burstX) * easeT;
      p.y = burstY + (p.targetY - burstY) * easeT;

      const colorHex = Phaser.Display.Color.HexStringToColor(p.color).color;
      this.ghostLaserGraphics.fillStyle(colorHex, 1);
      this.ghostLaserGraphics.fillCircle(p.x, p.y, 6);
      this.ghostLaserGraphics.lineStyle(1, 0xffffff, 0.8);
      this.ghostLaserGraphics.strokeCircle(p.x, p.y, 6);
    }

    // 3. Payout Notifications
    for (let i = this.payoutNotifications.length - 1; i >= 0; i--) {
      const n = this.payoutNotifications[i];
      n.age += deltaSec;
      n.y -= 50 * deltaSec; // float up

      if (n.age > 2) {
        if (n.textObj) n.textObj.destroy();
        // Swap-and-pop: O(1) removal
        this.payoutNotifications[i] = this.payoutNotifications.at(-1)!;
        this.payoutNotifications.pop();
        continue;
      }

      n.alpha = 1 - n.age / 2;

      if (!n.textObj) {
        n.textObj = this.add
          .text(n.x, n.y, `${n.emoji} +$${n.payout}\n${n.multiplier}x`, {
            fontFamily: 'Inter',
            fontSize: '20px',
            color: n.color,
            align: 'center',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(50);
      }

      n.textObj.setPosition(n.x, n.y);
      n.textObj.setAlpha(n.alpha);
    }
  }
}
