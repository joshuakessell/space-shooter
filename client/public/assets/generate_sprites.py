#!/usr/bin/env python3
"""
Retro Pixel Sci-Fi Space Shooter Sprite Generator
Generates all sprites and animations for the space shooter casino game.
"""

from PIL import Image, ImageDraw
import os
import math
import random

# Color Palette (Retro Pixel Sci-Fi)
COLORS = {
    'background': (0x0a, 0x0a, 0x1a),
    'bg_dark': (0x08, 0x08, 0x18),
    'chrome_light': (0xa8, 0xb8, 0xc8),
    'chrome_bright': (0xc8, 0xd8, 0xe8),
    'chrome_dark': (0x68, 0x78, 0x88),
    'plasma_blue': (0x00, 0xaa, 0xff),
    'plasma_bright': (0x44, 0xcc, 0xff),
    'plasma_dark': (0x00, 0x66, 0xcc),
    'thruster_orange': (0xff, 0x66, 0x00),
    'thruster_light': (0xff, 0x99, 0x00),
    'thruster_dark': (0xff, 0x33, 0x00),
    'neon_pink': (0xff, 0x00, 0x7f),
    'neon_pink_light': (0xff, 0x66, 0xb2),
    'neon_green': (0x00, 0xff, 0x88),
    'neon_green_light': (0x66, 0xff, 0xbb),
    'enemy_purple': (0x66, 0x00, 0xaa),
    'enemy_pink': (0x99, 0x33, 0xff),
    'enemy_dark': (0x44, 0x00, 0x88),
    'gold': (0xFF, 0xD7, 0x00),
    'gold_light': (0xff, 0xc8, 0x00),
    'hull_gray': (0x3a, 0x4a, 0x5a),
    'hull_light': (0x5a, 0x6a, 0x7a),
    'hull_dark': (0x2a, 0x3a, 0x4a),
    'white': (0xff, 0xff, 0xff),
    'black': (0x00, 0x00, 0x00),
}

def create_image(width, height, _bg_color='background'):
    """Create a new image with transparent background."""
    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    return img

def draw_pixel_circle(draw, center, radius, color, outline=None):
    """Draw a pixelated circle."""
    cx, cy = center
    r = radius

    for x in range(cx - r, cx + r + 1):
        for y in range(cy - r, cy + r + 1):
            dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            if dist <= r:
                draw.point((x, y), fill=color)

    if outline:
        for x in range(cx - r, cx + r + 1):
            for y in range(cy - r, cy + r + 1):
                dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
                if r - 1 < dist <= r + 1:
                    draw.point((x, y), fill=outline)

def draw_rect(draw, bbox, color, outline=None, fill=True):
    """Draw a rectangle."""
    if fill:
        draw.rectangle(bbox, fill=color, outline=outline)
    else:
        draw.rectangle(bbox, outline=outline)

def add_scanlines(img, intensity=20):
    """Add scanline effect to image."""
    pixels = img.load()
    width, height = img.size

    for y in range(0, height, 2):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a > 0:
                r = max(0, r - intensity)
                g = max(0, g - intensity)
                b = max(0, b - intensity)
                pixels[x, y] = (r, g, b, a)

