import './fonts.css';
import './styles.css';
import { siteConfig } from '../site.config';
import { loadDataset, normalizeQuery, orderPosts, postMatches, queryRegExp, search, tagLabelMatches } from './lib/data';
import { ContentGraph } from './lib/graph';
import type { GraphNode, Lens, Post } from './types';

// ---------------------------------------------------------------- setup

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  topbar: $('topbar'),
  title: $<HTMLAnchorElement>('site-title'),
  tagline: $('site-tagline'),
  menuBtn: $<HTMLButtonElement>('menu-btn'),
  menuBtnLabel: $('menu-btn-label'),
  lensTabs: [...document.querySelectorAll<HTMLButtonElement>('.lens-tab')],
  searchForm: $<HTMLFormElement>('search-form'),
  searchInput: $<HTMLInputElement>('search-input'),
  searchClear: $<HTMLButtonElement>('search-clear'),
  searchToggle: $<HTMLButtonElement>('search-toggle'),
  aboutBtn: $<HTMLButtonElement>('about-btn'),
  about: $<HTMLDialogElement>('about'),
  layout: $('layout'),
  rail: $('rail'),
  railTitle: $('rail-title'),
  railStats: $('rail-stats'),
  railClose: $<HTMLButtonElement>('rail-close'),
  tagList: $<HTMLUListElement>('tag-list'),
  railEmpty: $('rail-empty'),
  railFoot: $('rail-foot'),
  scrim: $('scrim'),
  stage: $('stage'),
  sampleBanner: $('sample-banner'),
  graph: $('graph'),
  stageMessage: $('stage-message'),
  legend: $('legend'),
  hint: $('hint'),
  panel: $('panel'),
  panelKicker: $('panel-kicker'),
  panelTitle: $('panel-title'),
  panelMeta: $('panel-meta'),
  panelBody: $('panel-body'),
  panelClose: $<HTMLButtonElement>('panel-close'),
};

