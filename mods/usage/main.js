// Every account's allowance as magpie reports it. The routing panel keeps
// the numbers in shared("usage.quotas"); this only draws them and refreshes.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared } from "herdr";

const GATEWAY = "127.0.0.1:3425";
const HOUR = 3600e3;
const LIST_H = 400; // a popup takes its height from its content, so the list needs its own
const ICONS = { codex: "codex", claude: "claude", copilot: "copilot", antigravity: "antigravity", grok: "grok", "opencode-zen-free": "opencode" };

const at = (s) => Date.parse(String(s).replace(/(\.\d{3})\d+/, "$1"));
const reading = (w) => !w.unlimited && !w.text && w.balance == null;
const tone = (t, used) => used >= 90 ? t.ansi1 : used >= 60 ? t.ansi3 : t.ansi2;
const key = (q) => `${q.provider}:${q.user || ""}`;
const length = (w) => /\b5 hours\b/.test(w.name) ? 5 * HOUR : /\b7 days\b/.test(w.name) ? 168 * HOUR : null;

function span(ms) {
  const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m / 60);
  return d ? `${d}d ${h % 24}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
}

// How far through its window a reading is, 0..1, when the window's length is known.
function elapsed(w, now) {
  const len = length(w);
  if (!len || !w.resetsAt) return null;
  const e = 1 - (at(w.resetsAt) - now) / len;
  return e > 0 && e <= 1 ? e : null;
}

export default class Usage extends View {
  init() {
    this.refreshing = false;
    this.tab = "usage";
    this.open = new Set();
    let hidden = [];
    try { hidden = JSON.parse(localStorage.getItem("hidden") ?? "[]"); } catch {}
    this.hidden = new Set(hidden);
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const res = await fetch(`http://${GATEWAY}/v1/magpie/quotas`);
        if (res.ok) setShared("usage.quotas", (await res.json()).data);
      } catch {}
      this.refreshing = false;
      cx.notify();
    });
  }

  icon(q, t) {
    const file = ICONS[q.provider];
    return file
      ? image(`icons/${file}.svg`).size(16).flex_none()
      : h_flex().size(16).flex_none().rounded(8).items_center().justify_center().bg(t.raised).text_size(9).text_color(t.muted).child(q.name.slice(0, 1));
  }

  windowRow(w, t, now) {
    const row = h_flex().h(20).pl(24).gap(10).items_center().text_size(12)
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(w.name));
    if (!reading(w)) return row.child(div().flex_none().pr(16).text_color(t.muted).child(w.display || "Unlimited"));
    const used = Math.max(0, Math.min(100, w.used)), c = tone(t, used), e = elapsed(w, now);
    return row
      .child(div().relative().w(96).h(4).flex_none().rounded(2).bg(t.raised)
        .child(div().h_full().rounded(2).bg(c).w(Math.max(3, 0.96 * used)))
        .when(e !== null, (el) => el.child(div().absolute().top(-2).left(96 * e).w(1).h(8).bg(t.foreground))))
      .child(h_flex().w(38).flex_none().pr(16).justify_end().text_color(used >= 60 ? c : t.foreground).child(`${Math.round(used)}%`));
  }

  // Pace against the even rate, and whether what's left lasts until the reset.
  detail(w, t, now) {
    const parts = [];
    if (w.display) parts.push(w.display);
    if (w.resetsAt && at(w.resetsAt) > now) parts.push(`Resets in ${span(at(w.resetsAt) - now)}`);
    const e = reading(w) ? elapsed(w, now) : null;
    if (e !== null) {
      const diff = Math.round(w.used - e * 100);
      parts.push(diff === 0 ? "On pace" : `${Math.abs(diff)}% ${diff > 0 ? "ahead of" : "behind"} pace`);
      if (w.used > 0) {
        const left = ((100 - w.used) * e * length(w)) / w.used, reset = at(w.resetsAt) - now;
        parts.push(left < reset ? `Runs out in ${span(left)}` : "Lasts to reset");
      }
    }
    return parts.length ? div().h(16).pl(24).truncate().text_size(10.5).text_color(t.dim).child(parts.join(" · ")) : null;
  }

  account(q, t, now) {
    const k = key(q), open = this.open.has(k);
    const next = Math.min(...(q.windows || []).filter((w) => w.resetsAt).map((w) => at(w.resetsAt)).filter((x) => x > now));
    const right = q.error ? "Unavailable" : q.balance ? q.balance : Number.isFinite(next) ? `Resets in ${span(next - now)}` : "";
    const rows = [];
    for (const w of q.windows || []) {
      rows.push(this.windowRow(w, t, now));
      if (open) { const d = this.detail(w, t, now); if (d) rows.push(d); }
    }
    return v_flex().w_full().flex_none()
      .child(h_flex().id(`acct-${k}`).h(26).gap(8).items_center().rounded(5).text_size(13).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { if (open) this.open.delete(k); else this.open.add(k); cx.notify(); })
        .child(this.icon(q, t))
        .child(div().flex_none().font_semibold().text_color(t.foreground).child(q.alias || q.name))
        .when(Boolean(q.plan), (el) => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(`· ${q.plan}`)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(11.5).text_color(t.muted).child(right))
        .child(h_flex().w(10).flex_none().justify_center().text_color(t.dim).child(open ? "⌄" : "›")))
      .children(rows);
  }

  displayRow(q, t) {
    const k = key(q), on = !this.hidden.has(k);
    return h_flex().id(`show-${k}`).w_full().flex_none().h(30).gap(8).items_center().rounded(5).text_size(13).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (on) this.hidden.add(k); else this.hidden.delete(k);
        try { localStorage.setItem("hidden", JSON.stringify([...this.hidden])); } catch {}
        cx.notify();
      })
      .child(this.icon(q, t))
      .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.muted).child(q.alias || q.name))
      .child(h_flex().w(28).h(16).p(2).flex_none().rounded(8).bg(on ? t.accent : t.raised).when(on, (el) => el.justify_end())
        .child(div().size(12).rounded(6).bg(t.foreground)));
  }

  segment(id, label, t) {
    const on = this.tab === id;
    return h_flex().id(`tab-${id}`).flex_1().h(28).items_center().justify_center().rounded(7).text_size(12.5)
      .bg(on ? t.raised : t.background).text_color(on ? t.foreground : t.muted)
      .on_click((_e, cx) => { this.tab = id; cx.notify(); })
      .child(label);
  }

  render() {
    const t = theme(), list = shared("usage.quotas"), now = Date.now();
    const shown = (list ?? []).filter((q) => q.windows?.length || q.balance || q.error);
    const read = Math.max(...shown.filter((q) => q.readAt).map((q) => at(q.readAt)));
    const updated = !list ? "magpie isn't answering" : Number.isFinite(read) ? `Updated ${now - read < 60000 ? "just now" : `${span(now - read)} ago`}` : "";
    const rows = this.tab === "usage"
      ? shown.filter((q) => !this.hidden.has(key(q))).map((q) => this.account(q, t, now))
      : shown.map((q) => this.displayRow(q, t));
    return v_flex().id("usage").w_full().p(14).gap(10).bg(t.background).text_color(t.foreground)
      .child(v_flex().flex_none().gap(2)
        .child(h_flex().justify_between().items_center()
          .child(div().text_size(14).font_semibold().child("Agent Quota"))
          .child(div().id("refresh").px(6).rounded(5).text_size(12).text_color(t.accent).hover((s) => s.bg(t.hover))
            .on_click((_e, cx) => this.refresh(cx)).child(this.refreshing ? "Refreshing…" : "Refresh")))
        .child(div().text_size(11.5).text_color(t.dim).child(updated)))
      .child(h_flex().flex_none().p(3).gap(3).rounded(10).border(1).border_color(t.border)
        .child(this.segment("usage", "Usage", t)).child(this.segment("display", "Display", t)))
      .child(div().flex_none().h(1).bg(t.border))
      .child(v_flex().id("accounts").flex_none().h(LIST_H).gap(10).overflow_y_scrollbar().children(rows))
      .when(this.tab === "usage", (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("Click a provider for its full breakdown, pace and runway.")));
  }
}
