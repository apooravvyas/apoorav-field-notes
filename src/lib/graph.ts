import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from 'd3-force';
import { select, type Selection } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { drag } from 'd3-drag';
import type { GraphEdge, GraphNode, LensGraph } from '../types';

type SVGSel = Selection<SVGSVGElement, unknown, null, undefined>;
type GSel = Selection<SVGGElement, unknown, null, undefined>;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface GraphCallbacks {
  /** Canvas areas covered by overlays (legend, banner); fit() keeps circles clear of them. */
  getInsets?: () => Insets;
  onSelect: (id: string, origin: 'pointer' | 'keyboard') => void;
  onBackgroundClick: () => void;
}

const LABEL_GAP = 16; // label baseline below the circle
const COUNT_GAP = 30; // "n posts" baseline below the circle
const postCountLabel = (count: number, sample: boolean) =>
  sample ? `${count} sample ${count === 1 ? 'post' : 'posts'}` : `${count} ${count === 1 ? 'post' : 'posts'}`;

/** Small deterministic PRNG so the same data always produces the same layout. */
function lcg(seed = 42) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296);
}

const endId = (e: string | GraphNode) => (typeof e === 'string' ? e : e.id);

export class ContentGraph {
  private svg: SVGSel;
  private viewport: GSel;
  private edgeLayer: GSel;
  private nodeLayer: GSel;
  private zoomBehavior: ZoomBehavior<SVGSVGElement, unknown>;
  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private sample = false;
  private nodeById = new Map<string, GraphNode>();
  private neighbors = new Map<string, Set<string>>();
  private selected: string | null = null;
  private related: Set<string> | null = null;
  private hovered: string | null = null;
  private resizeObserver: ResizeObserver;
  private lastSize = { w: 0, h: 0 };
  private userMoved = false;
  private suppressClickUntil = 0;

