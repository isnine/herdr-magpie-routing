// Live view of magpie's routing: the compact stage and magpies of magpie's
// own Routing page (internal/gui/assets/plugins/routing), redrawn in GPUI.
import { View, div, svg, image, PathBuilder, uniform_list } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, layout, settings, shared, setShared, openOverlay } from "herdr";

const GATEWAY = "127.0.0.1:3425";
const STAGE_H = 104, SIDE = 3, MAX_PLAYS = 4, KEEP = 60, ROW_H = 46;
const NODE_H = 22, NODE_GAP = 6, HUB = 40, COL_GAP = 38, PAD = 10;
const BIRD_SCALE = 0.55;
const TAG_W = 132, TAG_H = 14;
const QUOTA_MS = 30000, FULL_READ_EVERY = 10; // kept=1 asks no vendor; every 5 minutes one read does
const RING = 22, RING_STROKE = 2.5;
const METERS = ["codex", "claude", "antigravity"];
const SPANS = [[/\b5 hours\b/, "5h"], [/\b7 days\b/, "7d"]];
const FAST_MS = 33; // while a bird is in the air
const SLOW_MS = 88; // only wires flowing: the 8px dash moves 1px per 87.5ms

const PALETTE = ["#d97757", "#bd8638", "#a59234", "#849e4a", "#5aa66c", "#25a98f", "#00a6b0", "#2e9fc9", "#5e95d7", "#858ad7", "#a47fca", "#bb77b1"];
const HUES = { claude: 0, codex: 9, gemini: 7, copilot: 10, cursor: 5, opencode: 2, crush: 11, goose: 3, pi: 4, omp: 11, omo: 10, dsh: 6, commandcode: 1, mimocode: 8, deveco: 7 };

const seat = (x) => x.id + "\u0000" + (x.model || "") + (x.fixed ? ":" + x.fixed : "");
const tried = (r, tr) => r.order.find((x) => seat(x) === seat(tr))
  || r.order.find((x) => x.id === tr.id && (x.model || "") === (tr.model || ""))
  || r.order.find((x) => x.id === tr.id);
const tryOk = (tr) => tr.status < 400 && !tr.fail;
const whole = (r) => { r.order ||= []; r.tries ||= []; r.left ||= []; return r; };
const at = (s) => Date.parse(String(s).replace(/(\.\d{3})\d+/, "$1"));
const fmtMs = (ms) => ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
const fmtK = (n) => n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
const alpha = (c, a) => {
  const s = String(c), base = s.slice(0, 7), had = s.length === 9 ? parseInt(s.slice(7), 16) / 255 : 1;
  return base + Math.round(Math.max(0, Math.min(1, a * had)) * 255).toString(16).padStart(2, "0");
};

function bezierEase(x1, y1, x2, y2, x) {
  let t = x;
  for (let i = 0; i < 6; i++) {
    const cx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t - x;
    const dx = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(dx) < 1e-4) break;
    t = Math.max(0, Math.min(1, t - cx / dx));
  }
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}

// rtflap: 0→55% down hard, 55→100% up easy, each eased on its own
function flap(ms) {
  const p = (((ms % 420) + 420) % 420) / 420;
  const q = p < 0.55 ? bezierEase(0.45, 0, 0.3, 1, p / 0.55) : 1 - bezierEase(0.45, 0, 0.3, 1, (p - 0.55) / 0.45);
  return { s: 1 - 1.62 * q, k: Math.tan((-8 * q * Math.PI) / 180) };
}

