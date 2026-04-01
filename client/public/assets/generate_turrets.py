#!/usr/bin/env python3
"""
Generate HD turret sprites matching the concept art reference.
- Turret base: 128x128 circular metallic base with cyan accent lights
- Standard barrel: 96x96 frames (8), single cannon with red muzzle tip
- Spread barrel: 96x96 frames (8), triple cannon with green tips
- Lightning barrel: 96x96 frames (8), tesla coil with purple arcs

All barrels are oriented pointing UP (Phaser adds π/2 rotation offset).
Metal parts are neutral gray; only the neon accents carry color.
"""

from PIL import Image, ImageDraw, ImageFilter
import math
import random
import os

random.seed(42)

# ─── Color Palette ───
STEEL_DARK   = (55, 60, 70)
STEEL_MID    = (90, 100, 110)
STEEL_LIGHT  = (130, 140, 150)
STEEL_SHINE  = (170, 180, 190)
RIVET        = (45, 50, 55)
BOLT_CENTER  = (35, 40, 45)

# Neon accent colors (these are what the preFX glow highlights)
CYAN_GLOW    = (0, 220, 255)
CYAN_DIM     = (0, 140, 180)
RED_GLOW     = (255, 60, 40)
RED_DIM      = (180, 30, 20)
GREEN_GLOW   = (60, 255, 100)
GREEN_DIM    = (30, 180, 60)
PURPLE_GLOW  = (180, 60, 255)
PURPLE_DIM   = (120, 30, 180)
COPPER       = (180, 120, 60)
COPPER_DARK  = (130, 80, 40)


def draw_circle(draw, cx, cy, r, fill=None, outline=None, width=1):
    """Helper to draw a circle from center + radius."""
    draw.ellipse(
        [(cx - r, cy - r), (cx + r, cy + r)],
        fill=fill, outline=outline, width=width
    )


def draw_rivets(draw, cx, cy, radius, count, rivet_r=2):
    """Draw rivets arranged in a circle."""
    for i in range(count):
        angle = 2 * math.pi * i / count
        rx = cx + radius * math.cos(angle)
        ry = cy + radius * math.sin(angle)
        draw_circle(draw, rx, ry, rivet_r, fill=RIVET)
        # Tiny highlight
        draw_circle(draw, rx - 0.5, ry - 0.5, rivet_r * 0.4, fill=STEEL_LIGHT)


def draw_barrel_body(draw, cx, top_y, bottom_y, width, vent_count=3):
    """Draw a metallic barrel body with vents."""
    half = width // 2

    # Main barrel body
    draw.rectangle(
        [(cx - half, top_y), (cx + half, bottom_y)],
        fill=STEEL_MID
    )

    # Left edge highlight
    draw.rectangle(
        [(cx - half, top_y), (cx - half + 2, bottom_y)],
        fill=STEEL_LIGHT
    )

    # Right edge shadow
    draw.rectangle(
        [(cx + half - 2, top_y), (cx + half, bottom_y)],
        fill=STEEL_DARK
    )

    # Vents
    barrel_len = bottom_y - top_y
    for i in range(vent_count):
        vy = top_y + int(barrel_len * (0.3 + 0.15 * i))
        draw.rectangle(
            [(cx - half + 4, vy), (cx + half - 4, vy + 2)],
            fill=BOLT_CENTER
        )
        draw.rectangle(
            [(cx - half + 4, vy + 3), (cx + half - 4, vy + 4)],
            fill=STEEL_SHINE
        )

    # Muzzle ring at top
    draw.rectangle(
        [(cx - half - 1, top_y), (cx + half + 1, top_y + 3)],
        fill=STEEL_LIGHT
    )
    draw.rectangle(
        [(cx - half - 1, top_y + 3), (cx + half + 1, top_y + 5)],
        fill=STEEL_DARK
    )


def draw_mount_circle(draw, cx, cy, radius):
    """Draw the circular mount that sits on the base."""
    # Outer ring
    draw_circle(draw, cx, cy, radius, fill=STEEL_MID)
    draw_circle(draw, cx, cy, radius - 3, fill=STEEL_DARK)

    # Inner ring detail
    draw_circle(draw, cx, cy, radius - 6, fill=STEEL_MID)
    draw_circle(draw, cx, cy, radius - 9, fill=STEEL_DARK)

    # Center bolt
    draw_circle(draw, cx, cy, 5, fill=BOLT_CENTER)
    draw_circle(draw, cx, cy, 3, fill=STEEL_MID)

    # Rivets on mount
    draw_rivets(draw, cx, cy, radius - 4, 8, rivet_r=1.5)