const ds = loadDataset(siteConfig);
const LENS_WORD: Record<Lens, { one: string; many: string; title: string }> = {
  themes: { one: 'theme', many: 'themes', title: 'Themes' },
  tones: { one: 'tone', many: 'tones', title: 'Tone' },
};
const mobileQuery = window.matchMedia('(max-width: 760px)');
const isMobile = () => mobileQuery.matches;
const dateFmt = new Intl.DateTimeFormat(siteConfig.dateLocale || undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const threadSizes = new Map<string, number>();
for (const p of ds.posts) if (p.threadId) threadSizes.set(p.threadId, (threadSizes.get(p.threadId) ?? 0) + 1);

interface State {
  lens: Lens;
  tag: string | null;
  q: string; // raw text as typed
}
let state: State = { lens: 'themes', tag: null, q: '' };
let railCollapsed = false; // desktop
let drawerOpen = false; // mobile
let returnFocusTo: string | null = null;

const graph = new ContentGraph(els.graph, {
  getInsets: () => overlayInsets(),
  onSelect: (id, origin) => {
    returnFocusTo = id;
    selectTag(id, origin === 'keyboard');
  },
  onBackgroundClick: () => {
    if (state.tag) update({ tag: null }, 'push');
  },
});

// ---------------------------------------------------------------- personalise

document.title = siteConfig.siteTitle;
els.title.textContent = siteConfig.siteTitle;
els.tagline.textContent = siteConfig.tagline;
$('about-title').textContent = siteConfig.siteTitle;
$('about-intro').textContent = siteConfig.intro;
const profileLinks: { label: string; href: string }[] = [];
if (siteConfig.xHandle) {
  const h = siteConfig.xHandle.replace(/^@/, '');
  profileLinks.push({ label: `X @${h}`, href: `https://x.com/${encodeURIComponent(h)}` });
}
if (siteConfig.linkedinUrl) profileLinks.push({ label: 'LinkedIn', href: siteConfig.linkedinUrl });
if (siteConfig.substackUrl) profileLinks.push({ label: 'Substack', href: siteConfig.substackUrl });
{
  const linkHtml = (l: { label: string; href: string }) =>
    `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}<span class="sr-only"> (opens in a new tab)</span></a>`;
  $('about-links').innerHTML = `<span>By ${esc(siteConfig.authorName)}</span>${profileLinks
    .map((l) => `<span aria-hidden="true">·</span>${linkHtml(l)}`)
    .join('')}`;
  const rail = $('rail-links');
  rail.hidden = !profileLinks.length;
  rail.innerHTML = `<p class="rail-links-title">${esc(siteConfig.authorName)} elsewhere</p><ul>${profileLinks
    .map((l) => `<li>${linkHtml(l)}<span aria-hidden="true"> ↗</span></li>`)
    .join('')}</ul>`;
}
if (ds.sample) {
  const msg = 'Example posts only — this is a preview. Your own posts will appear after you choose what to publish.';
  els.sampleBanner.textContent = msg;
  els.sampleBanner.hidden = false;
  $('about-note').textContent = 'This preview uses example posts. Your writing stays out of the site until you choose what to publish.';
}

// ---------------------------------------------------------------- URL state

function readUrl(): State {
  const params = new URLSearchParams(location.search);
  const lens: Lens = params.get('lens') === 'tone' || params.get('lens') === 'tones' ? 'tones' : 'themes';
  return { lens, tag: params.get('tag'), q: params.get('q') ?? '' };
}

function writeUrl(s: State, mode: 'push' | 'replace') {
  const params = new URLSearchParams();
  if (s.lens === 'tones') params.set('lens', 'tone');
  if (s.tag) params.set('tag', s.tag);
  if (s.q.trim()) params.set('q', s.q.trim());
  const qs = params.toString();
  const url = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
  if (url === `${location.pathname}${location.search}${location.hash}`) return;
  try {
    history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
  } catch {
    // Some embedded/sandboxed frames refuse history changes; the UI still works without URL sync.
  }
}

function sanitize(s: State): State {
  const lens: Lens = s.lens === 'tones' ? 'tones' : 'themes';
  const tag = s.tag && ds.graphs[lens].nodes.some((n) => n.id === s.tag) ? s.tag : null;
  return { lens, tag, q: s.q ?? '' };
}

// ---------------------------------------------------------------- render

let renderedLens: Lens | null = null;

function update(patch: Partial<State>, historyMode: 'push' | 'replace' | 'none') {
  const prev = state;
  const next = sanitize({ ...state, ...patch });
  state = next;
  if (historyMode !== 'none') writeUrl(next, historyMode);
  render(prev);
}

function render(prev: State | null) {
  const { lens } = state;
  const lensGraph = ds.graphs[lens];
  const q = normalizeQuery(state.q);
  const result = search(ds, lens, q);

  if (renderedLens !== lens) {
    renderedLens = lens;
    graph.setData(lensGraph, ds.sample);
  }
  graph.setRelated(result ? result.relatedTags : null);
  graph.setSelected(state.tag);

  // tabs
  for (const t of els.lensTabs) t.setAttribute('aria-pressed', String(t.dataset.lens === lens));

  // search field
  if (els.searchInput.value !== state.q) els.searchInput.value = state.q;
  els.searchClear.hidden = !state.q;
  document.body.classList.toggle('has-query', !!state.q);

  renderRail(result?.relatedTags ?? null, q);
  renderStage(result?.relatedTags ?? null, q);
  renderPanel(q, result?.matchingPostIds ?? null, prev);
}

function renderRail(related: Set<string> | null, q: string) {
  const { lens } = state;
  const lg = ds.graphs[lens];
  const words = LENS_WORD[lens];
  els.railTitle.textContent = words.title;

  const tagged = ds.posts.length - lg.untagged;
  const totalTagUses = lg.nodes.reduce((s, n) => s + n.count, 0);
  els.railStats.innerHTML = lg.nodes.length
    ? `${lg.nodes.length} ${lg.nodes.length === 1 ? words.one : words.many} · ${postCountLabel(ds.posts.length)}` +
      (totalTagUses > tagged
        ? `<span class="rail-note">Posts can carry more than one ${words.one}, so counts overlap.</span>`
        : '')
    : plural(ds.posts.length, 'post');

  // Rebuild rows only when the lens changes; otherwise toggle state in place.
  if (els.tagList.dataset.lens !== lens) {
    els.tagList.dataset.lens = lens;
    els.tagList.innerHTML = lg.nodes
      .map(
        (n) => `<li><button type="button" class="tag-row" data-id="${esc(n.id)}" aria-pressed="false" title="${esc(n.description ? `${n.label}: ${n.description}` : n.label)}">
          <span class="tag-dot" style="--dot:${esc(n.color)}" aria-hidden="true"></span>
          <span class="tag-name">${esc(n.label)}</span>
          <span class="tag-count" aria-label="${postCountLabel(n.count)}">${n.count}</span>
        </button></li>`,
      )
      .join('');
  }

  let visible = 0;
  for (const btn of els.tagList.querySelectorAll<HTMLButtonElement>('.tag-row')) {
    const id = btn.dataset.id!;
    const show = !related || related.has(id);
    (btn.parentElement as HTMLElement).hidden = !show;
    if (show) visible++;
    btn.setAttribute('aria-pressed', String(id === state.tag));
    btn.classList.toggle('is-selected', id === state.tag);
  }

  if (!lg.nodes.length) {
    els.railEmpty.hidden = false;
    els.railEmpty.textContent = ds.posts.length ? `No ${words.many} tagged yet.` : 'No posts yet.';
  } else if (related && visible === 0) {
    els.railEmpty.hidden = false;
    els.railEmpty.textContent = `No ${words.many} match “${q}”.`;
  } else {
    els.railEmpty.hidden = true;
  }

  const foot: string[] = [];
  if (lg.untagged > 0 && lg.nodes.length) {
    foot.push(`${plural(lg.untagged, 'post')} ${lg.untagged === 1 ? 'has' : 'have'} no ${words.one} yet and ${lg.untagged === 1 ? 'is' : 'are'} not on this graph.`);
  }
  if (ds.validation.skipped > 0) {
    foot.push(`${plural(ds.validation.skipped, 'post')} skipped because of invalid data. Run <code>npm run validate</code> for details.`);
  }
  els.railFoot.innerHTML = foot.map((f) => `<p>${f}</p>`).join('');
}

function renderStage(related: Set<string> | null, q: string) {
  const { lens } = state;
  const lg = ds.graphs[lens];
  const words = LENS_WORD[lens];
  let html = '';
  let blocking = false;

  if (!ds.validation.ok) {
    blocking = true;
    html = `<h2>The post data could not be read</h2>
      <p>Check <code>content/posts.json</code> and <code>content/taxonomy.json</code> against the schema in the README, or run <code>npm run validate</code>.</p>
      <ul class="error-list">${ds.validation.errors.slice(0, 5).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
  } else if (!ds.posts.length) {
    blocking = true;
    html = `<h2>No posts yet</h2>
      <p>Add posts to <code>content/posts.json</code>, or import them from your X archive with <code>npm run import:x</code>. The README walks through both.</p>`;
  } else if (!lg.nodes.length) {
    blocking = true;
    html = `<h2>No ${words.many} tagged yet</h2>
      <p>${plural(ds.posts.length, 'post')} ${ds.posts.length === 1 ? 'is' : 'are'} loaded, but none has a ${words.one}. Add ${words.one} ids to each post's <code>"${lens}"</code> list in <code>content/posts.json</code>.</p>`;
  } else if (related && related.size === 0) {
    html = `<h2>Nothing matches “${esc(q)}”</h2>
      <p>No ${words.one} name or post text contains that. Try a shorter word, or switch to ${lens === 'themes' ? 'Tone' : 'Themes'}.</p>
      <button type="button" class="pill-btn" data-action="clear-search">Clear search</button>`;
  }

  els.stageMessage.hidden = !html;
  els.stageMessage.innerHTML = html;
  els.stageMessage.classList.toggle('is-blocking', blocking);
  els.stage.classList.toggle('is-empty', blocking);
}

function renderPanel(q: string, matching: Set<string> | null, prev: State | null) {
  const node = state.tag ? ds.graphs[state.lens].nodes.find((n) => n.id === state.tag) : undefined;
  const wasOpen = !els.panel.hidden;

  if (!node) {
    if (wasOpen) closePanelDom();
    return;
  }

  const words = LENS_WORD[state.lens];
  const all = node.postIds.map((id) => ds.byId.get(id)!).filter(Boolean);
  const labelHit = tagLabelMatches(node, q);
  const shown = q && !labelHit ? all.filter((p) => matching?.has(p.id) ?? postMatches(p, q)) : all;

  els.panelKicker.innerHTML = `<span class="tag-dot" style="--dot:${esc(node.color)}" aria-hidden="true"></span>${words.title === 'Tone' ? 'Tone' : 'Theme'}`;
  els.panelTitle.textContent = node.label;
  els.panelMeta.textContent = q && !labelHit
    ? `${shown.length} of ${postCountLabel(all.length)} mention “${state.q.trim()}”`
    : postCountLabel(all.length);

  let body = '';
  if (node.description) body += `<p class="panel-desc">${esc(node.description)}</p>`;
  if (!shown.length) {
    body += `<div class="panel-empty"><p>None of the posts under <em>${esc(node.label)}</em> mention “${esc(state.q.trim())}”.</p>
      <button type="button" class="pill-btn" data-action="clear-search">Clear search</button></div>`;
  } else {
    body += renderCards(orderPosts(shown), q, node);
  }
  els.panelBody.innerHTML = body;
  wireMedia(els.panelBody);
  markOverflowingText(els.panelBody);

  const tagChanged = !prev || prev.tag !== state.tag || prev.lens !== state.lens;
  if (tagChanged) els.panelBody.scrollTop = 0;
  if (!wasOpen) openPanelDom();
  if (tagChanged) graph.revealNode(node.id, panelInsets());
}

/** The part of the graph covered by the open post panel, so the selected circle can be kept visible. */
function panelInsets() {
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  if (els.panel.hidden) return insets;
  if (isMobile()) insets.bottom = els.panel.offsetHeight;
  else insets.right = els.panel.offsetWidth + 24;
  return insets;
}

/** Areas of the canvas covered by the legend, banner and zoom buttons; "fit" keeps circles clear of them. */
function overlayInsets() {
  const stage = els.stage.getBoundingClientRect();
  const top = els.sampleBanner.hidden ? 0 : els.sampleBanner.getBoundingClientRect().bottom - stage.top;
  const bottom = stage.bottom - Math.min(els.legend.getBoundingClientRect().top, $('zoom-in').getBoundingClientRect().top);
  return { top: Math.max(0, top), right: 0, bottom: Math.max(0, bottom), left: 0 };
}

function renderCards(posts: Post[], q: string, current: GraphNode): string {
  let html = '';
  let i = 0;
  while (i < posts.length) {
    const p = posts[i];
    if (p.threadId) {
      const group: Post[] = [];
      while (i < posts.length && posts[i].threadId === p.threadId) group.push(posts[i++]);
      if (group.length > 1) {
        html += `<div class="thread-group" role="group" aria-label="Thread, ${group.length} parts shown">
          <p class="thread-label">Thread</p>${group.map((g) => card(g, q, current)).join('')}</div>`;
      } else {
        html += card(group[0], q, current);
      }
    } else {
      html += card(p, q, current);
      i++;
    }
  }
  return html;
}

function card(p: Post, q: string, current: GraphNode): string {
  const date = new Date(p.publishedAt);
  const source = ({ x: 'X', substack: 'Substack', linkedin: 'LinkedIn' } as Record<string, string>)[p.platform] ?? p.platform;
  const threadTotal = p.threadId ? threadSizes.get(p.threadId) : undefined;
  const threadBadge =
    p.threadId && p.sequence ? `<span class="meta-thread">${p.sequence}${threadTotal && threadTotal >= p.sequence ? ` of ${threadTotal}` : ''} in thread</span>` : '';

  let content = '';
  if (p.title) {
    content += `<h3 class="card-title">${highlight(p.title, q)}</h3>`;
    const preview = p.excerpt ?? p.text;
    if (preview) content += `<p class="card-excerpt">${highlight(truncate(preview, 260), q)}</p>`;
  } else {
    // X posts: text first, no invented headline.
    content += `<p class="card-text">${highlight(p.text, q)}</p>
      <button type="button" class="more-btn" data-action="expand" hidden>Show more</button>`;
  }

  const media = (p.media ?? [])
    .slice(0, 1)
    .map((m) =>
      m.type === 'image'
        ? `<figure class="card-media"><img src="${esc(m.url)}" alt="${esc(m.alt ?? '')}" loading="lazy" decoding="async" /></figure>`
        : `<p class="media-note">${m.type === 'video' ? 'Video' : 'GIF'} attached. Open the original to watch.</p>`,
    )
    .join('');

  // Other tags (same lens) on this post: one tap jumps to them.
  const lens: Lens = state.lens;
  const chips = p[lens]
    .filter((id) => id !== current.id && ds.graphs[lens].nodes.some((n) => n.id === id))
    .map((id) => {
      const n = ds.taxonomy[lens].get(id)!;
      return `<button type="button" class="chip" data-action="select-tag" data-id="${esc(id)}"><span class="tag-dot" style="--dot:${esc(n.color)}" aria-hidden="true"></span>${esc(n.label)}</button>`;
    })
    .join('');

  const link = p.url
    ? `<a class="card-link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${p.platform === 'substack' ? `Read on ${source}` : `View on ${source}`}<span aria-hidden="true"> ↗</span><span class="sr-only"> (opens in a new tab)</span></a>`
    : `<span class="card-link is-disabled">Sample post · no original</span>`;

  return `<article class="card card--${esc(p.platform)}${ds.sample ? ' card--sample' : ''}">
    <div class="card-meta">
      ${ds.sample ? '<span class="badge badge--sample">Sample</span>' : ''}
      <span class="badge badge--${esc(p.platform)}">${esc(source)}</span>
      <time datetime="${esc(p.publishedAt)}">${dateFmt.format(date)}</time>
      ${threadBadge}
    </div>
    ${content}
    ${media}
    ${chips ? `<div class="card-chips" aria-label="Also tagged">${chips}</div>` : ''}
    <div class="card-foot">${link}</div>
  </article>`;
}

function wireMedia(root: HTMLElement) {
  for (const img of root.querySelectorAll<HTMLImageElement>('.card-media img')) {
    const fail = () => {
      const fig = img.closest('figure');
      if (fig) fig.outerHTML = '<p class="media-note">Image unavailable.</p>';
    };
    if (img.complete && img.naturalWidth === 0 && img.src) fail();
    else img.addEventListener('error', fail, { once: true });
  }
}

function markOverflowingText(root: HTMLElement) {
  requestAnimationFrame(() => {
    for (const t of root.querySelectorAll<HTMLElement>('.card-text')) {
      const btn = t.nextElementSibling as HTMLButtonElement | null;
      if (btn && t.scrollHeight > t.clientHeight + 4) btn.hidden = false;
    }
  });
}

// ---------------------------------------------------------------- panel + drawer

function openPanelDom() {
  els.panel.hidden = false;
  document.body.classList.add('panel-open');
  requestAnimationFrame(() => els.panel.classList.add('is-open'));
}

function closePanelDom() {
  els.panel.classList.remove('is-open');
  document.body.classList.remove('panel-open');
  els.panel.hidden = true;
  els.panelBody.innerHTML = '';
  // Return focus to where the user came from, if it still exists.
  const active = document.activeElement;
  if (!active || active === document.body || els.panel.contains(active)) {
    const target = returnFocusTo;
    returnFocusTo = null;
    if (target) {
      const row = els.tagList.querySelector<HTMLButtonElement>(`.tag-row[data-id="${CSS.escape(target)}"]`);
      if (row && row.offsetParent && !isMobile()) row.focus({ preventScroll: true });
      else graph.focusNode(target);
    }
  }
}

function selectTag(id: string, moveFocus: boolean) {
  const toggleOff = state.tag === id;
  update({ tag: toggleOff ? null : id }, 'push');
  if (drawerOpen) setDrawer(false);
  if (!toggleOff && moveFocus) els.panelTitle.focus({ preventScroll: true });
}

function setDrawer(open: boolean) {
  drawerOpen = open;
  document.body.classList.toggle('drawer-open', open);
  els.scrim.hidden = !open;
  for (const el of [els.stage, els.panel, els.topbar]) {
    if (open) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }
  syncMenuButton();
  if (open) (els.tagList.querySelector<HTMLButtonElement>('li:not([hidden]) .tag-row') ?? els.railClose).focus();
  else if (isMobile()) els.menuBtn.focus({ preventScroll: true });
}

function setRailCollapsed(collapsed: boolean) {
  railCollapsed = collapsed;
  document.body.classList.toggle('rail-collapsed', collapsed);
  syncMenuButton();
}

function syncMenuButton() {
  const expanded = isMobile() ? drawerOpen : !railCollapsed;
  els.menuBtn.setAttribute('aria-expanded', String(expanded));
  els.menuBtnLabel.textContent = expanded ? 'Hide tag list' : 'Show tag list';
}

// ---------------------------------------------------------------- events

els.menuBtn.addEventListener('click', () => {
  if (isMobile()) setDrawer(!drawerOpen);
  else setRailCollapsed(!railCollapsed);
});
els.railClose.addEventListener('click', () => setDrawer(false));
els.scrim.addEventListener('click', () => setDrawer(false));
mobileQuery.addEventListener('change', () => {
  if (!isMobile() && drawerOpen) setDrawer(false);
  syncMenuButton();
});

for (const tab of els.lensTabs) {
  tab.addEventListener('click', () => {
    const lens = tab.dataset.lens as Lens;
    if (lens !== state.lens) update({ lens, tag: null }, 'push');
  });
}

els.tagList.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.tag-row');
  if (!btn) return;
  returnFocusTo = btn.dataset.id!;
  selectTag(btn.dataset.id!, e.detail === 0);
});