  constructor(
    private container: HTMLElement,
    private callbacks: GraphCallbacks,
  ) {
    this.svg = select(container)
      .append('svg')
      .attr('class', 'graph-svg')
      .attr('role', 'group')
      .attr('aria-label', 'Tag graph. Use Tab to move between circles and Enter to open one.') as SVGSel;

    this.viewport = this.svg.append('g').attr('class', 'viewport') as GSel;
    this.edgeLayer = this.viewport.append('g').attr('class', 'edges').attr('aria-hidden', 'true') as GSel;
    this.nodeLayer = this.viewport.append('g').attr('class', 'nodes') as GSel;

    this.zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3.5])
      .on('zoom', (event) => {
        this.viewport.attr('transform', event.transform.toString());
        if (event.sourceEvent) this.userMoved = true;
      });
    this.svg.call(this.zoomBehavior).on('dblclick.zoom', null);

    this.svg.on('click', (event: MouseEvent) => {
      if (event.target === this.svg.node()) this.callbacks.onBackgroundClick();
    });

    this.resizeObserver = new ResizeObserver(() => {
      const { width, height } = this.container.getBoundingClientRect();
      if (Math.abs(width - this.lastSize.w) < 2 && Math.abs(height - this.lastSize.h) < 2) return;
      this.lastSize = { w: width, h: height };
      if (!this.userMoved) this.fit(false);
    });
    this.resizeObserver.observe(container);
  }

  /** Replace the graph (on first load or lens change). Layout is computed once, synchronously, and stays put. */
  setData(graph: LensGraph, sample = false) {
    this.sample = sample;
    this.svg.attr(
      'aria-label',
      `${sample ? 'Sample ' : ''}tag graph. Use Tab to move between circles and Enter to open one.`,
    );
    this.nodes = graph.nodes.map((n) => ({ ...n }));
    this.edges = graph.edges.map((e) => ({ ...e }));
    this.nodeById = new Map(this.nodes.map((n) => [n.id, n]));
    this.neighbors = new Map(this.nodes.map((n) => [n.id, new Set<string>()]));
    for (const e of this.edges) {
      this.neighbors.get(endId(e.source))?.add(endId(e.target));
      this.neighbors.get(endId(e.target))?.add(endId(e.source));
    }
    this.selected = null;
    this.hovered = null;
    this.layout();
    this.render();
    this.userMoved = false;
    this.fit(false);
  }

  private layout() {
    const { width, height } = this.container.getBoundingClientRect();
    const aspect = width > 0 && height > 0 ? width / height : 1.6;
    // Pull harder along the short side so the layout roughly matches the canvas shape.
    const fx = aspect >= 1 ? 0.05 : 0.11;
    const fy = aspect >= 1 ? 0.05 * Math.min(aspect, 2.2) : 0.05;
    const maxW = Math.max(1, ...this.edges.map((e) => e.weight));

    const sim = forceSimulation<GraphNode>(this.nodes)
      .randomSource(lcg(7))
      .force(
        'link',
        forceLink<GraphNode, GraphEdge>(this.edges)
          .id((d) => d.id)
          .distance((e) => {
            const s = e.source as GraphNode;
            const t = e.target as GraphNode;
            return s.r + t.r + 70;
          })
          .strength((e) => 0.08 + 0.25 * (e.weight / maxW)),
      )
      .force('charge', forceManyBody<GraphNode>().strength((d) => -180 - d.r * 7))
      .force('collide', forceCollide<GraphNode>((d) => d.r + 30).strength(1).iterations(3))
      .force('x', forceX<GraphNode>(0).strength(fx))
      .force('y', forceY<GraphNode>(0).strength(fy))
      .stop();

    const ticks = 420;
    for (let i = 0; i < ticks; i++) sim.tick();
    // Freeze everything; dragging moves nodes directly, nothing drifts afterwards.
    for (const n of this.nodes) {
      n.vx = 0;
      n.vy = 0;
    }
  }

  private render() {
    const edgeSel = this.edgeLayer
      .selectAll<SVGLineElement, GraphEdge>('line')
      .data(this.edges, (e) => `${endId(e.source)}|${endId(e.target)}`)
      .join('line')
      .attr('class', 'edge')
      .attr('stroke-width', (e) => 0.8 + Math.log2(e.weight) * 0.9);

    const nodeSel = this.nodeLayer
      .selectAll<SVGGElement, GraphNode>('g.node')
      .data(this.nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'node');
        g.append('circle').attr('class', 'node-halo');
        g.append('circle').attr('class', 'node-disc');
        g.append('circle').attr('class', 'node-inner');
        g.append('text').attr('class', 'node-label');
        g.append('text').attr('class', 'node-count');
        return g;
      })
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('data-id', (d) => d.id)
      .attr(
        'aria-label',
        (d) => `${d.label}, ${postCountLabel(d.count, this.sample)}`,
      );

    nodeSel.select<SVGCircleElement>('.node-halo').attr('r', (d) => d.r + 7);
    nodeSel
      .select<SVGCircleElement>('.node-disc')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => d.color);
    nodeSel.select<SVGCircleElement>('.node-inner').attr('r', (d) => Math.max(4, d.r - 5));
    nodeSel
      .select<SVGTextElement>('.node-label')
      .attr('y', (d) => d.r + LABEL_GAP)
      .text((d) => d.label);
    nodeSel
      .select<SVGTextElement>('.node-count')
      .attr('y', (d) => d.r + COUNT_GAP)
      .text((d) => postCountLabel(d.count, this.sample));

    nodeSel
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation();
        if (performance.now() < this.suppressClickUntil) return; // ghost click after a touch drag
        this.callbacks.onSelect(d.id, event.detail === 0 ? 'keyboard' : 'pointer');
      })
      .on('keydown', (event: KeyboardEvent, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.callbacks.onSelect(d.id, 'keyboard');
        }
      })
      .on('pointerenter', (_e, d) => this.setHover(d.id))
      .on('pointerleave', () => this.setHover(null))
      .on('focus', (_e, d) => {
        this.setHover(d.id);
        this.ensureVisible(d);
      })
      .on('blur', () => this.setHover(null));

    const self = this;
    let moved = false;
    let sx = 0;
    let sy = 0;
    nodeSel.call(
      drag<SVGGElement, GraphNode>()
        .clickDistance(5)
        .on('start', function (event) {
          moved = false;
          sx = event.x;
          sy = event.y;
        })
        .on('drag', function (event, d) {
          if (!moved && Math.hypot(event.x - sx, event.y - sy) > 6) {
            moved = true;
            // Raise only once a real drag starts; moving the element on a plain tap would cancel the click.
            select(this).classed('is-dragging', true).raise();
          }
          d.x = event.x;
          d.y = event.y;
          self.userMoved = true;
          self.positionAll();
        })
        .on('end', function () {
          select(this).classed('is-dragging', false);
          if (moved) self.suppressClickUntil = performance.now() + 350;
        }),
    );

    this.positionAll(edgeSel, nodeSel);
    this.applyClasses();
  }

  private positionAll(
    edgeSel = this.edgeLayer.selectAll<SVGLineElement, GraphEdge>('line'),
    nodeSel = this.nodeLayer.selectAll<SVGGElement, GraphNode>('g.node'),
  ) {
    edgeSel
      .attr('x1', (e) => (e.source as GraphNode).x ?? 0)
      .attr('y1', (e) => (e.source as GraphNode).y ?? 0)
      .attr('x2', (e) => (e.target as GraphNode).x ?? 0)
      .attr('y2', (e) => (e.target as GraphNode).y ?? 0);
    nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  }

  private setHover(id: string | null) {
    this.hovered = id;
    this.applyClasses();
  }

  setSelected(id: string | null) {
    this.selected = id && this.nodeById.has(id) ? id : null;
    this.applyClasses();
  }

  /** Tags related to the current search, or null when not searching. Others fade. */
  setRelated(related: Set<string> | null) {
    this.related = related;
    this.applyClasses();
  }

  private applyClasses() {
    const focusId = this.hovered ?? this.selected;
    const hood = focusId ? this.neighbors.get(focusId) : null;
    this.svg.classed('has-focus', !!focusId).classed('is-searching', !!this.related);

    this.nodeLayer
      .selectAll<SVGGElement, GraphNode>('g.node')
      .classed('is-selected', (d) => d.id === this.selected)
      .classed('is-focus', (d) => d.id === focusId)
      .classed('is-neighbor', (d) => !!hood?.has(d.id))
      .classed('is-faded', (d) => !!this.related && !this.related.has(d.id))
      .attr('aria-pressed', (d) => String(d.id === this.selected));

    this.edgeLayer
      .selectAll<SVGLineElement, GraphEdge>('line')
      .classed('is-active', (e) => !!focusId && (endId(e.source) === focusId || endId(e.target) === focusId))
      .classed(
        'is-faded',
        (e) => !!this.related && !(this.related.has(endId(e.source)) && this.related.has(endId(e.target))),
      );
  }

  private bounds() {
    if (!this.nodes.length) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of this.nodes) {
      const halfLabel = Math.max(n.r, n.label.length * 4.2);
      x0 = Math.min(x0, (n.x ?? 0) - halfLabel);
      x1 = Math.max(x1, (n.x ?? 0) + halfLabel);
      y0 = Math.min(y0, (n.y ?? 0) - n.r - 8);
      y1 = Math.max(y1, (n.y ?? 0) + n.r + COUNT_GAP + 8);
    }
    return { x0, y0, x1, y1 };
  }

  /** Fit all circles in view. */
  fit(animate = true) {
    const b = this.bounds();
    const { width, height } = this.container.getBoundingClientRect();
    if (!b || width === 0 || height === 0) return;
    const pad = width < 600 ? 14 : 40;
    const ins = this.callbacks.getInsets?.() ?? { top: 0, right: 0, bottom: 0, left: 0 };
    const availW = Math.max(100, width - ins.left - ins.right - pad * 2);
    const availH = Math.max(100, height - ins.top - ins.bottom - pad * 2);
    const scale = Math.min(1.6, Math.max(0.3, Math.min(availW / (b.x1 - b.x0), availH / (b.y1 - b.y0))));
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    const vx = ins.left + pad + availW / 2;
    const vy = ins.top + pad + availH / 2;
    const t = zoomIdentity.translate(vx - cx * scale, vy - cy * scale).scale(scale);
    this.applyTransform(t, animate);
    this.userMoved = false;
  }

  zoomBy(factor: number) {
    const { width, height } = this.container.getBoundingClientRect();
    this.zoomBehavior.scaleBy(this.svg, factor, [width / 2, height / 2]);
    this.userMoved = true;
  }

  /** Keyboard users tabbing onto an off-screen node get it scrolled into view. */
  private ensureVisible(d: GraphNode) {
    const node = this.svg.node();
    if (!node) return;
    const t: ZoomTransform = (node as SVGSVGElement & { __zoom?: ZoomTransform }).__zoom ?? zoomIdentity;
    const { width, height } = this.container.getBoundingClientRect();
    const [sx, sy] = t.apply([d.x ?? 0, d.y ?? 0]);
    const margin = 40 + d.r * t.k;
    if (sx < margin || sx > width - margin || sy < margin || sy > height - margin) {
      this.zoomBehavior.translateTo(this.svg, d.x ?? 0, d.y ?? 0);
    }
  }

  /** Pan (not zoom) so a circle is visible outside the given covered areas, e.g. the post panel. */
  revealNode(id: string, covered: Insets) {
    const d = this.nodeById.get(id);
    const node = this.svg.node();
    if (!d || !node) return;
    const t: ZoomTransform = (node as SVGSVGElement & { __zoom?: ZoomTransform }).__zoom ?? zoomIdentity;
    const { width, height } = this.container.getBoundingClientRect();
    const [sx, sy] = t.apply([d.x ?? 0, d.y ?? 0]);
    const x0 = covered.left;
    const x1 = width - covered.right;
    const y0 = covered.top;
    const y1 = height - covered.bottom;
    const rr = d.r * t.k;
    const inside = sx - rr >= x0 + 8 && sx + rr <= x1 - 8 && sy - rr >= y0 + 8 && sy + rr + 30 * t.k <= y1 - 4;
    if (inside || x1 - x0 < 60 || y1 - y0 < 60) return;
    const tx = t.x + ((x0 + x1) / 2 - sx);
    const ty = t.y + ((y0 + y1) / 2 - sy);
    this.applyTransform(zoomIdentity.translate(tx, ty).scale(t.k), true);
    this.userMoved = true;
  }

  private applyTransform(t: ZoomTransform, animate: boolean) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduce) {
      // Lightweight manual tween (avoids pulling in d3-transition).
      const from: ZoomTransform =
        (this.svg.node() as SVGSVGElement & { __zoom?: ZoomTransform }).__zoom ?? zoomIdentity;
      const start = performance.now();
      const dur = 320;
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        const k = from.k + (t.k - from.k) * e;
        const x = from.x + (t.x - from.x) * e;
        const y = from.y + (t.y - from.y) * e;
        this.zoomBehavior.transform(this.svg, zoomIdentity.translate(x, y).scale(k));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      this.zoomBehavior.transform(this.svg, t);
    }
  }

  focusNode(id: string) {
    const el = this.nodeLayer.select<SVGGElement>(`g.node[data-id="${CSS.escape(id)}"]`).node();
    el?.focus({ preventScroll: true });
  }

  clear() {
    this.nodes = [];
    this.edges = [];
    this.render();
  }
}