# ══════════════════════════════════════════════════════════
#  TURRET BASE (128x128)
# ══════════════════════════════════════════════════════════

def generate_turret_base():
    """Generate the circular turret base at 128x128."""
    size = 128
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx, cy = size // 2, size // 2

    # ── Outer armored ring ──
    draw_circle(draw, cx, cy, 60, fill=STEEL_DARK)
    draw_circle(draw, cx, cy, 57, fill=STEEL_MID)

    # Panel segments (4 armored plates with gaps)
    for i in range(4):
        angle_start = i * 90 + 10
        angle_end = (i + 1) * 90 - 10
        draw.pieslice(
            [(cx - 56, cy - 56), (cx + 56, cy + 56)],
            start=angle_start, end=angle_end,
            fill=STEEL_MID, outline=STEEL_DARK
        )
    # Re-draw inner area to clean up pie artifacts
    draw_circle(draw, cx, cy, 42, fill=STEEL_DARK)

    # Outer rivets
    draw_rivets(draw, cx, cy, 50, 12, rivet_r=2)

    # ── Cyan accent lights in the gaps between panels ──
    for i in range(4):
        angle = math.radians(i * 90 + 45)
        for offset in [-8, 0, 8]:
            a = angle + math.radians(offset)
            lx = cx + 49 * math.cos(a)
            ly = cy + 49 * math.sin(a)
            draw_circle(draw, lx, ly, 3, fill=CYAN_GLOW)
            draw_circle(draw, lx, ly, 1.5, fill=(200, 255, 255))

    # ── Middle ring ──
    draw_circle(draw, cx, cy, 40, fill=STEEL_MID, outline=STEEL_DARK, width=2)
    draw_circle(draw, cx, cy, 34, fill=STEEL_DARK)

    # Cross-brace details
    for angle_deg in [0, 90, 180, 270]:
        a = math.radians(angle_deg)
        x1 = cx + 34 * math.cos(a)
        y1 = cy + 34 * math.sin(a)
        x2 = cx + 42 * math.cos(a)
        y2 = cy + 42 * math.sin(a)
        draw.line([(x1, y1), (x2, y2)], fill=STEEL_LIGHT, width=3)

    # ── Inner mechanical ring ──
    draw_circle(draw, cx, cy, 32, fill=STEEL_MID)
    draw_circle(draw, cx, cy, 28, fill=STEEL_DARK)

    # Inner rivets
    draw_rivets(draw, cx, cy, 30, 8, rivet_r=1.5)

    # ── Center hub ──
    draw_circle(draw, cx, cy, 20, fill=STEEL_MID)
    draw_circle(draw, cx, cy, 16, fill=STEEL_DARK)
    draw_circle(draw, cx, cy, 10, fill=STEEL_MID)
    draw_circle(draw, cx, cy, 6, fill=BOLT_CENTER)
    draw_circle(draw, cx, cy, 3, fill=STEEL_LIGHT)

    # Subtle top-left specular highlight
    for r in range(60, 20, -5):
        alpha = int(15 * (60 - r) / 40)
        highlight = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        hd = ImageDraw.Draw(highlight)
        hx, hy = cx - r * 0.3, cy - r * 0.3
        draw_circle(hd, hx, hy, r * 0.4, fill=(255, 255, 255, alpha))
        img = Image.alpha_composite(img, highlight)

    return img


# ══════════════════════════════════════════════════════════
#  STANDARD BARREL — single cannon, red muzzle tip
# ══════════════════════════════════════════════════════════