let searchTimer: number | undefined;
let searchPushed = false; // first keystroke of a search session creates one history entry
els.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  window.clearTimeout(searchTimer);
  update({ q: els.searchInput.value }, 'replace');
  if (isMobile()) els.searchInput.blur();
});
els.searchInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  const value = els.searchInput.value;
  els.searchClear.hidden = !value;
  searchTimer = window.setTimeout(() => {
    const mode = searchPushed ? 'replace' : 'push';
    searchPushed = !!value;
    update({ q: value }, value ? mode : 'replace');
  }, 140);
});
els.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.searchInput.value) {
    e.preventDefault();
    e.stopPropagation();
    clearSearch();
  }
});
els.searchClear.addEventListener('click', () => {
  clearSearch();
  els.searchInput.focus();
});
function clearSearch() {
  window.clearTimeout(searchTimer);
  searchPushed = false;
  update({ q: '' }, 'replace');
}

els.searchToggle.addEventListener('click', () => {
  const open = !document.body.classList.contains('search-open');
  document.body.classList.toggle('search-open', open);
  els.searchToggle.setAttribute('aria-expanded', String(open));
  if (open) els.searchInput.focus();
});

els.aboutBtn.addEventListener('click', () => els.about.showModal());
els.about.addEventListener('click', (e) => {
  if (e.target === els.about) els.about.close(); // click on backdrop
});

