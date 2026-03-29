import * as Phaser from 'phaser';
import { SpaceObjectType } from '@space-shooter/shared';

/**
 * BootScene: Preloads all game assets and creates animation definitions
 * Shows a loading bar and transitions to MainScene when complete
 */
export class BootScene extends Phaser.Scene {
  private progressBar!: Phaser.GameObjects.Graphics;
  private progressBox!: Phaser.GameObjects.Graphics;

  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    console.log('[BootScene] Starting asset preload...');

    // Create loading bar UI
    this.createLoadingBar();

    // ───────────────────────────────────────────────────────
    // Preload Spritesheets (Entity animations)
    // ───────────────────────────────────────────────────────
    const spritesheetFrames = {
      'asteroid': { frameWidth: 64, frameHeight: 64, frames: 16 },
      'rocket': { frameWidth: 76, frameHeight: 76, frames: 16 },
      'alien_craft': { frameWidth: 84, frameHeight: 84, frames: 16 },
      'space_jelly': { frameWidth: 96, frameHeight: 96, frames: 20 },
      'alien_creature': { frameWidth: 110, frameHeight: 110, frames: 20 },
      'meteor_shower': { frameWidth: 124, frameHeight: 124, frames: 20 },
      'nebula_beast': { frameWidth: 160, frameHeight: 160, frames: 24 },
      'cosmic_whale': { frameWidth: 200, frameHeight: 200, frames: 24 },
      'supernova_bomb': { frameWidth: 120, frameHeight: 120, frames: 6 },
      'blackhole_gen': { frameWidth: 226, frameHeight: 226, frames: 8 },
      'quantum_drill': { frameWidth: 200, frameHeight: 200, frames: 6 },
      'emp_relay': { frameWidth: 212, frameHeight: 212, frames: 6 },
      'orbital_core': { frameWidth: 250, frameHeight: 250, frames: 8 },
      'cosmic_vault': { frameWidth: 238, frameHeight: 238, frames: 8 },
    };

    // Load entity spritesheets
    for (const [key, config] of Object.entries(spritesheetFrames)) {
      this.load.spritesheet(key, `/assets/spritesheets/${key}.png`, {
        frameWidth: config.frameWidth,
        frameHeight: config.frameHeight,
      });
    }

    // ───────────────────────────────────────────────────────
    // Preload Explosion Spritesheets
    // ───────────────────────────────────────────────────────
    const explosions = {
      'explosion_small': { frameWidth: 64, frameHeight: 64 },
      'explosion_medium': { frameWidth: 128, frameHeight: 128 },
      'explosion_boss': { frameWidth: 256, frameHeight: 256 },
    };

    for (const [key, config] of Object.entries(explosions)) {
      this.load.spritesheet(key, `/assets/spritesheets/${key}.png`, config);
    }

    // ───────────────────────────────────────────────────────
    // Preload Laser Spritesheets
    // ───────────────────────────────────────────────────────
    const lasers = {
      'laser_standard': { frameWidth: 48, frameHeight: 8 },
      'laser_spread': { frameWidth: 32, frameHeight: 12 },
      'laser_lightning': { frameWidth: 48, frameHeight: 16 },
    };

    for (const [key, config] of Object.entries(lasers)) {
      this.load.spritesheet(key, `/assets/spritesheets/${key}.png`, config);
    }

    // ───────────────────────────────────────────────────────
    // Preload Coin Spritesheet
    // ───────────────────────────────────────────────────────
    this.load.spritesheet('coin', '/assets/spritesheets/coin.png', {
      frameWidth: 16,
      frameHeight: 16,
    });

    // ───────────────────────────────────────────────────────
    // Preload Single-frame Sprites (Turrets)
    // ───────────────────────────────────────────────────────
    this.load.image('turret', '/assets/sprites/turret.png');
    this.load.image('turret_barrel', '/assets/sprites/turret_barrel.png');

    // ───────────────────────────────────────────────────────
    // Preload Background
    // ───────────────────────────────────────────────────────
    this.load.image('background', '/assets/backgrounds/background.png');

    // ───────────────────────────────────────────────────────
    // Progress event tracking
    // ───────────────────────────────────────────────────────
    this.load.on('progress', (value: number) => {
      this.updateProgressBar(value);
    });