def generate_standard_barrel(frame_num, w=96, h=96):
    """Generate one frame of the standard single-barrel cannon."""
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = w // 2
    mount_cy = int(h * 0.84)  # Pivot/origin point

    # ── Barrel body ──
    barrel_width = 14
    barrel_top = 8
    barrel_bottom = mount_cy - 16

    draw_barrel_body(draw, cx, barrel_top, barrel_bottom, barrel_width, vent_count=3)

    # Housing/breach between barrel and mount
    draw.rectangle(
        [(cx - 12, barrel_bottom), (cx + 12, mount_cy - 8)],
        fill=STEEL_MID
    )
    draw.rectangle(
        [(cx - 14, barrel_bottom + 2), (cx + 14, barrel_bottom + 6)],
        fill=STEEL_LIGHT
    )

    # ── Muzzle tip with red glow ──
    pulse = 0.7 + 0.3 * math.sin(frame_num * math.pi / 4)
    r_glow = (
        int(RED_GLOW[0] * pulse),
        int(RED_GLOW[1] * pulse),
        int(RED_GLOW[2] * pulse),
    )

    # Red accent strip near muzzle
    draw.rectangle(
        [(cx - 6, barrel_top + 6), (cx + 6, barrel_top + 10)],
        fill=r_glow
    )
    # Muzzle tip glow
    draw_circle(draw, cx, barrel_top + 2, 4, fill=r_glow)
    draw_circle(draw, cx, barrel_top + 2, 2, fill=(255, 200, 180, int(255 * pulse)))

    # ── Circular mount ──
    draw_mount_circle(draw, cx, mount_cy, 18)

    return img


# ══════════════════════════════════════════════════════════
#  SPREAD BARREL — triple cannon, green tips
# ══════════════════════════════════════════════════════════

def generate_spread_barrel(frame_num, w=96, h=96):
    """Generate one frame of the spread triple-barrel cannon."""
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = w // 2
    mount_cy = int(h * 0.84)

    # Three barrel positions (slight fan spread)
    barrel_offsets = [-14, 0, 14]
    barrel_top_offsets = [14, 8, 14]  # Center barrel extends further
    barrel_width = 10

    # ── Housing/breach block ──
    draw.rectangle(
        [(cx - 22, mount_cy - 28), (cx + 22, mount_cy - 8)],
        fill=STEEL_MID
    )
    # Top lip
    draw.rectangle(
        [(cx - 24, mount_cy - 30), (cx + 24, mount_cy - 26)],
        fill=STEEL_LIGHT
    )

    # Mechanical detail on housing
    draw.rectangle(
        [(cx - 18, mount_cy - 22), (cx + 18, mount_cy - 18)],
        fill=STEEL_DARK
    )

    # ── Draw each barrel ──
    pulse_phase = frame_num * math.pi / 4
    for i, (offset, top_off) in enumerate(zip(barrel_offsets, barrel_top_offsets)):
        bx = cx + offset
        barrel_top = top_off
        barrel_bottom = mount_cy - 28

        draw_barrel_body(draw, bx, barrel_top, barrel_bottom, barrel_width, vent_count=2)

        # Green glowing tip — each pulses with slight offset
        pulse = 0.6 + 0.4 * math.sin(pulse_phase + i * math.pi * 2 / 3)
        g_glow = (
            int(GREEN_GLOW[0] * pulse),
            int(GREEN_GLOW[1] * pulse),
            int(GREEN_GLOW[2] * pulse),
        )
        draw_circle(draw, bx, barrel_top + 2, 4, fill=g_glow)
        draw_circle(draw, bx, barrel_top + 2, 2, fill=(200, 255, 220, int(255 * pulse)))

    # ── Circular mount ──
    draw_mount_circle(draw, cx, mount_cy, 18)

    return img


# ══════════════════════════════════════════════════════════
#  LIGHTNING BARREL — tesla coil, purple arcs
# ══════════════════════════════════════════════════════════