function flatten(x1, y1, x2, y2) {
  const mx = (x1 + x2) / 2, pts = [];
  let L = 0;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, u = 1 - t;
    const x = u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2;
    const y = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
    if (i) L += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
    pts.push({ x, y, d: L });
  }
  return { pts, L };
}
function pointAt(w, d) {
  d = Math.max(0, Math.min(w.L, d));
  let i = 1;
  while (i < w.pts.length - 1 && w.pts[i].d < d) i++;
  const a = w.pts[i - 1], b = w.pts[i], f = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

const paint = (path, color) => window.paint_path(path, color).absolute().top(0).left(0).size_full();

export default class Routing extends View {
  init(_props, cx) {
    this.routes = new Map(); this.seq = 0; this.loaded = false; this.offline = false;
    this.pid = 0; this.serves = ""; this.totals = {}; this.skew = 0;
    this.given = new Map(); this.pAg = []; this.pDst = []; this.dst = new Map();
    this.plays = new Set(); this.trips = []; this.waits = []; this.dots = []; this.departing = [];
    this.lit = new Map(); this.gen = 0; this.ticking = false;
    this.w = 0; this.wires = new Map(); this.wiresFor = 0;
    this.masked = localStorage.getItem("masked") !== "0";
    this.poll(cx);
    this.pollQuotas(cx);
  }

  visible() {
    const find = (n, id) => { if (n?.id === id) return n; for (const c of n?.children ?? []) { const f = find(c, id); if (f) return f; } return null; };
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    return panel ? !panel.hidden && body?.active === "routing" : true;
  }

  // ---- data: the gateway's long poll, asked only while the panel shows

  poll(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        let caught = false;
        if (!this.visible()) {
          await new Promise((r) => { this.sightWait = r; });
          caught = true;
        }
        try {
          const res = await fetch(`http://${GATEWAY}/v1/magpie/trace?after=${this.seq}${this.loaded ? "&wait=1" : ""}`);
          if (!res.ok) throw new Error(String(res.status));
          this.take(await res.json(), caught, cx);
        } catch {
          this.offline = true; this.loaded = false; this.seq = 0;
          cx.notify();
          await new Promise((r) => cx.timer.after(5000, () => r()));
        }
      }
    });
  }

  pollQuotas(cx) {
    cx.spawn(async (cx) => {
      for (let i = 0; ; i++) {
        if (!this.visible()) await new Promise((r) => { this.quotaSight = r; });
        try {
          const res = await fetch(`http://${GATEWAY}/v1/magpie/quotas${i % FULL_READ_EVERY ? "?kept=1" : ""}`);
          if (!res.ok) throw new Error(String(res.status));
          setShared("usage.quotas", (await res.json()).data);
        } catch {
          setShared("usage.quotas", null);
        }
        cx.notify();
        await new Promise((r) => cx.timer.after(QUOTA_MS, () => r()));
      }
    });
  }

  take(d, caught, cx) {
    this.offline = false;
    this.skew = at(d.now) - Date.now();
    if (this.pid && d.pid !== this.pid) { this.routes.clear(); this.seq = 0; this.loaded = false; }
    this.pid = d.pid; this.serves = d.serves; this.totals = d.totals || this.totals;
    if (d.seq < this.seq) this.routes.clear();
    this.seq = d.seq;
    const first = !this.loaded, fresh = [];
    for (const r of d.routes || []) {
      if (!this.routes.has(r.id) && !first) fresh.push(r.id);
      this.routes.set(r.id, whole(r));
    }
    if (Array.isArray(d.ids)) {
      const kept = new Set(d.ids);
      for (const [id, r] of this.routes) if (!r.done && !kept.has(id)) this.routes.delete(id);
    }
    for (const id of [...this.routes.keys()].sort((a, b) => a - b).slice(0, -KEEP)) this.routes.delete(id);
    this.loaded = true;
    this.wake();
    this.draw();
    if (first || caught) {
      this.stopPlays();
      const under = [...this.routes.values()].filter((r) => !r.done).sort((a, b) => a.id - b.id).slice(-MAX_PLAYS);
      for (const r of under) this.play(r.id, cx);
    } else for (const id of fresh) this.play(id, cx);
    cx.notify();
  }

  // ---- who stands on the stage (pDraw, pPlace, pSeat)

  hueOf(id, near) {
    let c = this.given.get(id);
    if (c && !near?.has(c)) return c;
    let h = HUES[id];
    if (h == null) { h = 0; for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; }
    const had = new Set(this.given.values()), from = (k) => PALETTE[(h + k) % PALETTE.length], ks = [...PALETTE.keys()];
    c = from(ks.find((k) => !had.has(from(k)) && !near?.has(from(k))) ?? ks.find((k) => !near?.has(from(k))) ?? 0);
    this.given.set(id, c);
    return c;
  }
  seatOf(r, tr) {
    const w = tr && tried(r, tr);
    if (!w) return { key: r.provider || "?", name: r.provider || "?", sub: "" };
    return { key: w.provider || r.provider || "?", name: w.name || w.provider, sub: w.kind === "provider" ? "" : w.who || "" };
  }
  place(had, want) {
    const out = had.map((k) => want.includes(k) ? k : null);
    for (const k of want) if (!out.includes(k)) { const i = out.indexOf(null); if (i >= 0) out[i] = k; else out.push(k); }
    return out.filter(Boolean).slice(0, SIDE);
  }
  draw() {
    const recent = [...this.routes.values()].sort((a, b) => b.id - a.id);
    const ags = [], dst = new Map();
    for (const r of recent.filter((r) => this.plays.has(r.id))) {
      if (!ags.includes(r.agent)) ags.push(r.agent);
      for (const tr of r.tries) { const s = this.seatOf(r, tr); if (!dst.has(s.key)) dst.set(s.key, s); }
    }
    for (const r of recent) {
      if (ags.length < SIDE && !ags.includes(r.agent)) ags.push(r.agent);
      const tr = r.tries[r.tries.length - 1];
      if (tr) { const s = this.seatOf(r, tr); if (!dst.has(s.key) && dst.size < SIDE) dst.set(s.key, s); }
    }
    for (const r of recent) for (const x of r.tries.slice().reverse()) {
      const s = this.seatOf(r, x), d = dst.get(s.key);
      if (d && !d.how) { d.how = !x.done ? "wait" : tryOk(x) ? "ok" : "bad"; d.sub = s.sub; }
    }
    this.pAg = this.place(this.pAg, ags.slice(0, SIDE));
    const near = new Set();
    for (const id of this.pAg) near.add(this.hueOf(id, near));
    this.pDst = this.place(this.pDst, [...dst.keys()].slice(0, SIDE));
    this.dst = dst;
  }

  // ---- geometry

  colW() { return Math.max(0, (this.w - 2 * PAD - HUB - 2 * COL_GAP) / 2); }
  nodeY(i, n) { return (STAGE_H - (n * NODE_H + (n - 1) * NODE_GAP)) / 2 + i * (NODE_H + NODE_GAP) + NODE_H / 2; }
  wire(k) {
    if (!this.w) return null;
    if (this.wiresFor !== this.w) { this.wires.clear(); this.wiresFor = this.w; }
    const out = k[0] === "d", list = out ? this.pDst : this.pAg, i = list.indexOf(k.slice(2));
    if (i < 0) return null;
    const y = this.nodeY(i, list.length), hy = STAGE_H / 2, cw = this.colW(), mid = this.w / 2;
    const [x1, y1, x2, y2] = out
      ? [mid + HUB / 2 + 2, hy, this.w - PAD - cw - 3, y]
      : [PAD + cw + 3, y, mid - HUB / 2 - 2, hy];
    const key = `${k}|${y}`;
    let w = this.wires.get(key);
    if (!w) { w = flatten(x1, y1, x2, y2); this.wires.set(key, w); }
    return w;
  }

  // ---- playing a request (pPlay), with the page's magpies carrying the dot

  until(f, g) {
    if (f() || g !== this.gen) return Promise.resolve();
    return new Promise((res) => this.waits.push({ f, g, res, by: Date.now() + 180e3 }));
  }
  wake() {
    const w = this.waits; this.waits = [];
    for (const x of w) if (x.g !== this.gen || x.f() || Date.now() > x.by) x.res(); else this.waits.push(x);
  }
  stopPlays() {
    this.gen++;
    for (const tr of this.trips) tr.res();
    this.trips = []; this.departing = [];
    this.wake();
  }
  light(k, color, by) {
    const l = this.lit.get(k) ?? { n: 0, color };
    l.n += by; if (by > 0) l.color = color;
    if (l.n > 0) this.lit.set(k, l); else this.lit.delete(k);
  }
  async fly(dot, k, back, ms, cx) {
    if (!this.wire(k)) return;
    this.light(k, dot.color, 1);
    await new Promise((res) => {
      this.trips.push({ dot, k, back, t0: Date.now(), ms, res });
      this.kick(cx);
    });
    this.light(k, dot.color, -1);
  }
  rest(ms, cx) { return new Promise((r) => cx.timer.after(ms, () => r())); }
  bird() { return { born: Date.now() }; }
  away(dot) {
    const b = dot.bird;
    dot.bird = null;
    if (b && b.x !== undefined) { b.awayAt = Date.now(); this.departing.push(b); }
  }

  play(id, cx) {
    if (this.plays.has(id) || this.plays.size >= MAX_PLAYS || !this.routes.has(id)) return;
    cx.spawn(async (cx) => {
      let r = this.routes.get(id);
      const g = this.gen, live = () => g === this.gen;
      this.plays.add(id);
      this.draw();
      const dot = { color: this.hueOf(r.agent), state: "", bird: this.bird(), model: r.model };
      this.dots.push(dot);
      this.kick(cx);
      const rt = () => this.routes.get(id) || { ...r, done: true, gone: true };
      const home = "a:" + r.agent;
      try {
        await this.fly(dot, home, false, 420, cx);
        for (let i = 0; live(); i++) {
          await this.until(() => { r = rt(); return r.tries.length > i || r.done; }, g);
          if (r.gone || !live()) break;
          const tr = r.tries[i];
          if (!tr) break;
          const k = "d:" + this.seatOf(r, tr).key;
          this.draw();
          if (!dot.bird) dot.bird = this.bird();
          await this.fly(dot, k, false, 460, cx);
          if (!live()) break;
          this.away(dot); // let go at the account: it waits there while that answers
          this.light(k, dot.color, 1);
          dot.state = "wait";
          this.kick(cx);
          await this.until(() => { r = rt(); return r.tries[i]?.done || r.done; }, g);
          dot.state = "";
          this.light(k, dot.color, -1);
          if (r.gone || !live()) break;
          const t2 = r.tries[i];
          if (t2 && !tryOk(t2)) {
            dot.state = "bad";
            await this.rest(260, cx);
            dot.bird = this.bird();
            await this.fly(dot, k, true, 360, cx);
            this.away(dot);
            await this.until(() => { r = rt(); return r.tries.length > i + 1 || r.done; }, g);
            if (r.gone || !live()) break;
            if (r.tries.length > i + 1) { dot.state = ""; continue; }
            dot.bird = this.bird();
            await this.fly(dot, home, true, 420, cx);
            break;
          }
          dot.state = "ok";
          dot.bird = this.bird();
          await this.fly(dot, k, true, 420, cx);
          await this.fly(dot, home, true, 420, cx);
          break;
        }
      } finally {
        this.away(dot);
        dot.goneAt = Date.now();
        this.plays.delete(id);
        this.draw();
        this.kick(cx);
        cx.notify();
      }
    });
  }

  // ---- the loop: runs only while something moves and the panel shows

  busy() { return this.trips.length > 0 || this.dots.length > 0 || this.departing.length > 0; }
  fast() { return this.trips.length > 0 || this.departing.length > 0 || this.dots.some((d) => d.bird || d.goneAt); }
  kick(cx) {
    if (this.ticking) return;
    this.ticking = true;
    cx.timer.after(FAST_MS, (cx) => this.step(cx));
  }
  step(cx) {
    this.ticking = false;
    if (!this.visible()) {
      this.stopPlays();
      this.dots = [];
      return;
    }
    const now = Date.now(), going = [];
    for (const tr of this.trips) {
      const k = Math.min(1, Math.max(0, (now - tr.t0) / tr.ms));
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.pose(tr, e);
      if (k >= 1) tr.res(); else going.push(tr);
    }
    this.trips = going;
    this.departing = this.departing.filter((b) => now - b.awayAt < 450);
    this.dots = this.dots.filter((d) => !d.goneAt || now - d.goneAt < 300);
    cx.notify();
    if (this.busy()) {
      this.ticking = true;
      cx.timer.after(this.fast() ? FAST_MS : SLOW_MS, (cx) => this.step(cx));
    }
  }
  pose(tr, e) {
    const w = this.wire(tr.k);
    if (!w || !w.L) return;
    const d = (tr.back ? 1 - e : e) * w.L, pt = pointAt(w, d);
    tr.dot.x = pt.x; tr.dot.y = pt.y;
    const b = tr.dot.bird;
    if (!b) return;
    const dir = tr.back ? -1 : 1, p0 = pointAt(w, d - 3 * dir), p1 = pointAt(w, d + 3 * dir);
    let vx = p1.x - p0.x, vy = p1.y - p0.y;
    if (Math.abs(vx) + Math.abs(vy) < 0.01) { vx = b.vx ?? dir; vy = 0; }
    b.vx = vx;
    const aim = Math.max(-24, Math.min(24, (Math.atan2(vy, Math.abs(vx)) * 180) / Math.PI));
    b.a = b.a === undefined || b.flip !== (vx < 0) ? aim : b.a + (aim - b.a) * 0.22;
    b.flip = vx < 0;
    b.x = pt.x; b.y = pt.y;
  }

  // ---- drawing

  birdEls(b, now, t, card) {
    let lx = 0, ly = 0, ls = 1, op = 1;
    if (b.awayAt) {
      const k = Math.min(1, (now - b.awayAt) / 450), e = bezierEase(0.3, 0, 0.2, 1, k);
      lx = 14 * e; ly = -16 * e; ls = 1 - 0.2 * e; op = 1 - e;
    } else {
      const k = Math.min(1, (now - b.born) / 300), e = 1 - (1 - k) * (1 - k);
      lx = -6 * (1 - e); ly = -10 * (1 - e); ls = 0.85 + 0.15 * e; op = e;
    }
    const rad = ((b.a ?? 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad), fx = b.flip ? -1 : 1;
    const S = 1.2 * BIRD_SCALE * ls, LX = lx * BIRD_SCALE, LY = ly * BIRD_SCALE;
    const T = (x, y) => {
      const ix = S * (x - 6.5) + LX, iy = S * (y + 3.2) + LY;
      return [b.x + fx * (ix * cos - iy * sin), b.y + (ix * sin + iy * cos)];
    };
    const wing = (o, f) => (x, y) => T(o[0] + (x - o[0]) + f.k * (y - o[1]), o[1] + f.s * (y - o[1]));
    const shape = (M, start, curves) => {
      const p = PathBuilder.fill(); p.move_to(...M(...start));
      for (const c of curves) p.cubic_bezier_to(...M(c[4], c[5]), ...M(c[0], c[1]), ...M(c[2], c[3]));
      p.line_to(...M(...start)); p.close();
      return p.build();
    };
    const poly = (pts) => { const p = PathBuilder.fill(); p.add_polygon(pts.map((q) => T(...q)), true); return p.build(); };
    const ellipse = (cx, cy, rx, ry) => { const pts = []; for (let i = 0; i < 18; i++) { const a = (i / 18) * 2 * Math.PI; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); } return poly(pts); };
    const fg = alpha(t.foreground, op), far = alpha(t.foreground, 0.45 * op), belly = alpha(card, op);
    const age = now - b.born;
    const nearF = flap(age), farF = flap(age + 30);
    const F = wing([-12.3, -3.2], farF), N = wing([-12.7, -2.8], nearF);
    const bar = PathBuilder.stroke(1.3 * S); bar.move_to(...N(-14.6, -5.6));
    bar.cubic_bezier_to(...N(-10.4, -17.2), ...N(-15.4, -10.4), ...N(-13.8, -14.4));
    return [
      paint(shape(F, [-14.5, -3.4], [[-16.5, -9.5, -14.2, -15, -8.6, -18.6], [-9.4, -12.6, -9.6, -7.4, -9.2, -3.2]]), far),
      paint(poly([[-31.5, 3.1], [-18.6, -1.8], [-17.4, 1.2], [-30.8, 4.6]]), fg),
      paint(ellipse(-12.2, -1.4, 7.6, 3.9), fg),
      paint(ellipse(-12.8, 0.4, 4.3, 1.6), belly),
      paint(ellipse(-4.9, -3.7, 3.1, 3.1), fg),
      paint(poly([[-2.3, -4.8], [1.4, -3.3], [-2.3, -2.2]]), fg),
      paint(shape(N, [-15.6, -3.2], [[-17.8, -10.2, -15.2, -16.4, -8.4, -20.4], [-9.3, -13.6, -9.4, -7.8, -8.8, -2.8]]), fg),
      paint(bar.build(), belly),
    ];
  }

  stage(t) {
    const w = this.w, cw = this.colW(), now = Date.now(), card = t.surface;
    const green = t.ansi2, red = t.ansi1;
    const keys = [...this.pAg.map((k) => "a:" + k), ...this.pDst.map((k) => "d:" + k)];
    const base = PathBuilder.stroke(1.5), lines = [];
    let any = false;
    for (const k of keys) {
      const wr = this.wire(k);
      if (!wr) continue;
      const lit = this.lit.get(k);
      if (!lit) {
        any = true;
        base.move_to(wr.pts[0].x, wr.pts[0].y);
        for (const p of wr.pts.slice(1)) base.line_to(p.x, p.y);
        continue;
      }
      // dash_array has no offset, so the flow is cut by hand: 3 on, 5 off
      const shift = ((now % 700) / 700) * 8, dash = PathBuilder.stroke(1.5);
      for (let s = shift - 8; s < wr.L; s += 8) {
        const a = Math.max(0, s), b = Math.min(wr.L, s + 3);
        if (b <= a) continue;
        const p = pointAt(wr, a), q = pointAt(wr, b);
        dash.move_to(p.x, p.y); dash.line_to(q.x, q.y);
      }
      lines.push(paint(dash.build(), alpha(k[0] === "a" ? this.hueOf(k.slice(2)) : lit.color, 0.8)));
    }
    if (any) lines.unshift(paint(base.build(), t.border));

    const sky = [], tags = [], placed = [];
    for (const d of this.dots) {
      if (d.x === undefined) continue;
      const c = d.state === "ok" ? green : d.state === "bad" ? red : d.color;
      const pulse = d.state === "wait" ? 0.725 + 0.275 * Math.cos((now / 1200) * 2 * Math.PI) : 1;
      const fade = d.goneAt ? Math.max(0, 1 - (now - d.goneAt) / 300) : 1;
      sky.push(div().absolute().left(d.x - 6).top(d.y - 6).size(12).rounded(6).bg(alpha(c, 0.25 * pulse * fade)));
      sky.push(div().absolute().left(d.x - 3.5).top(d.y - 3.5).size(7).rounded(3.5).bg(alpha(c, pulse * fade)));
      if (!d.model) continue;
      const left = Math.max(2, Math.min(w - TAG_W - 2, d.x - TAG_W / 2));
      const below = d.y + 9 + TAG_H <= STAGE_H - 2, step = below ? TAG_H + 1 : -(TAG_H + 1);
      let top = below ? d.y + 9 : d.y - 9 - TAG_H;
      // Requests waiting on one account sit at the same point.
      while (placed.some((p) => Math.abs(p.left - left) < TAG_W && Math.abs(p.top - top) < TAG_H)) top += step;
      placed.push({ left, top });
      tags.push(h_flex().absolute().left(left).top(top).w(TAG_W).h(TAG_H).justify_center().child(
        div().min_w(0).truncate().px(5).rounded(5).text_size(10).bg(alpha(t.raised, 0.92 * fade)).text_color(alpha(t.foreground, fade)).child(d.model)));
    }
    for (const b of [...this.dots.map((d) => d.bird).filter((b) => b && b.x !== undefined), ...this.departing]) sky.push(...this.birdEls(b, now, t, card));

    const node = (id, el) => el.id(id).h(NODE_H).px(8).gap(5).items_center().rounded(7).max_w_full().min_w(0).text_size(11.5).bg(t.raised).border(1).border_color(t.border).text_color(t.foreground);
    const from = this.pAg.map((a, i) => h_flex().absolute().left(PAD).w(cw).top(this.nodeY(i, this.pAg.length) - NODE_H / 2).justify_end().child(
      node(`ag-${a}`, h_flex()).child(svg("mods/workspace-chrome/terminal.svg").size(13).flex_none().text_color(this.hueOf(a))).child(div().min_w(0).truncate().font_semibold().child(a))));
    const to = this.pDst.map((k, i) => {
      const d = this.dst.get(k) ?? { name: k, how: "ok" };
      const dotEl = div().size(6).rounded(3).flex_none().bg(d.how === "bad" ? red : d.how === "wait" ? t.muted : green);
      return h_flex().absolute().left(w - PAD - cw).w(cw).top(this.nodeY(i, this.pDst.length) - NODE_H / 2).justify_start().child(
        node(`dst-${k}`, h_flex())
          .child(d.how === "wait" ? dotEl.id(`w-${k}`).loop("opacity", { from: 0.35, to: 1, period: 1800 }) : dotEl)
          .child(div().min_w(0).truncate().font_semibold().child(d.name))
          .when(Boolean(d.sub), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.muted).child(this.masked ? "••••" : d.sub))));
    });
    const hubX = w / 2 - HUB / 2, hubY = STAGE_H / 2 - HUB / 2;
    const ring = div().id("hub-ring").absolute().left(hubX).top(hubY).size(HUB).rounded(HUB).bg(t.foreground)
      .loop("opacity", { from: 0, to: 0.16, period: 1800 });
    const hub = h_flex().absolute().left(hubX).top(hubY).size(HUB).rounded(HUB).items_center().justify_center()
      .bg(t.raised).border(1).border_color(t.border).text_color(t.foreground).child(svg("mods/routing/bird.svg").size(24));
    return div().id("stage").relative().h(STAGE_H).flex_none().w_full().rounded(11).bg(card).border(1).border_color(t.border).overflow_hidden()
      .children(lines).children(sky).when(this.plays.size > 0, (el) => el.child(ring)).children(from).child(hub).children(to).children(tags);
  }

  // The fullest 5-hour or 7-day window of one agent's accounts.
  meter(id, list) {
    let best = null;
    for (const q of list) if (q.provider === id) for (const w of q.windows ?? []) {
      const span = !w.unlimited && !w.text && w.balance == null && SPANS.find(([re]) => re.test(w.name));
      if (span && (!best || w.used > best.used)) best = { id, used: Math.max(0, Math.min(100, w.used)), label: span[1] };
    }
    return best;
  }
  ring(m, t) {
    const arc = (used) => {
      const p = PathBuilder.stroke(RING_STROKE), c = RING / 2, r = c - RING_STROKE / 2, n = Math.max(1, Math.ceil(used / 2.5));
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * used * i) / (100 * n), x = c + r * Math.cos(a), y = c + r * Math.sin(a);
        if (i) p.line_to(x, y); else p.move_to(x, y);
      }
      return p.build();
    };
    const color = m.used >= 90 ? t.ansi1 : m.used >= 60 ? t.ansi3 : t.ansi2;
    return h_flex().gap(3).items_center().flex_none()
      .child(image(`icons/${m.id}.svg`).size(14).flex_none())
      .child(div().relative().size(RING).flex_none()
        .child(paint(arc(100), t.border))
        .when(m.used > 0, (el) => el.child(paint(arc(m.used), color)))
        .child(h_flex().absolute().top(0).left(0).size_full().items_center().justify_center().text_size(8.5).text_color(t.foreground).child(m.label)));
  }

  row(r, t) {
    const green = t.ansi2, red = t.ansi1, last = r.tries[r.tries.length - 1];
    const ok = r.done ? (last ? tryOk(last) : r.status < 400 && !r.error) : null;
    const w = last && tried(r, last);
    const name = w ? w.name || w.provider : r.provider;
    const who = w && w.kind !== "provider" && w.who ? (this.masked ? "••••" : w.who) : "";
    const model = last?.model || w?.model || "";
    const elapsed = r.done ? r.ms : Date.now() + this.skew - at(r.time);
    const n = r.tries.length;
    const speed = r.done && r.out && r.flow >= 100 ? `${Math.round(r.out / (r.flow / 1000))} tok/s` : "";
    const stats = [`${n} ${n === 1 ? "try" : "tries"}`, r.tokens ? `${fmtK(r.tokens)} tokens` : "", elapsed != null ? fmtMs(elapsed) : "", speed].filter(Boolean).join(" · ");
    return v_flex().id(`r-${r.id}`).w_full().h(ROW_H).px(8).justify_center().gap(2).rounded(8).text_size(12).hover((s) => s.bg(t.hover))
      .child(h_flex().gap(6).items_center().min_w(0)
        .child(svg("mods/workspace-chrome/terminal.svg").size(13).flex_none().text_color(this.hueOf(r.agent)))
        .child(div().flex_none().font_semibold().text_color(t.foreground).child(r.agent))
        .child(div().min_w(0).truncate().px(5).rounded(5).text_size(10.5).bg(t.raised).text_color(t.muted).child(r.model || ""))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11).text_color(t.muted).child(String(r.time).slice(11, 19))))
      .child(h_flex().gap(5).items_center().min_w(0).text_size(11.5).text_color(t.muted)
        .child(div().flex_none().text_color(t.dim).child("→"))
        .child(div().size(6).rounded(3).flex_none().bg(ok === null ? t.working : ok ? green : red))
        .child(div().flex_none().text_color(ok === false ? red : t.foreground).child(name || ""))
        .when(Boolean(who), (el) => el.child(div().flex_none().child(who)))
        .child(div().flex_1().min_w(0).truncate().child(model))
        .child(div().flex_none().text_size(11).child(stats)));
  }

  render() {
    const t = theme(), vis = this.visible();
    if (vis && this.sightWait) { const go = this.sightWait; this.sightWait = null; go(); }
    if (vis && this.quotaSight) { const go = this.quotaSight; this.quotaSight = null; go(); }
    const quotas = shared("usage.quotas") ?? [], meters = METERS.map((id) => this.meter(id, quotas)).filter(Boolean);
    const all = [...this.routes.values()].sort((a, b) => b.id - a.id);
    const flight = all.filter((r) => !r.done), recent = all.filter((r) => r.done);
    const label = (s) => div().px(8).pt(6).pb(2).text_size(10.5).text_color(t.dim).child(s);
    const body = this.offline
      ? div().p(12).text_size(12).text_color(t.muted).child(`magpie isn't answering at ${GATEWAY}.`)
      : !all.length
        ? div().p(12).text_size(12).text_color(t.muted).child(this.loaded ? "No request yet. Every request an agent sends to magpie shows up here." : "Connecting…")
        : v_flex().flex_1().min_h(0)
          .when(flight.length > 0, (el) => el.child(label(`IN FLIGHT ${flight.length}`)).children(flight.slice(0, 6).map((r) => this.row(r, t))))
          .child(uniform_list("recent", recent.length, (i) => String(recent[i].id), (range) => {
            const out = [];
            for (let i = range.start; i < range.end; i++) out.push(this.row(recent[i], t));
            return out;
          }).flex_1().min_h(0));
    const live = flight.length;
    return v_flex().id("root").size_full().min_h(0).p(8).gap(8).bg(t.background).rounded(10).border(1).border_color(t.border).text_color(t.foreground)
      .on_size_change((size, cx) => { this.w = size.width / (settings().zoom || 1) - 18; cx.notify(); })
      .child(h_flex().h(22).gap(7).px(4).items_center().flex_none().text_size(13)
        .child(svg("mods/routing/route.svg").size(14).text_color(t.muted))
        .child(div().font_semibold().child("Magpie"))
        .when(live > 0, (el) => el.child(div().id("live").size(6).rounded(3).bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1800 })).child(div().text_size(12).text_color(t.working).child(`${live} live`))))
      .when(this.w > 0 && all.length > 0 && !this.offline, (el) => el.child(this.stage(t)))
      .child(body)
      .when(Boolean(this.pid) || meters.length > 0, (el) => el.child(h_flex().flex_none().min_h(24).px(4).gap(10).items_center()
        .child(div().flex_1().min_w(0).text_size(10.5).text_color(t.dim).truncate()
          .child(this.pid ? `${GATEWAY} · pid ${this.pid} · ${this.serves} · ${this.totals.requests ?? 0} calls · ${this.totals.rerouted ?? 0} retried` : ""))
        .when(meters.length > 0, (el) => el.child(h_flex().id("usage-rings").flex_none().h(26).px(4).gap(8).items_center().rounded(6).hover((s) => s.bg(t.hover))
          .on_click(() => openOverlay({ mod: "usage", kind: "popup", width: 360, height: 560 }))
          .children(meters.map((m) => this.ring(m, t)))))));
  }
}