    this.load.on('complete', () => {
      console.log('[BootScene] All assets loaded');
      this.createAnimations();
    });
  }

  private createLoadingBar() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Loading box background
    this.progressBox = this.make.graphics({ x: 0, y: 0 }, false);
    this.progressBox.fillStyle(0x222222, 0.8);
    this.progressBox.fillRect(width / 4, height / 2 - 25, width / 2, 50);

    // Progress bar
    this.progressBar = this.make.graphics({ x: 0, y: 0 }, false);
  }

  private updateProgressBar(value: number) {
    this.progressBar.clear();
    this.progressBar.fillStyle(0x00ff88, 1);
    this.progressBar.fillRect(
      this.cameras.main.width / 4 + 5,
      this.cameras.main.height / 2 - 20,
      (this.cameras.main.width / 2 - 10) * value,
      40
    );
  }

  private createAnimations() {
    console.log('[BootScene] Creating animations...');

    // ───────────────────────────────────────────────────────
    // Entity Idle Animations
    // ───────────────────────────────────────────────────────
    const entityTypes = [
      SpaceObjectType.ASTEROID,
      SpaceObjectType.ROCKET,
      SpaceObjectType.ALIEN_CRAFT,
      SpaceObjectType.SPACE_JELLY,
      SpaceObjectType.ALIEN_CREATURE,
      SpaceObjectType.METEOR_SHOWER,
      SpaceObjectType.NEBULA_BEAST,
      SpaceObjectType.COSMIC_WHALE,
      SpaceObjectType.SUPERNOVA_BOMB,
      SpaceObjectType.BLACKHOLE_GEN,
      SpaceObjectType.QUANTUM_DRILL,
      SpaceObjectType.EMP_RELAY,
      SpaceObjectType.ORBITAL_CORE,
      SpaceObjectType.COSMIC_VAULT,
    ];

    // Map object types to spritesheet keys
    const spriteKeyMap: Record<string, string> = {
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

    // Frame counts for each entity type
    const frameCountMap: Record<string, number> = {
      'asteroid': 16,
      'rocket': 16,
      'alien_craft': 16,
      'space_jelly': 20,
      'alien_creature': 20,
      'meteor_shower': 20,
      'nebula_beast': 24,
      'cosmic_whale': 24,
      'supernova_bomb': 6,
      'blackhole_gen': 8,
      'quantum_drill': 6,
      'emp_relay': 6,
      'orbital_core': 8,
      'cosmic_vault': 8,
    };

    // Create idle animations for each entity type
    for (const objectType of entityTypes) {
      const spriteKey = spriteKeyMap[objectType];
      const frameCount = frameCountMap[spriteKey];

      this.anims.create({
        key: `${spriteKey}_idle`,
        frames: this.anims.generateFrameNumbers(spriteKey, {
          start: 0,
          end: frameCount - 1,
        }),
        frameRate: 8,
        repeat: -1,
      });
    }

    // ───────────────────────────────────────────────────────
    // Explosion Animations
    // ───────────────────────────────────────────────────────
    this.anims.create({
      key: 'explosion_small_burst',
      frames: this.anims.generateFrameNumbers('explosion_small', {
        start: 0,
        end: 15,
      }),
      frameRate: 12,
      repeat: 0,
    });

    this.anims.create({
      key: 'explosion_medium_burst',
      frames: this.anims.generateFrameNumbers('explosion_medium', {
        start: 0,
        end: 15,
      }),
      frameRate: 12,
      repeat: 0,
    });

    this.anims.create({
      key: 'explosion_boss_burst',
      frames: this.anims.generateFrameNumbers('explosion_boss', {
        start: 0,
        end: 19,
      }),
      frameRate: 12,
      repeat: 0,
    });

    // ───────────────────────────────────────────────────────
    // Laser Animations
    // ───────────────────────────────────────────────────────
    this.anims.create({
      key: 'laser_standard_fire',
      frames: this.anims.generateFrameNumbers('laser_standard', {
        start: 0,
        end: 7,
      }),
      frameRate: 10,
      repeat: 0,
    });

    this.anims.create({
      key: 'laser_spread_fire',
      frames: this.anims.generateFrameNumbers('laser_spread', {
        start: 0,
        end: 7,
      }),
      frameRate: 10,
      repeat: 0,
    });

    this.anims.create({
      key: 'laser_lightning_fire',
      frames: this.anims.generateFrameNumbers('laser_lightning', {
        start: 0,
        end: 7,
      }),
      frameRate: 12,
      repeat: 0,
    });

    // ───────────────────────────────────────────────────────
    // Coin Spin Animation
    // ───────────────────────────────────────────────────────
    this.anims.create({
      key: 'coin_spin',
      frames: this.anims.generateFrameNumbers('coin', {
        start: 0,
        end: 5,
      }),
      frameRate: 12,
      repeat: -1,
    });

    console.log('[BootScene] Animations created, transitioning to MainScene');
    this.scene.start('MainScene');
  }
}
