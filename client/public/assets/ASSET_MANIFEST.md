# Space Shooter Pixel Art Asset Manifest

## Generation Date
March 26, 2026

## Asset Directory Structure

```
public/assets/
├── spritesheets/      (Animated entity sprites, 6-8 frames each)
├── sprites/           (Single-frame sprites like turrets)
├── backgrounds/       (Full scene backgrounds)
└── generate_sprites.py (Generation script)
```

## Generated Assets Summary

### Enemy/Entity Spritesheets (22 files)
All spritesheets use retro 16-bit pixel art with CRT scanline effects.

| Entity | Frames | Dimensions | File Size |
|--------|--------|-----------|-----------|
| asteroid | 6 | 432×72 | 2.2K |
| rocket | 6 | 456×76 | 1.4K |
| alien_craft | 6 | 504×84 | 1.8K |
| space_jelly | 6 | 576×96 | 3.3K |
| alien_creature | 6 | 660×110 | 2.1K |
| meteor_shower | 6 | 744×124 | 4.3K |
| nebula_beast | 8 | 1280×160 | 7.3K |
| cosmic_whale | 8 | 1600×200 | 7.1K |
| supernova_bomb | 6 | 720×120 | 5.4K |
| blackhole_gen | 8 | 1808×226 | 4.9K |
| quantum_drill | 6 | 1200×200 | 3.3K |
| emp_relay | 6 | 1272×212 | 6.2K |
| orbital_core | 8 | 2000×250 | 36K |
| cosmic_vault | 8 | 1904×238 | 9.0K |
| explosion_small | 8 | 512×64 | 2.8K |
| explosion_medium | 8 | 1024×128 | 5.6K |
| explosion_boss | 10 | 2560×256 | 15K |
| laser_standard | 4 | 192×8 | 149B |
| laser_spread | 4 | 128×12 | 197B |
| laser_lightning | 4 | 192×16 | 384B |
| coin | 6 | 96×16 | 286B |

### Player/UI Sprites (2 files)
| Sprite | Dimensions | File Size |
|--------|-----------|-----------|
| turret | 64×64 | 674B |
| turret_barrel | 48×16 | 151B |

### Backgrounds (1 file)
| Background | Dimensions | File Size |
|-----------|-----------|-----------|
| background | 1920×1080 | 17K |

## Color Palette Used
- **Background**: Deep space navy (#0a0a1a, #080818)
- **Chrome/Metal**: Silvery grays (#a8b8c8, #c8d8e8, #687888)
- **Plasma Blue**: Electric blues (#00aaff, #44ccff, #0066cc)
- **Thruster Orange**: Hot orange (#ff6600, #ff9900, #ff3300)
- **Neon Pink**: Bright magenta (#ff007f, #ff66b2)
- **Neon Green**: Lime green (#00ff88, #66ffbb)
- **Enemy Purple**: Deep violet (#6600aa, #9933ff, #440088)
- **Gold**: Treasure gold (#FFD700, #ffc800)
- **Hull Gray**: Ship grays (#3a4a5a, #5a6a7a, #2a3a4a)

## Animation Styles

### Entity Animations
- **Asteroid**: Rotating geometry with rocky detail
- **Rocket**: Thruster flame animation on vertical axis
- **Alien Craft**: Pulsing navigation lights
- **Space Jelly**: Wave-motion tentacles with bioluminescent pulse
- **Alien Creature**: Bobbing antenna with pulsing eyes
- **Meteor Shower**: Flame animation on multiple meteors
- **Nebula Beast**: Wavy tentacle motion with pulsing glow
- **Cosmic Whale**: Tail flukes and bioluminescent spots
- **Supernova Bomb**: Expanding energy rays with pulsing core
- **Black Hole**: Rotating accretion disk with spiral effect
- **Quantum Drill**: Rotating drill bit with energy trails
- **EMP Relay**: Crackling electricity and center glow
- **Orbital Core**: Corona pulse waves and solar flares
- **Cosmic Vault**: Pulsing rune decorations

### Effect Animations
- **Explosions**: Expanding rings with particle burst (3 sizes)
- **Lasers**: Projectile trails with color variations (3 types)
- **Coin**: 3D spinning rotation effect

### Backgrounds
- Deep space with 150 distant stars
- 5 nebula cloud layers with color variation
- 3 distant spiral galaxies

## Technical Details

### Generation Method
All assets generated with Python 3 using Pillow (PIL) library:
- Pixel-perfect shapes using ImageDraw
- Custom dithering for gradient effects
- CRT scanline simulation on all sprites
- No external image dependencies

### Features
- All sprites have RGBA transparency
- Scanline effects add retro CRT aesthetics
- Specular highlights on round objects
- Proper animation frame sequencing
- Optimized PNG compression

## Asset Paths in Project

```
/mnt/space-shooter/client/public/assets/
├── spritesheets/asteroid.png
├── spritesheets/cosmic_whale.png
├── ... (20 more spritesheets)
├── spritesheets/laser_standard.png
├── sprites/turret.png
├── sprites/turret_barrel.png
└── backgrounds/background.png
```

## Usage Integration

For game code, reference assets like:
```
Image: /assets/spritesheets/asteroid.png
Animation: Frames 0-5 (6 frames, 72px height, 72px per frame width)

Image: /assets/sprites/turret.png
Single sprite: 64×64 (no animation)

Image: /assets/backgrounds/background.png
Full background: 1920×1080
```

## Notes

- All sprites are game-ready for WebGL or Canvas rendering
- Spritesheet format: Horizontal strip with frames left-to-right
- Frame indices start at 0
- Alpha transparency preserved for proper layering
- Color palette maintained across all assets for visual cohesion