def create_asteroid_frame(frame_num, width=72, height=72):
    """Create an asteroid sprite frame with rotation."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    # Rotate angle based on frame
    angle = (frame_num * 60) % 360

    # Draw rocky asteroid shape - irregular polygon
    cx, cy = width // 2, height // 2
    radius = 28

    # Create rocky outline
    points = []
    for i in range(12):
        a = (i * 30 + angle) * math.pi / 180
        # Vary radius for rocky effect
        r = radius + random.randint(-8, 8) if frame_num == 0 else radius
        x = cx + r * math.cos(a)
        y = cy + r * math.sin(a)
        points.append((int(x), int(y)))

    # Draw filled asteroid
    if len(points) >= 3:
        draw.polygon(points, fill=COLORS['hull_gray'], outline=COLORS['hull_dark'])

    # Add rocky detail
    for i in range(3):
        offset = (frame_num * 15) % 10
        detail_x = cx + random.randint(-12, 12) + offset
        detail_y = cy + random.randint(-12, 12)
        draw.polygon([
            (detail_x - 3, detail_y - 3),
            (detail_x + 3, detail_y - 3),
            (detail_x + 3, detail_y + 3),
            (detail_x - 3, detail_y + 3)
        ], fill=COLORS['hull_light'])

    add_scanlines(img, 15)
    return img

def create_rocket_frame(frame_num, width=76, height=76):
    """Create a rocket sprite with thruster animation."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Rocket body
    draw.rectangle([(cx - 8, cy - 18), (cx + 8, cy + 20)], fill=COLORS['hull_gray'], outline=COLORS['hull_dark'])

    # Rocket nose (pointy top)
    draw.polygon([(cx - 6, cy - 18), (cx + 6, cy - 18), (cx, cy - 28)], fill=COLORS['neon_pink'])

    # Windows
    draw.rectangle([(cx - 4, cy - 12), (cx + 4, cy - 6)], fill=COLORS['plasma_bright'])

    # Thruster - animate with frame
    thruster_height = 8 + (frame_num % 4) * 2
    draw.rectangle([(cx - 6, cy + 20), (cx + 6, cy + 20 + thruster_height)],
                   fill=COLORS['thruster_orange'])

    # Thruster glow (2-3 pixels bright)
    glow_height = min(thruster_height + 2, 14)
    draw.rectangle([(cx - 4, cy + 20), (cx + 4, cy + 20 + glow_height // 2)],
                   fill=COLORS['thruster_light'])

    add_scanlines(img, 12)
    return img

def create_alien_craft_frame(frame_num, width=84, height=84):
    """Create UFO/flying saucer sprite."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Main disc body
    draw.ellipse([(cx - 30, cy - 8), (cx + 30, cy + 16)], fill=COLORS['hull_gray'], outline=COLORS['hull_dark'])

    # Dome
    dome_y = cy - 12
    draw.ellipse([(cx - 16, dome_y - 12), (cx + 16, dome_y + 4)], fill=COLORS['plasma_bright'])

    # Pulsing lights on disc - vary with frame
    light_intensity = frame_num % 3
    light_colors = [COLORS['neon_green'], COLORS['neon_pink'], COLORS['plasma_bright']]

    for i in range(5):
        light_x = cx - 20 + i * 10
        color = light_colors[(i + frame_num) % 3]
        draw.ellipse([(light_x - 2, cy + 8), (light_x + 2, cy + 12)], fill=color)

    # Landing legs
    for leg_x in [cx - 20, cx + 20]:
        draw.line([(leg_x, cy + 16), (leg_x, cy + 26)], fill=COLORS['chrome_dark'], width=2)

    add_scanlines(img, 12)
    return img

def create_space_jelly_frame(frame_num, width=96, height=96):
    """Create translucent space jellyfish."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Body (semi-transparent effect via lighter colors)
    draw.ellipse([(cx - 24, cy - 20), (cx + 24, cy + 20)], fill=COLORS['enemy_pink'], outline=COLORS['enemy_dark'])

    # Trailing tentacles - wave animation
    num_tentacles = 6
    for i in range(num_tentacles):
        angle = (i * 360 / num_tentacles) * math.pi / 180
        wave = math.sin((frame_num + i) * math.pi / 3) * 4

        # Tentacle path
        base_x = cx + 20 * math.cos(angle)
        base_y = cy + 20
        end_x = cx + 30 * math.cos(angle) + wave
        end_y = cy + 50 + wave

        draw.line([(int(base_x), int(base_y)), (int(end_x), int(end_y))],
                  fill=COLORS['neon_pink_light'], width=2)

    # Bioluminescent pulse - bright center
    pulse = math.sin(frame_num * math.pi / 3) * 8 + 10
    draw.ellipse([(cx - pulse/2, cy - pulse/2), (cx + pulse/2, cy + pulse/2)],
                 fill=COLORS['plasma_bright'])

    add_scanlines(img, 10)
    return img

def create_alien_creature_frame(frame_num, width=110, height=110):
    """Create pixel alien with big eyes."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Body
    draw.ellipse([(cx - 18, cy - 20), (cx + 18, cy + 25)], fill=COLORS['enemy_purple'], outline=COLORS['enemy_dark'])

    # Big alien eyes - pulsing
    eye_size = 6 + int(math.sin(frame_num * math.pi / 3) * 2)
    draw.ellipse([(cx - 12, cy - 8), (cx - 12 + eye_size * 2, cy - 8 + eye_size * 2)],
                 fill=COLORS['neon_green'])
    draw.ellipse([(cx + 12 - eye_size * 2, cy - 8), (cx + 12, cy - 8 + eye_size * 2)],
                 fill=COLORS['neon_green'])

    # Pupils
    draw.ellipse([(cx - 10, cy - 6), (cx - 8, cy - 4)], fill=COLORS['black'])
    draw.ellipse([(cx + 8, cy - 6), (cx + 10, cy - 4)], fill=COLORS['black'])

    # Antenna - bobbing
    antenna_bob = int(math.sin(frame_num * math.pi / 3) * 3)
    draw.line([(cx - 4, cy - 20), (cx - 4, cy - 28 + antenna_bob)], fill=COLORS['neon_pink'], width=2)
    draw.ellipse([(cx - 6, cy - 28 + antenna_bob), (cx - 2, cy - 24 + antenna_bob)], fill=COLORS['neon_pink'])

    draw.line([(cx + 4, cy - 20), (cx + 4, cy - 28 + antenna_bob)], fill=COLORS['neon_pink'], width=2)
    draw.ellipse([(cx + 2, cy - 28 + antenna_bob), (cx + 6, cy - 24 + antenna_bob)], fill=COLORS['neon_pink'])

    # Mouth
    draw.line([(cx - 6, cy + 8), (cx + 6, cy + 8)], fill=COLORS['neon_pink'], width=1)

    add_scanlines(img, 12)
    return img

def create_meteor_shower_frame(frame_num, width=124, height=124):
    """Create cluster of flaming meteors."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    # Multiple meteors at different positions
    meteor_positions = [
        (30, 20), (70, 30), (50, 70), (85, 65), (20, 80), (75, 15)
    ]

    for i, (mx, my) in enumerate(meteor_positions):
        # Rotate/bob meteors
        bob = int(math.sin((frame_num + i) * math.pi / 3) * 3)
        mx = mx + bob

        # Meteor core
        draw.ellipse([(mx - 8, my - 8), (mx + 8, my + 8)], fill=COLORS['hull_gray'], outline=COLORS['thruster_dark'])

        # Flames
        flame_height = 10 + int(math.sin((frame_num + i) * math.pi / 2) * 3)
        draw.polygon([
            (mx - 6, my + 8),
            (mx + 6, my + 8),
            (mx, my + 8 + flame_height)
        ], fill=COLORS['thruster_orange'])

        # Bright flame center
        draw.polygon([
            (mx - 3, my + 8),
            (mx + 3, my + 8),
            (mx, my + 8 + flame_height // 2)
        ], fill=COLORS['thruster_light'])

    add_scanlines(img, 12)
    return img

def create_nebula_beast_frame(frame_num, width=160, height=160):
    """Create large tentacled space creature."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Main body - cosmic purple
    draw.ellipse([(cx - 35, cy - 35), (cx + 35, cy + 35)], fill=COLORS['enemy_purple'], outline=COLORS['plasma_dark'])

    # Tentacles - wavy animation
    for i in range(8):
        angle = (i * 45) * math.pi / 180
        tentacle_length = 50

        # Base point
        base_x = cx + 35 * math.cos(angle)
        base_y = cy + 35 * math.sin(angle)

        # Wavy movement
        wave = math.sin((frame_num + i) * math.pi / 4) * 8

        # End point
        end_x = cx + tentacle_length * math.cos(angle) + wave
        end_y = cy + tentacle_length * math.sin(angle) + wave

        draw.line([(int(base_x), int(base_y)), (int(end_x), int(end_y))],
                  fill=COLORS['enemy_pink'], width=3)

    # Glowing center
    glow_size = 15 + int(math.sin(frame_num * math.pi / 4) * 5)
    draw.ellipse([(cx - glow_size, cy - glow_size), (cx + glow_size, cy + glow_size)],
                 fill=COLORS['plasma_bright'])

    add_scanlines(img, 14)
    return img

def create_cosmic_whale_frame(frame_num, width=200, height=200):
    """Create majestic space whale."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Body - large ellipse
    draw.ellipse([(cx - 60, cy - 30), (cx + 60, cy + 40)], fill=COLORS['plasma_dark'], outline=COLORS['plasma_bright'])

    # Head - rounded
    draw.ellipse([(cx - 40, cy - 35), (cx - 10, cy + 15)], fill=COLORS['plasma_blue'], outline=COLORS['plasma_bright'])

    # Tail flukes - wavy
    tail_wave = math.sin(frame_num * math.pi / 4) * 10
    draw.polygon([
        (cx + 60, cy - 5),
        (cx + 75, cy - 25 + tail_wave),
        (cx + 70, cy + 35 + tail_wave),
        (cx + 60, cy + 5)
    ], fill=COLORS['plasma_bright'])

    # Dorsal fin
    draw.polygon([
        (cx - 10, cy - 30),
        (cx - 5, cy - 50),
        (cx, cy - 30)
    ], fill=COLORS['neon_green_light'])

    # Eye - bioluminescent
    eye_glow = 4 + int(math.sin(frame_num * math.pi / 3) * 2)
    draw.ellipse([(cx - 25, cy - 10), (cx - 25 + eye_glow * 2, cy - 10 + eye_glow * 2)],
                 fill=COLORS['neon_green'])

    # Bioluminescent spots
    for spot_x in [cx - 20, cx - 5, cx + 10, cx + 35]:
        glow = int(math.sin((frame_num + spot_x) * math.pi / 3) * 3)
        draw.ellipse([(spot_x - 2, cy + 20 - glow), (spot_x + 2, cy + 24 + glow)],
                     fill=COLORS['neon_green_light'])

    add_scanlines(img, 14)
    return img

def create_supernova_bomb_frame(frame_num, width=120, height=120):
    """Create pulsing energy orb."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Pulsing core
    pulse = math.sin(frame_num * math.pi / 3) * 12 + 16
    draw.ellipse([(cx - pulse, cy - pulse), (cx + pulse, cy + pulse)], fill=COLORS['gold'], outline=COLORS['gold_light'])

    # Inner bright core
    inner_pulse = pulse * 0.6
    draw.ellipse([(cx - inner_pulse, cy - inner_pulse), (cx + inner_pulse, cy + inner_pulse)],
                 fill=COLORS['gold_light'])

    # Energy rays - spiky effect
    num_rays = 12
    for i in range(num_rays):
        angle = (i * 360 / num_rays) * math.pi / 180
        ray_length = 20 + int(math.sin((frame_num + i) * math.pi / 3) * 8)

        end_x = cx + ray_length * math.cos(angle)
        end_y = cy + ray_length * math.sin(angle)

        draw.line([(cx, cy), (int(end_x), int(end_y))], fill=COLORS['plasma_bright'], width=2)

    # Outer glow
    glow_radius = pulse + 8
    for r in range(int(glow_radius), int(glow_radius) + 3):
        for angle in range(0, 360, 10):
            a = angle * math.pi / 180
            x = cx + r * math.cos(a)
            y = cy + r * math.sin(a)
            draw.point((int(x), int(y)), fill=COLORS['thruster_orange'])

    add_scanlines(img, 12)
    return img

def create_blackhole_frame(frame_num, width=226, height=226):
    """Create swirling black hole vortex."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Accretion disk - spiral effect
    num_spirals = 6
    for spiral in range(num_spirals):
        for point in range(0, 360, 5):
            angle = (point + frame_num * 3 + spiral * 60) % 360
            angle_rad = angle * math.pi / 180

            # Spiral radius based on angle
            radius = 40 + (angle / 360) * 60

            x = cx + radius * math.cos(angle_rad)
            y = cy + radius * math.sin(angle_rad)

            # Color transitions
            if angle % 120 < 40:
                color = COLORS['thruster_orange']
            elif angle % 120 < 80:
                color = COLORS['neon_pink']
            else:
                color = COLORS['plasma_bright']

            draw.point((int(x), int(y)), fill=color)

    # Black hole center
    draw.ellipse([(cx - 15, cy - 15), (cx + 15, cy + 15)], fill=COLORS['black'])

    # Inner glow before event horizon
    draw.ellipse([(cx - 20, cy - 20), (cx + 20, cy + 20)], outline=COLORS['plasma_bright'], width=2)

    add_scanlines(img, 16)
    return img

def create_quantum_drill_frame(frame_num, width=200, height=200):
    """Create spinning drill projectile."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Main drill body
    draw.ellipse([(cx - 35, cy - 15), (cx + 35, cy + 15)], fill=COLORS['hull_gray'], outline=COLORS['hull_dark'])

    # Spinning tip (drill bit)
    rotation = (frame_num * 60) % 360
    num_flutes = 4
    for i in range(num_flutes):
        angle = (i * 90 + rotation) * math.pi / 180
        flute_x = cx + 35 + 12 * math.cos(angle)
        flute_y = cy + 12 * math.sin(angle)

        draw.line([(cx + 35, cy), (int(flute_x), int(flute_y))], fill=COLORS['thruster_orange'], width=2)

    # Energy trail effect
    for trail in range(3):
        trail_x = cx - 40 - trail * 8
        draw.ellipse([(trail_x - 8, cy - 8), (trail_x + 8, cy + 8)], outline=COLORS['plasma_bright'], width=1)

    # Core glow
    glow_size = 8 + int(math.sin(frame_num * math.pi / 3) * 3)
    draw.ellipse([(cx - glow_size, cy - glow_size), (cx + glow_size, cy + glow_size)],
                 fill=COLORS['plasma_bright'])

    add_scanlines(img, 12)
    return img

def create_emp_relay_frame(frame_num, width=212, height=212):
    """Create satellite dish with crackling electricity."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Satellite dish
    draw.ellipse([(cx - 40, cy - 40), (cx + 40, cy)], fill=COLORS['hull_gray'], outline=COLORS['hull_dark'])

    # Dish reflection highlight
    draw.ellipse([(cx - 30, cy - 30), (cx + 20, cy - 10)], outline=COLORS['chrome_bright'], width=1)

    # Antenna mast
    draw.rectangle([(cx - 4, cy), (cx + 4, cy + 50)], fill=COLORS['hull_light'])

    # Base
    draw.rectangle([(cx - 35, cy + 50), (cx + 35, cy + 55)], fill=COLORS['hull_dark'])

    # Crackling electricity - random sparks
    for spark in range(5):
        spark_angle = (frame_num * 60 + spark * 72) % 360
        spark_rad = spark_angle * math.pi / 180

        spark_x = cx + 45 * math.cos(spark_rad)
        spark_y = cy - 40 + 40 * math.sin(spark_rad)

        # Lightning bolt
        for segment in range(3):
            next_angle = spark_rad + random.uniform(-0.3, 0.3)
            next_x = spark_x + 8 * math.cos(next_angle)
            next_y = spark_y + 8 * math.sin(next_angle)

            draw.line([(int(spark_x), int(spark_y)), (int(next_x), int(next_y))],
                      fill=COLORS['plasma_bright'], width=2)
            spark_x, spark_y = next_x, next_y

    # Pulsing center glow
    glow = 6 + int(math.sin(frame_num * math.pi / 3) * 3)
    draw.ellipse([(cx - glow, cy - glow), (cx + glow, cy + glow)], fill=COLORS['plasma_bright'])

    add_scanlines(img, 14)
    return img

def create_orbital_core_frame(frame_num, width=250, height=250):
    """Create glowing sun-like core with corona."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Outer corona waves
    for corona_layer in range(3):
        corona_size = 70 + corona_layer * 20 + int(math.sin(frame_num * math.pi / 4 + corona_layer) * 10)
        draw.ellipse([(cx - corona_size, cy - corona_size), (cx + corona_size, cy + corona_size)],
                     outline=COLORS['gold_light'], width=2)

    # Main core
    core_size = 50 + int(math.sin(frame_num * math.pi / 3) * 10)
    draw.ellipse([(cx - core_size, cy - core_size), (cx + core_size, cy + core_size)],
                 fill=COLORS['gold'])

    # Bright center
    center_size = core_size * 0.6
    draw.ellipse([(cx - center_size, cy - center_size), (cx + center_size, cy + center_size)],
                 fill=COLORS['gold_light'])

    # Solar flares - spiky protrusions
    num_flares = 8
    for i in range(num_flares):
        angle = (i * 45 + frame_num * 5) * math.pi / 180
        flare_length = 40 + int(math.sin((frame_num + i) * math.pi / 2) * 15)

        end_x = cx + flare_length * math.cos(angle)
        end_y = cy + flare_length * math.sin(angle)

        draw.line([(cx, cy), (int(end_x), int(end_y))], fill=COLORS['thruster_orange'], width=3)

    add_scanlines(img, 16)
    return img

def create_cosmic_vault_frame(frame_num, width=238, height=238):
    """Create ornate golden treasure vault."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Main vault box
    draw.rectangle([(cx - 60, cy - 50), (cx + 60, cy + 60)], fill=COLORS['gold'], outline=COLORS['gold_light'])

    # Decorative corners
    for corner in [(cx - 60, cy - 50), (cx + 60, cy - 50), (cx - 60, cy + 60), (cx + 60, cy + 60)]:
        draw.rectangle([
            (corner[0] - 5, corner[1] - 5),
            (corner[0] + 5, corner[1] + 5)
        ], fill=COLORS['gold_light'])

    # Door panel
    draw.rectangle([(cx - 45, cy - 35), (cx + 45, cy + 45)], fill=COLORS['gold_light'], outline=COLORS['gold'])

    # Central lock/decoration
    lock_glow = 8 + int(math.sin(frame_num * math.pi / 3) * 4)
    draw.ellipse([(cx - lock_glow, cy - lock_glow), (cx + lock_glow, cy + lock_glow)],
                 fill=COLORS['plasma_bright'], outline=COLORS['gold_light'])

    # Runes around the vault - pulsing symbols
    num_runes = 8
    for i in range(num_runes):
        angle = (i * 45) * math.pi / 180
        rune_x = cx - 80 * math.cos(angle)
        rune_y = cy + 80 * math.sin(angle)

        # Pulsing rune glow
        rune_glow = 3 + int(math.sin((frame_num + i * 45 / 45) * math.pi / 3) * 2)
        draw.ellipse([(rune_x - rune_glow, rune_y - rune_glow), (rune_x + rune_glow, rune_y + rune_glow)],
                     fill=COLORS['plasma_bright'])

        # Rune symbol (simple cross)
        draw.line([(rune_x - 2, rune_y), (rune_x + 2, rune_y)], fill=COLORS['gold_light'], width=1)
        draw.line([(rune_x, rune_y - 2), (rune_x, rune_y + 2)], fill=COLORS['gold_light'], width=1)

    # Decorative bands
    draw.rectangle([(cx - 55, cy - 8), (cx + 55, cy + 2)], outline=COLORS['gold_light'], width=2)
    draw.rectangle([(cx - 55, cy + 25), (cx + 55, cy + 35)], outline=COLORS['gold_light'], width=2)

    add_scanlines(img, 15)
    return img

def create_turret_sprite(width=64, height=64):
    """Create simple turret base sprite."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Base ring
    draw.ellipse([(cx - 25, cy - 15), (cx + 25, cy + 25)], fill=COLORS['hull_gray'], outline=COLORS['hull_dark'])

    # Center mount
    draw.ellipse([(cx - 8, cy - 8), (cx + 8, cy + 10)], fill=COLORS['chrome_dark'], outline=COLORS['chrome_bright'])

    # Connection points
    for offset_x in [-12, 12]:
        draw.rectangle([(cx + offset_x - 2, cy + 18), (cx + offset_x + 2, cy + 24)],
                       fill=COLORS['hull_light'])

    add_scanlines(img, 10)
    return img

def create_turret_barrel_sprite(width=48, height=16):
    """Create turret barrel sprite."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    # Barrel
    draw.rectangle([(2, 4), (width - 2, height - 4)], fill=COLORS['hull_gray'], outline=COLORS['hull_dark'])

    # Barrel rifling (detail)
    for x in range(6, width - 2, 6):
        draw.line([(x, 4), (x, height - 4)], fill=COLORS['hull_dark'], width=1)

    # Muzzle ring
    draw.rectangle([(width - 6, 2), (width, height - 2)], fill=COLORS['chrome_dark'])

    return img

def create_laser_standard_frame(frame_num, width=48, height=8):
    """Create standard laser bolt animation."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    # Core laser
    draw.rectangle([(2, 2), (width - 2, height - 2)], fill=COLORS['plasma_bright'])

    # Bright center trail
    brightness = [COLORS['white'], COLORS['plasma_bright'], COLORS['plasma_blue']]
    trail_pos = (frame_num % 3)
    if trail_pos == 0:
        draw.rectangle([(5, 3), (width - 5, height - 3)], fill=brightness[0])
    elif trail_pos == 1:
        draw.rectangle([(8, 3), (width - 5, height - 3)], fill=brightness[1])

    return img

def create_laser_spread_frame(frame_num, width=32, height=12):
    """Create wide spread shot."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    # Spread pattern
    draw.polygon([
        (2, 3),
        (width - 2, 1),
        (width - 2, height - 1),
        (2, height - 3)
    ], fill=COLORS['thruster_orange'], outline=COLORS['thruster_light'])

    # Center glow
    draw.rectangle([(4, 4), (width - 4, height - 4)], fill=COLORS['thruster_light'])

    return img

def create_laser_lightning_frame(frame_num, width=48, height=16):
    """Create lightning bolt projectile."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    # Zigzag lightning pattern
    lightning_points = [
        (2, height // 2),
        (12, 2),
        (24, height - 2),
        (36, 4),
        (width - 2, height // 2)
    ]

    # Jagged effect based on frame
    if frame_num % 2:
        lightning_points = [
            (2, height // 2),
            (12, height - 2),
            (24, 2),
            (36, height - 4),
            (width - 2, height // 2)
        ]

    draw.line(lightning_points, fill=COLORS['neon_green'], width=2)

    # Glow
    draw.line(lightning_points, fill=COLORS['neon_green_light'], width=1)

    return img

def create_explosion_frame(frame_num, width, num_frames):
    """Create explosion animation frame."""
    img = create_image(width, height=width)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, width // 2

    # Expansion rings
    max_radius = width // 2 - 4
    radius = (frame_num / num_frames) * max_radius

    # Outer expanding ring
    draw.ellipse([(cx - radius, cy - radius), (cx + radius, cy + radius)],
                 outline=COLORS['thruster_orange'], width=2)

    # Inner bright ring
    inner_radius = radius * 0.7
    draw.ellipse([(cx - inner_radius, cy - inner_radius), (cx + inner_radius, cy + inner_radius)],
                 outline=COLORS['gold_light'], width=2)

    # Particle effect
    num_particles = 8 + frame_num
    for i in range(num_particles):
        angle = (i * 360 / num_particles) * math.pi / 180
        particle_radius = (radius * 0.5) + (i % 3) * 4

        px = cx + particle_radius * math.cos(angle)
        py = cy + particle_radius * math.sin(angle)

        draw.ellipse([(px - 2, py - 2), (px + 2, py + 2)], fill=COLORS['thruster_light'])

    # Center white-hot core
    core_size = 8
    draw.ellipse([(cx - core_size, cy - core_size), (cx + core_size, cy + core_size)],
                 fill=COLORS['white'])

    return img

def create_coin_frame(frame_num, width=16, height=16):
    """Create spinning gold coin."""
    img = create_image(width, height)
    draw = ImageDraw.Draw(img)

    cx, cy = width // 2, height // 2

    # Coin face - scale based on rotation for 3D effect
    rotation_progress = (frame_num % 6) / 6.0

    if rotation_progress < 0.25:
        # Front view
        coin_width = width - 2
    elif rotation_progress < 0.5:
        # Rotating toward edge
        coin_width = int((width - 2) * (1 - (rotation_progress - 0.25) / 0.25))
    elif rotation_progress < 0.75:
        # Back (should be thin or hidden)
        coin_width = int((width - 2) * ((rotation_progress - 0.5) / 0.25))
    else:
        # Rotating back to front
        coin_width = width - 2

    if coin_width > 1:
        draw.ellipse([(cx - coin_width // 2, cy - 6), (cx + coin_width // 2, cy + 6)],
                     fill=COLORS['gold'], outline=COLORS['gold_light'])

        # Center detail
        if coin_width > 3:
            draw.line([(cx - coin_width // 4, cy), (cx + coin_width // 4, cy)],
                      fill=COLORS['gold_light'], width=1)

    return img

def create_background(width=1920, height=1080):
    """Create full space background with stars and nebula."""
    img = Image.new('RGB', (width, height), COLORS['background'])
    draw = ImageDraw.Draw(img)

    # Random seed for consistency
    random.seed(42)

    # Draw distant stars
    num_stars = 150
    for _ in range(num_stars):
        star_x = random.randint(0, width)
        star_y = random.randint(0, height)
        star_size = random.choice([1, 1, 1, 2])

        draw.ellipse([(star_x - star_size, star_y - star_size),
                     (star_x + star_size, star_y + star_size)],
                    fill=COLORS['white'])

    # Nebula wisps - colorful clouds
    nebula_colors = [COLORS['plasma_dark'], COLORS['enemy_purple'], COLORS['neon_green']]

    for nebula in range(5):
        nebula_x = random.randint(0, width)
        nebula_y = random.randint(0, height)
        nebula_color = random.choice(nebula_colors)

        # Draw semi-transparent nebula cloud with multiple ellipses
        for layer in range(3):
            size = 100 + layer * 80
            alpha_fraction = (3 - layer) / 3.0

            # Create a nebula layer (fake transparency by dithering)
            ellipse_color = tuple(
                int(nebula_color[i] * alpha_fraction + COLORS['background'][i] * (1 - alpha_fraction))
                for i in range(3)
            )

            draw.ellipse([(nebula_x - size, nebula_y - size),
                         (nebula_x + size, nebula_y + size)],
                        fill=ellipse_color, outline=None)

    # Add some distant galaxies (spiral shapes)
    for galaxy in range(3):
        gal_x = random.randint(200, width - 200)
        gal_y = random.randint(200, height - 200)

        for angle in range(0, 360, 30):
            rad = angle * math.pi / 180
            for r in range(10, 50, 10):
                px = gal_x + r * math.cos(rad)
                py = gal_y + r * math.sin(rad)
                draw.ellipse([(px - 1, py - 1), (px + 1, py + 1)], fill=COLORS['white'])

    return img

def generate_spritesheet(_entity_name, frame_func, num_frames, frame_width, frame_height):
    """Generate a complete spritesheet for an entity."""
    spritesheet_width = frame_width * num_frames
    spritesheet = Image.new('RGBA', (spritesheet_width, frame_height), (0, 0, 0, 0))

    for frame in range(num_frames):
        frame_img = frame_func(frame, frame_width, frame_height)
        spritesheet.paste(frame_img, (frame * frame_width, 0), frame_img)

    return spritesheet

def main():
    """Generate all sprites."""
    base_path = '/sessions/blissful-loving-euler/mnt/space-shooter/client/public/assets'
    spritesheets_path = f'{base_path}/spritesheets'
    sprites_path = f'{base_path}/sprites'
    backgrounds_path = f'{base_path}/backgrounds'

    os.makedirs(spritesheets_path, exist_ok=True)
    os.makedirs(sprites_path, exist_ok=True)
    os.makedirs(backgrounds_path, exist_ok=True)

    print("Generating sprite assets...")

    # Define all spritesheets
    spritesheets = [
        ('asteroid', create_asteroid_frame, 6, 72, 72),
        ('rocket', create_rocket_frame, 6, 76, 76),
        ('alien_craft', create_alien_craft_frame, 6, 84, 84),
        ('space_jelly', create_space_jelly_frame, 6, 96, 96),
        ('alien_creature', create_alien_creature_frame, 6, 110, 110),
        ('meteor_shower', create_meteor_shower_frame, 6, 124, 124),
        ('nebula_beast', create_nebula_beast_frame, 8, 160, 160),
        ('cosmic_whale', create_cosmic_whale_frame, 8, 200, 200),
        ('supernova_bomb', create_supernova_bomb_frame, 6, 120, 120),
        ('blackhole_gen', create_blackhole_frame, 8, 226, 226),
        ('quantum_drill', create_quantum_drill_frame, 6, 200, 200),
        ('emp_relay', create_emp_relay_frame, 6, 212, 212),
        ('orbital_core', create_orbital_core_frame, 8, 250, 250),
        ('cosmic_vault', create_cosmic_vault_frame, 8, 238, 238),
    ]

    # Generate spritesheets
    for entity_name, frame_func, num_frames, frame_width, frame_height in spritesheets:
        print(f"  Generating {entity_name}...", end=' ')
        spritesheet = generate_spritesheet(entity_name, frame_func, num_frames, frame_width, frame_height)
        spritesheet.save(f'{spritesheets_path}/{entity_name}.png')
        print(f"✓ ({num_frames} frames, {spritesheet.size[0]}x{spritesheet.size[1]})")

    # Explosion animations (special handling)
    explosions = [
        ('explosion_small', 64, 8),
        ('explosion_medium', 128, 8),
        ('explosion_boss', 256, 10),
    ]

    for explosion_name, size, frames in explosions:
        print(f"  Generating {explosion_name}...", end=' ')
        explosion_sheet = Image.new('RGBA', (size * frames, size), (0, 0, 0, 0))
        for frame in range(frames):
            frame_img = create_explosion_frame(frame, size, frames)
            explosion_sheet.paste(frame_img, (frame * size, 0), frame_img)
        explosion_sheet.save(f'{spritesheets_path}/{explosion_name}.png')
        print(f"✓ ({frames} frames, {explosion_sheet.size[0]}x{explosion_sheet.size[1]})")

    # Laser animations
    lasers = [
        ('laser_standard', create_laser_standard_frame, 4, 48, 8),
        ('laser_spread', create_laser_spread_frame, 4, 32, 12),
        ('laser_lightning', create_laser_lightning_frame, 4, 48, 16),
    ]

    for laser_name, laser_func, num_frames, w, h in lasers:
        print(f"  Generating {laser_name}...", end=' ')
        laser_sheet = generate_spritesheet(laser_name, laser_func, num_frames, w, h)
        laser_sheet.save(f'{spritesheets_path}/{laser_name}.png')
        print(f"✓ ({num_frames} frames, {laser_sheet.size[0]}x{laser_sheet.size[1]})")

    # Coin animation
    print("  Generating coin...", end=' ')
    coin_sheet = generate_spritesheet('coin', create_coin_frame, 6, 16, 16)
    coin_sheet.save(f'{spritesheets_path}/coin.png')
    print(f"✓ (6 frames, {coin_sheet.size[0]}x{coin_sheet.size[1]})")

    # Single-frame sprites
    single_sprites = [
        ('turret', create_turret_sprite, 64, 64),
    ]

    for sprite_name, sprite_func, w, h in single_sprites:
        print(f"  Generating {sprite_name}...", end=' ')
        sprite_img = sprite_func(w, h)
        sprite_img.save(f'{sprites_path}/{sprite_name}.png')
        print(f"✓ ({sprite_img.size[0]}x{sprite_img.size[1]})")

    # Turret barrel (special size)
    print("  Generating turret_barrel...", end=' ')
    barrel_img = create_turret_barrel_sprite(48, 16)
    barrel_img.save(f'{sprites_path}/turret_barrel.png')
    print(f"✓ ({barrel_img.size[0]}x{barrel_img.size[1]})")

    # Background
    print("  Generating background...", end=' ')
    bg_img = create_background(1920, 1080)
    bg_img.save(f'{backgrounds_path}/background.png')
    print(f"✓ ({bg_img.size[0]}x{bg_img.size[1]})")

    print("\nAll sprites generated successfully!")

    # Print summary
    print("\nGenerated files:")
    print(f"  Spritesheets: {spritesheets_path}/")
    print(f"  Single sprites: {sprites_path}/")
    print(f"  Backgrounds: {backgrounds_path}/")

if __name__ == '__main__':
    main()