els.panelClose.addEventListener('click', () => update({ tag: null }, 'push'));

document.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'clear-search') {
    clearSearch();
  } else if (action === 'select-tag' && target.dataset.id) {
    returnFocusTo = target.dataset.id;
    update({ tag: target.dataset.id }, 'push');
    els.panelTitle.focus({ preventScroll: true });
  } else if (action === 'expand') {
    const text = target.previousElementSibling as HTMLElement;
    const expanded = text.classList.toggle('is-expanded');
    target.textContent = expanded ? 'Show less' : 'Show more';
  }
});

$('zoom-in').addEventListener('click', () => graph.zoomBy(1.3));
$('zoom-out').addEventListener('click', () => graph.zoomBy(1 / 1.3));
$('zoom-fit').addEventListener('click', () => graph.fit(true));

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || els.about.open) return;
  if (drawerOpen) setDrawer(false);
  else if (state.tag) update({ tag: null }, 'push');
  else if (document.body.classList.contains('search-open') && !state.q) {
    document.body.classList.remove('search-open');
    els.searchToggle.setAttribute('aria-expanded', 'false');
  }
});

window.addEventListener('popstate', () => {
  window.clearTimeout(searchTimer);
  searchPushed = false;
  update(readUrl(), 'none');
});

// Keep the mobile sheet below the header.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--header-h', `${els.topbar.offsetHeight}px`);
}).observe(els.topbar);

// ---------------------------------------------------------------- helpers

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function highlight(text: string, q: string): string {
  if (!q) return esc(text);
  const re = queryRegExp(q);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = (m.index ?? 0) + m[1].length;
    out += esc(text.slice(last, start)) + `<mark>${esc(m[2])}</mark>`;
    last = start + m[2].length;
  }
  return out + esc(text.slice(last));
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function postCountLabel(n: number) {
  return plural(n, ds.sample ? 'sample post' : 'post');
}

// ---------------------------------------------------------------- boot

state = sanitize(readUrl());
writeUrl(state, 'replace'); // drop invalid params (e.g. a tag that no longer exists)
syncMenuButton();
render(null);
