// ─────────────────────────────────────────────────────────────
// FXManager — Overhauled Visual Effects System
// Sprite-based explosions + enhanced particle effects with dramatic sequences
// ─────────────────────────────────────────────────────────────

import * as Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '@space-shooter/shared';

/**
 * Manages WebGL particle effects, sprite animations, and post-processing.
 * Overhauled with sprite-based explosions and dramatic multi-stage sequences.
 */
export class FXManager {
  private scene!: Phaser.Scene;

  // Pre-configured emitters
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private explosionEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smokeEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private trailEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private vortexEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
      // Defer initialization until the scene is ready
  }

  public init(scene: Phaser.Scene) {
      this.scene = scene;

      // Ensure we have a shared particle texture (white circle)
      if (!this.scene.textures.exists('particle_circle')) {
          const g = this.scene.make.graphics();
          g.fillStyle(0xffffff, 1);
          g.fillCircle(8, 8, 8);
          g.generateTexture('particle_circle', 16, 16);
          g.destroy();
      }

      this.createEmitters();
  }

  private createEmitters() {
      // 1. Impact Sparks (Fast, short life, additive blending)
      this.sparkEmitter = this.scene.add.particles(0, 0, 'particle_circle', {
          emitting: false,
          lifespan: { min: 50, max: 150 },
          speed: { min: 100, max: 300 },
          scale: { start: 0.3, end: 0 },
          blendMode: Phaser.BlendModes.ADD,
      });
      this.sparkEmitter.setDepth(40);

      // 2. Explosions (Radiating, fading)
      this.explosionEmitter = this.scene.add.particles(0, 0, 'particle_circle', {
          emitting: false,
          lifespan: { min: 300, max: 800 },
          speed: { min: 50, max: 200 },
          scale: { start: 0.8, end: 0 },
          alpha: { start: 1, end: 0 },
          blendMode: Phaser.BlendModes.ADD,
          gravityY: 30, // slight drop
      });
      this.explosionEmitter.setDepth(35);

      // 3. Smoke (Rising, darkening)
      this.smokeEmitter = this.scene.add.particles(0, 0, 'particle_circle', {
          emitting: false,
          lifespan: { min: 500, max: 1200 },
          speed: { min: 20, max: 80 },
          scale: { start: 0.5, end: 1.5 },
          alpha: { start: 0.3, end: 0 },
          tint: 0x888888,
          gravityY: -20, // rising
      });
      this.smokeEmitter.setDepth(34);

      // 4. Engine Trails (Continuous small puffs)
      this.trailEmitter = this.scene.add.particles(0, 0, 'particle_circle', {
          emitting: false,
          lifespan: { min: 200, max: 400 },
          speed: { min: 10, max: 30 },
          scale: { start: 0.2, end: 0 },
          alpha: { start: 0.6, end: 0 },
          blendMode: Phaser.BlendModes.ADD,
      });
      this.trailEmitter.setDepth(15);

      // 5. Vortex particles (for blackhole effect)
      this.vortexEmitter = this.scene.add.particles(0, 0, 'particle_circle', {
          emitting: false,
          lifespan: { min: 800, max: 1200 },
          speed: { min: 50, max: 150 },
          scale: { start: 0.6, end: 0.1 },
          alpha: { start: 0.8, end: 0 },
          blendMode: Phaser.BlendModes.ADD,
      });
      this.vortexEmitter.setDepth(36);
  }

  // ─── Public FX Methods ───

  /**
   * Engine trail — continuous small glow behind a space object.
   */
  emitTrail(x: number, y: number, colorStr: string): void {
      if (!this.scene) return;
      const colorHex = Phaser.Display.Color.HexStringToColor(colorStr).color;

      this.trailEmitter.setParticleTint(colorHex);
      this.trailEmitter.emitParticleAt(x, y, 1);
  }

  /**
   * Impact sparks — quick burst at hit position.
   */
  playImpactSpark(x: number, y: number, colorStr = '#FFD700'): void {
      if (!this.scene) return;
      const colorHex = Phaser.Display.Color.HexStringToColor(colorStr).color;

      this.sparkEmitter.setParticleTint(colorHex);
      this.sparkEmitter.explode(8, x, y);
  }

  /**
   * Explosion — fire/smoke burst scaled by multiplier.
   * Enhanced with sprite animation overlay.
   */
  playExplosion(x: number, y: number, multiplier: number, colorStr = '#FF6347'): void {
      if (!this.scene) return;
      const colorHex = Phaser.Display.Color.HexStringToColor(colorStr).color;
      const count = Math.min(8 + Math.floor(multiplier * 1.5), 50);

      this.explosionEmitter.setParticleTint(colorHex);
      this.explosionEmitter.setParticleSpeed(80 + multiplier * 5, 200 + multiplier * 10);
      this.explosionEmitter.explode(count, x, y);

      const smokeCount = Math.min(Math.floor(count / 2), 15);
      this.smokeEmitter.explode(smokeCount, x, y);

      // Play explosion sprite animation
      this.playExplosionSprite(x, y, 'explosion_small');
  }

  /**
   * Boss Kill — multi-stage death sequence for multiplier ≥ 25.
   * Stage 1: White flash overlay
   * Stage 2: Expanding shockwave ring with bloom
   * Stage 3: Boss explosion sprite animation + massive particle burst
   * Stage 4: Lingering colored smoke + secondary sparks
   * Camera shake handled internally
   */
  playBossKill(x: number, y: number, multiplier: number, colorStr = '#FFD700'): void {
      if (!this.scene) return;
      const colorHex = Phaser.Display.Color.HexStringToColor(colorStr).color;

      // Stage 1: White flash overlay (full screen brief flash)
      const whiteFlash = this.scene.add.graphics();
      whiteFlash.setDepth(48);
      whiteFlash.fillStyle(0xffffff, 0.8);
      whiteFlash.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      this.scene.tweens.add({
          targets: whiteFlash,
          alpha: 0,
          duration: 200,
          ease: 'Quad.easeOut',
          onComplete: () => whiteFlash.destroy()
      });

      // Stage 2: Expanding shockwave ring with bloom
      const ring = this.scene.add.graphics();
      ring.setDepth(45);
      ring.lineStyle(8, 0xffffff, 1);
      ring.strokeCircle(0, 0, 15);
      ring.setPosition(x, y);
      ring.preFX?.addBloom(0xffffff, 2, 2, 1, 2);

      this.scene.tweens.add({
          targets: ring,
          scaleX: 10,
          scaleY: 10,
          alpha: 0,
          duration: 700,
          ease: 'Cubic.easeOut',
          onComplete: () => ring.destroy()
      });

      // Stage 3: Boss explosion sprite animation + massive particle burst
      this.playExplosionSprite(x, y, 'explosion_boss');

      const burstCount = Math.min(60 + Math.floor(multiplier * 0.8), 90);
      this.explosionEmitter.setParticleTint(colorHex);
      this.explosionEmitter.setParticleSpeed(150, 450);
      this.explosionEmitter.explode(burstCount, x, y);

      // Secondary white sparks with more intensity
      this.sparkEmitter.setParticleTint(0xffffff);
      this.sparkEmitter.explode(30, x, y);

      // Stage 4: Lingering colored smoke + secondary sparks
      const smokeCount = 20;
      this.smokeEmitter.explode(smokeCount, x, y);

      // Additional lingering secondary sparks after a delay
      this.scene.time.delayedCall(150, () => {
          this.sparkEmitter.setParticleTint(colorHex);
          this.sparkEmitter.explode(15, x, y);
      });

      // Camera shake
      this.scene.cameras.main.shake(600, 0.025 + multiplier * 0.0005);
  }

  /**
   * Elite Kill — medium-tier death for multiplier 8-24.
   * Expanding glow pulse + medium explosion sprite + moderate particle burst
   */
  playEliteKill(x: number, y: number, multiplier: number, colorStr = '#DA70D6'): void {
      if (!this.scene) return;
      const colorHex = Phaser.Display.Color.HexStringToColor(colorStr).color;

      // Color flash
      const flash = this.scene.add.graphics();
      flash.setDepth(44);
      flash.fillStyle(colorHex, 0.5);
      flash.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      this.scene.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 150,
          ease: 'Quad.easeOut',
          onComplete: () => flash.destroy()
      });

      // Expanding glow pulse
      const glow = this.scene.add.graphics();
      glow.setDepth(42);
      glow.fillStyle(colorHex, 0.5);
      glow.fillCircle(x, y, 50);
      glow.preFX?.addBloom(colorHex, 1.5, 1, 1, 1.4);

      this.scene.tweens.add({
          targets: glow,
          scaleX: 4,
          scaleY: 4,
          alpha: 0,
          duration: 550,
          ease: 'Cubic.easeOut',
          onComplete: () => glow.destroy()
      });

      // Medium explosion sprite
      this.playExplosionSprite(x, y, 'explosion_medium');

      // Moderate particle burst (30+ particles)
      const burstCount = Math.min(30 + Math.floor(multiplier * 0.8), 50);
      this.explosionEmitter.setParticleTint(colorHex);
      this.explosionEmitter.setParticleSpeed(120, 320);
      this.explosionEmitter.explode(burstCount, x, y);

      // Sparks
      this.sparkEmitter.setParticleTint(0xffd700);
      this.sparkEmitter.explode(15, x, y);

      // Smoke
      this.smokeEmitter.explode(10, x, y);

      // Camera shake
      this.scene.cameras.main.shake(400, 0.012);
  }

  /**
   * Supernova blast — massive expanding shockwave ring.
   */
  playSupernovaBlast(x: number, y: number): void {
      if (!this.scene) return;

      // Outer ring
      this.explosionEmitter.setParticleTint(0x00ffff);
      this.explosionEmitter.setParticleSpeed(400, 600);
      this.explosionEmitter.explode(40, x, y);

      // Inner burst
      this.explosionEmitter.setParticleTint(0xffd700);
      this.explosionEmitter.setParticleSpeed(100, 250);
      this.explosionEmitter.explode(20, x, y);

      // Play explosion sprite
      this.playExplosionSprite(x, y, 'explosion_medium');
  }

  // ─── Feature Target FX ───

  /**
   * Blackhole vortex — camera barrel distortion + spinning particle vortex
   */
  playBlackholeVortex(x: number, y: number): void {
      if (!this.scene) return;

      // Camera barrel distortion tween
      const barrel = this.scene.cameras.main.postFX.addBarrel(1.2);

      this.scene.tweens.add({
          targets: barrel,
          amount: 2.8,
          duration: 1800,
          yoyo: true,
          ease: 'Sine.easeInOut',
          onComplete: () => this.scene.cameras.main.postFX.remove(barrel)
      });

      // Spinning particle vortex (particles orbit inward)
      const particleCount = 40;
      for (let i = 0; i < particleCount; i++) {
          const angle = (i / particleCount) * Math.PI * 2;
          const radius = 120 + Math.random() * 40;
          const px = x + Math.cos(angle) * radius;
          const py = y + Math.sin(angle) * radius;

          // Create particles that spiral inward toward center
          const vortexParticle = this.scene.add.particles(px, py, 'particle_circle', {
              emitting: false,
              speed: { min: 100, max: 180 },
              lifespan: { min: 1000, max: 1600 },
              scale: { start: 0.5, end: 0 },
              alpha: { start: 0.9, end: 0 },
              blendMode: Phaser.BlendModes.ADD,
          });
          vortexParticle.setDepth(36);
          vortexParticle.setParticleTint(0x9933ff);
          vortexParticle.emitParticleAt(px, py, 1);
      }

      // Purple/dark glow pulse
      const glow = this.scene.add.graphics();
      glow.setDepth(37);
      glow.fillStyle(0x9933ff, 0.3);
      glow.fillCircle(x, y, 60);
      glow.preFX?.addBloom(0x9933ff, 1.5, 1, 1, 1.3);

      this.scene.tweens.add({
          targets: glow,
          scaleX: 3,
          scaleY: 3,
          alpha: 0,
          duration: 1800,
          ease: 'Sine.easeInOut',
          onComplete: () => glow.destroy()
      });
  }

  /**
   * Vault roulette — golden particle explosion + spinning coin sprites + celebratory sparkles
   */
  playVaultRoulette(x: number, y: number): void {
      if (!this.scene) return;

      // Golden particle explosion
      this.explosionEmitter.setParticleTint(0xffd700);
      this.explosionEmitter.setParticleSpeed(100, 250);
      this.explosionEmitter.explode(60, x, y);

      // Spinning coin sprites erupting outward
      const coinCount = 12;
      for (let i = 0; i < coinCount; i++) {
          const angle = (i / coinCount) * Math.PI * 2;
          const vx = Math.cos(angle) * 250;
          const vy = Math.sin(angle) * 250;

          // Create coin sprite with physics
          const coin = this.scene.physics.add.sprite(x, y, 'coin');
          coin.setDepth(38);
          coin.play('coin_spin');
          coin.setVelocity(vx, vy);
          coin.setGravityY(300);

          // Fade and slow down over time
          this.scene.tweens.add({
              targets: coin,
              alpha: 0,
              duration: 1200,
              ease: 'Quad.easeOut',
              onComplete: () => coin.destroy()
          });
      }

      // Celebratory sparkle effects
      const sparkCount = 30;
      this.sparkEmitter.setParticleTint(0xffd700);
      this.sparkEmitter.explode(sparkCount, x, y);

      // Additional sparkles with delay
      this.scene.time.delayedCall(200, () => {
          this.sparkEmitter.setParticleTint(0xffff00);
          this.sparkEmitter.explode(20, x, y);
      });
  }

  playDrillTrail(x: number, y: number, angle: number): void {
      if (!this.scene) return;
      this.trailEmitter.setParticleTint(0xff3300);
      this.trailEmitter.explode(5, x, y);
  }

  /**
   * Chain lightning arc — fractal bolt between two points with impact sparks.
   * Used for lightning weapon chain hits. Lighter than playEmpChain (no screen flash).
   */
  playChainLightning(fromX: number, fromY: number, toX: number, toY: number): void {
      if (!this.scene) return;

      const graphics = this.scene.add.graphics();
      graphics.setDepth(50);
      graphics.lineStyle(2, 0x00ffff, 0.8);
      graphics.blendMode = Phaser.BlendModes.ADD;

      const drawBolt = (x1: number, y1: number, x2: number, y2: number, depth: number) => {
          if (depth === 0) {
              graphics.lineTo(x2, y2);
              return;
          }
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const offset = (Math.random() - 0.5) * 40 * (depth / 3);
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const px = midX + Math.cos(angle + Math.PI / 2) * offset;
          const py = midY + Math.sin(angle + Math.PI / 2) * offset;
          drawBolt(x1, y1, px, py, depth - 1);
          drawBolt(px, py, x2, y2, depth - 1);
      };

      graphics.beginPath();
      graphics.moveTo(fromX, fromY);
      drawBolt(fromX, fromY, toX, toY, 3);
      graphics.strokePath();

      this.scene.tweens.add({
          targets: graphics,
          alpha: 0,
          duration: 250,
          onComplete: () => graphics.destroy()
      });

      // Spark at destination
      this.sparkEmitter.setParticleTint(0x00ccff);
      this.sparkEmitter.explode(8, toX, toY);
  }

  /**
   * EMP chain — fractal lightning bolt + impact sparks + brief blue screen flash
   * Used for EMP feature activation (more dramatic than chain lightning).
   */
  playEmpChain(fromX: number, fromY: number, toX: number, toY: number): void {
      if (!this.scene) return;

      // Brief blue screen flash
      const flash = this.scene.add.graphics();
      flash.setDepth(49);
      flash.fillStyle(0x0099ff, 0.4);
      flash.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      this.scene.tweens.add({
          targets: flash,
          alpha: 0,
          duration: 200,
          ease: 'Quad.easeOut',
          onComplete: () => flash.destroy()
      });

      // Fractal lightning bolt graphics (more dramatic)
      const graphics = this.scene.add.graphics();
      graphics.setDepth(50);
      graphics.lineStyle(4, 0x00ffff, 1);
      graphics.blendMode = Phaser.BlendModes.ADD;
      graphics.preFX?.addBloom(0x00ffff, 1.5, 1, 1, 1.3);

      const drawFractalLightning = (x1: number, y1: number, x2: number, y2: number, generations: number) => {
          if (generations === 0) {
              graphics.lineTo(x2, y2);
              return;
          }
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const offset = (Math.random() - 0.5) * 80 * (generations / 3);
          const angle = Math.atan2(y2 - y1, x2 - x1);

          const px = midX + Math.cos(angle + Math.PI/2) * offset;
          const py = midY + Math.sin(angle + Math.PI/2) * offset;

          drawFractalLightning(x1, y1, px, py, generations - 1);
          drawFractalLightning(px, py, x2, y2, generations - 1);
      };

      graphics.beginPath();
      graphics.moveTo(fromX, fromY);
      drawFractalLightning(fromX, fromY, toX, toY, 4);
      graphics.strokePath();

      this.scene.tweens.add({
          targets: graphics,
          alpha: 0,
          duration: 350,
          onComplete: () => graphics.destroy()
      });

      // Impact sparks at destination (more intense)
      this.sparkEmitter.setParticleTint(0x00ccff);
      this.sparkEmitter.explode(20, toX, toY);
  }

  /**
   * Orbital laser — full-height beam with bloom + screen-wide particle shower + camera shake
   */
  playOrbitalLaser(x: number, y: number): void {
      if (!this.scene) return;

      // Camera shake
      this.scene.cameras.main.shake(900, 0.03);

      // Full-height beam with bloom and jitter
      const graphics = this.scene.add.graphics();
      graphics.setDepth(15);
      graphics.preFX?.addBloom(0xffaa00, 2.5, 1, 1, 1.8);

      const beamWidth = 1200;

      const jitterTween = this.scene.tweens.add({
          targets: graphics,
          alpha: { from: 1, to: 0.5 },
          duration: 30,
          yoyo: true,
          repeat: -1
      });

      // Screen-wide particle shower along beam path
      const particleCount = 50;
      for (let i = 0; i < particleCount; i++) {
          const py = Math.random() * GAME_HEIGHT;
          this.explosionEmitter.setParticleTint(0xffaa00);
          this.explosionEmitter.setParticleSpeed(50, 150);
          this.explosionEmitter.emitParticleAt(x, py, 1);
      }

      this.scene.tweens.add({
          targets: graphics,
          scaleX: { from: 1, to: 0 },
          duration: 1200,
          ease: 'Cubic.easeOut',
          onUpdate: () => {
              graphics.clear();
              // Outer yellow core
              graphics.fillStyle(0xffaa00, 0.7);
              graphics.fillRect(x - beamWidth / 2, 0, beamWidth, GAME_HEIGHT);
              // Inner white core
              graphics.fillStyle(0xffffff, 1.0);
              graphics.fillRect(x - beamWidth / 4, 0, beamWidth / 2, GAME_HEIGHT);
          },
          onComplete: () => {
              jitterTween.stop();
              graphics.destroy();
          }
      });
  }

  // ─── Helper Methods ───

  /**
   * Play an explosion sprite animation at the given position
   */
  private playExplosionSprite(x: number, y: number, explosionType: 'explosion_small' | 'explosion_medium' | 'explosion_boss'): void {
      if (!this.scene) return;

      const animKey = `${explosionType}_burst`;

      // Determine sprite size based on type
      let scale = 1;
      if (explosionType === 'explosion_small') scale = 1;
      else if (explosionType === 'explosion_medium') scale = 1.5;
      else if (explosionType === 'explosion_boss') scale = 2;

      const sprite = this.scene.add.sprite(x, y, explosionType);
      sprite.setDepth(43);
      sprite.setScale(scale);

      // Check if animation exists before playing
      if (this.scene.anims.exists(animKey)) {
          sprite.play(animKey);

          // Destroy sprite when animation completes
          sprite.once('animationcomplete', () => {
              sprite.destroy();
          });
      } else {
          // Fallback: destroy immediately if animation doesn't exist
          sprite.destroy();
      }
  }
}