def generate_lightning_barrel(frame_num, w=96, h=96):
    """Generate one frame of the lightning tesla-coil cannon."""
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = w // 2
    mount_cy = int(h * 0.84)

    # ── Main barrel body ──
    barrel_width = 16
    barrel_top = 10
    barrel_bottom = mount_cy - 16

    draw_barrel_body(draw, cx, barrel_top, barrel_bottom, barrel_width, vent_count=2)

    # ── Copper coils wrapped around barrel ──
    coil_start = barrel_top + 20
    coil_end = barrel_bottom - 5
    coil_count = 5
    for i in range(coil_count):
        coil_y = coil_start + (coil_end - coil_start) * i / (coil_count - 1)
        draw.arc(
            [(cx - 12, coil_y - 3), (cx + 12, coil_y + 3)],
            start=0, end=360,
            fill=COPPER, width=2
        )
        # Highlight on coil
        draw.arc(
            [(cx - 10, coil_y - 2), (cx + 2, coil_y + 1)],
            start=180, end=360,
            fill=COPPER_DARK, width=1
        )

    # ── Purple crystal nodes on sides ──
    pulse = 0.5 + 0.5 * math.sin(frame_num * math.pi / 4)
    p_glow = (
        int(PURPLE_GLOW[0] * pulse + PURPLE_DIM[0] * (1 - pulse)),
        int(PURPLE_GLOW[1] * pulse + PURPLE_DIM[1] * (1 - pulse)),
        int(PURPLE_GLOW[2] * pulse + PURPLE_DIM[2] * (1 - pulse)),
    )

    # Side crystals
    for side in [-1, 1]:
        nx = cx + side * 14
        ny = barrel_top + 30
        # Crystal shape (small diamond)
        points = [
            (nx, ny - 5),
            (nx + side * 4, ny),
            (nx, ny + 5),
            (nx - side * 2, ny),
        ]
        draw.polygon(points, fill=p_glow)

    # ── Emitter tip with purple electricity ──
    # Emitter prongs
    draw.rectangle([(cx - 4, barrel_top - 4), (cx + 4, barrel_top + 4)], fill=STEEL_LIGHT)
    draw.rectangle([(cx - 8, barrel_top), (cx + 8, barrel_top + 3)], fill=STEEL_MID)

    # Purple energy at tip
    tip_glow = (
        int(PURPLE_GLOW[0] * (0.6 + 0.4 * pulse)),
        int(PURPLE_GLOW[1] * (0.6 + 0.4 * pulse)),
        int(PURPLE_GLOW[2] * (0.6 + 0.4 * pulse)),
    )
    draw_circle(draw, cx, barrel_top - 2, 5, fill=tip_glow)
    draw_circle(draw, cx, barrel_top - 2, 2, fill=(230, 200, 255, int(255 * pulse)))

    # Lightning arcs from tip (randomized per frame)
    rng = random.Random(frame_num * 7 + 13)
    for _ in range(3):
        arc_angle = rng.uniform(-math.pi / 3, math.pi / 3) - math.pi / 2
        arc_len = rng.randint(8, 18)
        points = [(cx, barrel_top - 4)]
        px, py = cx, barrel_top - 4
        for seg in range(3):
            px += arc_len / 3 * math.cos(arc_angle) + rng.randint(-3, 3)
            py += arc_len / 3 * math.sin(arc_angle) + rng.randint(-3, 3)
            points.append((px, py))
        draw.line(points, fill=tip_glow, width=1)

    # Housing
    draw.rectangle(
        [(cx - 14, barrel_bottom), (cx + 14, mount_cy - 8)],
        fill=STEEL_MID
    )
    draw.rectangle(
        [(cx - 16, barrel_bottom + 2), (cx + 16, barrel_bottom + 6)],
        fill=STEEL_LIGHT
    )

    # ── Circular mount ──
    draw_mount_circle(draw, cx, mount_cy, 18)

    return img


# ══════════════════════════════════════════════════════════
#  Spritesheet Builder
# ══════════════════════════════════════════════════════════

def build_spritesheet(frame_func, num_frames, fw, fh):
    """Build a horizontal spritesheet from frame generator."""
    sheet = Image.new('RGBA', (fw * num_frames, fh), (0, 0, 0, 0))
    for i in range(num_frames):
        frame = frame_func(i, fw, fh)
        sheet.paste(frame, (i * fw, 0), frame)
    return sheet


# ══════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════

def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    sprites_dir = os.path.join(base_dir, 'sprites')
    sheets_dir = os.path.join(base_dir, 'spritesheets')

    os.makedirs(sprites_dir, exist_ok=True)
    os.makedirs(sheets_dir, exist_ok=True)

    # ── Turret base ──
    print("Generating turret base (128x128)...", end=' ')
    base = generate_turret_base()
    base.save(os.path.join(sprites_dir, 'turret.png'))
    print(f"✓ ({base.size[0]}x{base.size[1]})")

    # ── Barrel spritesheets ──
    barrels = [
        ('turret_barrel_standard', generate_standard_barrel),
        ('turret_barrel_spread', generate_spread_barrel),
        ('turret_barrel_lightning', generate_lightning_barrel),
    ]

    for name, func in barrels:
        print(f"Generating {name} (8 frames @ 96x96)...", end=' ')
        sheet = build_spritesheet(func, 8, 96, 96)
        sheet.save(os.path.join(sheets_dir, f'{name}.png'))
        print(f"✓ ({sheet.size[0]}x{sheet.size[1]})")

    print("\nAll turret sprites generated!")


if __name__ == '__main__':
    main()
