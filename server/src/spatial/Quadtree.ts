// ─────────────────────────────────────────────────────────────
// Quadtree — Spatial Partitioning for O(log n) Collision Queries
// Engine-agnostic. No Phaser/Colyseus imports.
// ─────────────────────────────────────────────────────────────

import { QUADTREE_MAX_OBJECTS, QUADTREE_MAX_LEVELS } from '@space-shooter/shared';
import type { EntityId } from '@space-shooter/shared';

/** Axis-Aligned Bounding Box */
export interface AABB {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An entry in the quadtree: an entity with its bounding box */
export interface QuadtreeEntry {
  readonly entityId: EntityId;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/**
 * Quadtree for efficient broad-phase collision detection.
 * Rebuilt every tick (cheap for our entity counts).
 */
export class Quadtree {
  private readonly entries: QuadtreeEntry[] = [];
  private readonly nodes: Quadtree[] = [];
  private readonly level: number;
  private readonly bounds: AABB;
  private readonly maxObjects: number;
  private readonly maxLevels: number;

  constructor(bounds: AABB, level = 0, maxObjects = QUADTREE_MAX_OBJECTS, maxLevels = QUADTREE_MAX_LEVELS) {
    this.bounds = bounds;
    this.level = level;
    this.maxObjects = maxObjects;
    this.maxLevels = maxLevels;
  }

  /** Clear the tree for reuse */
  clear(): void {
    this.entries.length = 0;
    for (const node of this.nodes) {
      node.clear();
    }
    this.nodes.length = 0;
  }

  /** Insert an entity into the quadtree */
  insert(entry: QuadtreeEntry): void {
    // If subdivided, try to fit into a child
    if (this.nodes.length > 0) {
      const index = this.getIndex(entry);
      if (index !== -1) {
        this.nodes[index].insert(entry);
        return;
      }
    }

    this.entries.push(entry);

    // Subdivide if over capacity and not at max depth
    if (this.entries.length > this.maxObjects && this.level < this.maxLevels) {
      if (this.nodes.length === 0) {
        this.subdivide();
      }

      // Re-insert existing entries into children
      let i = 0;
      while (i < this.entries.length) {
        const idx = this.getIndex(this.entries[i]);
        if (idx !== -1) {
          const [removed] = this.entries.splice(i, 1);
          this.nodes[idx].insert(removed);
        } else {
          i++;
        }
      }
    }
  }

  /** Query all entries that could potentially collide with the given entry */
  query(entry: QuadtreeEntry, results: QuadtreeEntry[] = []): QuadtreeEntry[] {
    const index = this.getIndex(entry);

    if (this.nodes.length > 0) {
      if (index !== -1) {
        this.nodes[index].query(entry, results);
      } else {
        // Entry spans multiple quadrants — check all children
        for (const node of this.nodes) {
          node.query(entry, results);
        }
      }
    }

    // Add entries at this level
    for (const e of this.entries) {
      results.push(e);
    }

    return results;
  }

  /** Determine which quadrant an entry belongs to (-1 = straddles boundary) */
  private getIndex(entry: QuadtreeEntry): number {
    const midX = this.bounds.x + this.bounds.width / 2;
    const midY = this.bounds.y + this.bounds.height / 2;

    const left = entry.x - entry.radius;
    const right = entry.x + entry.radius;
    const top = entry.y - entry.radius;
    const bottom = entry.y + entry.radius;

    const fitsTop = top >= this.bounds.y && bottom <= midY;
    const fitsBottom = top >= midY && bottom <= this.bounds.y + this.bounds.height;
    const fitsLeft = left >= this.bounds.x && right <= midX;
    const fitsRight = left >= midX && right <= this.bounds.x + this.bounds.width;

    if (fitsTop && fitsRight) return 0;
    if (fitsTop && fitsLeft) return 1;
    if (fitsBottom && fitsLeft) return 2;
    if (fitsBottom && fitsRight) return 3;

    return -1; // straddles boundary
  }

  /** Subdivide into 4 quadrants */
  private subdivide(): void {
    const halfW = this.bounds.width / 2;
    const halfH = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;
    const next = this.level + 1;

    this.nodes.push(
      new Quadtree({ x: x + halfW, y, width: halfW, height: halfH }, next, this.maxObjects, this.maxLevels),  // NE
      new Quadtree({ x, y, width: halfW, height: halfH }, next, this.maxObjects, this.maxLevels),              // NW
      new Quadtree({ x, y: y + halfH, width: halfW, height: halfH }, next, this.maxObjects, this.maxLevels),  // SW
      new Quadtree({ x: x + halfW, y: y + halfH, width: halfW, height: halfH }, next, this.maxObjects, this.maxLevels), // SE
    );
  }
}
