"use strict";

const PAGE_SIZE = 100;
const SORTS = ["date", "platform", "product", "use"];

const numberFormat = new Intl.NumberFormat("en-US");
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const pacificTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const emptyEl = document.getElementById("empty");
const panelTop = document.getElementById("panel-top");
const panelPosts = document.getElementById("panel-posts");
const tabTop = document.getElementById("tab-top");
const tabPosts = document.getElementById("tab-posts");
const tabList = document.querySelector(".tabs");
const productFilter = document.getElementById("product-filter");
const caption = document.getElementById("caption");
const chart = document.getElementById("chart");
const chartEmpty = document.getElementById("chart-empty");
const detailBody = document.getElementById("detail-body");
const detailLabel = document.getElementById("detail-label");
const detailDef = document.getElementById("detail-def");
const detailLink = document.getElementById("detail-link");
const playButton = document.getElementById("play");
const dateInput = document.getElementById("date");
const dateLabel = document.getElementById("date-label");
const postsEmpty = document.getElementById("posts-empty");
const postsTools = document.getElementById("posts-tools");
const matchCount = document.getElementById("match-count");
const postsBody = document.getElementById("posts-body");
const postsTableWrap = document.getElementById("posts-table-wrap");
const pager = document.getElementById("pager");
const pageLabel = document.getElementById("page-label");
const prevButton = document.getElementById("prev");
const nextButton = document.getElementById("next");
const platformSelect = document.getElementById("f-platform");
const productSelect = document.getElementById("f-product");
const useSelect = document.getElementById("f-use");
const quoteInput = document.getElementById("f-q");
const about = document.getElementById("about");

const state = {
  tab: "top",
  product: "all",
  dateIndex: 0,
  playing: false,
  scrubbing: false,
  platform: "",
  postProduct: "",
  use: "",
  q: "",
  sort: "date",
  dir: "desc",
  page: 1,
  selectedCode: "",
};

const rowEls = new Map();
const retireTimers = new WeakMap();
const snapshotCache = new Map();
const productById = new Map();
const taxonomyByCode = new Map();

let index = null;
let taxonomy = null;
let posts = [];
let postsMissing = true;
let dates = [];
let productIds = [];
let lastItems = [];
let cachedRowH = 44;
let renderToken = 0;
let scrubRaf = 0;
let resizeRaf = 0;
let playTimer = 0;
let hashTimer = 0;
let applyingHash = false;
let ready = false;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatInt(value) {
  return numberFormat.format(Math.round(num(value)));
}

function countPhrase(value, singular, plural) {
  const n = Math.max(0, Math.round(num(value)));
  return numberFormat.format(n) + " " + (n === 1 ? singular : plural);
}

function formatShare(share, fraction) {
  const pct = fraction ? share * 100 : share;
  if (!Number.isFinite(pct)) return "";
  const rounded = Math.round(pct * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)) + "%";
}

function formatPacific(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return pacificTime.format(date);
}

function safeUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
  } catch (error) {
    return "";
  }
  return "";
}

function motionMs() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return 0;
  if (state.playing) return 420;
  if (state.scrubbing) return 100;
  return 280;
}

function setMotion(ms) {
  const style = document.documentElement.style;
  style.setProperty("--move", ms + "ms");
  style.setProperty("--fade", Math.min(ms, 200) + "ms");
}

function measureRowH() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--row-h");
  const parsed = parseFloat(raw);
  cachedRowH = Number.isFinite(parsed) ? parsed : 44;
}

function productName(id) {
  const product = productById.get(id);
  return (product && product.name) || id || "";
}

function useLabel(code) {
  const category = taxonomyByCode.get(code);
  return (category && category.label) || code || "";
}

function productsInOrder() {
  return productIds.map((id) => ({ id: id, name: productName(id) }));
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

function loadSnapshot(date) {
  if (!snapshotCache.has(date)) {
    const job = fetch("data/snapshots/" + encodeURIComponent(date) + ".json")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .catch((error) => {
        snapshotCache.delete(date);
        throw error;
      });
    snapshotCache.set(date, job);
  }
  return snapshotCache.get(date);
}

function prefetchAll() {
  let cursor = 0;
  const queue = dates.slice();
  async function worker() {
    while (cursor < queue.length) {
      const date = queue[cursor];
      cursor += 1;
      try {
        await loadSnapshot(date);
      } catch (error) {
        /* A later view of this date reports the miss. */
      }
    }
  }
  worker();
  worker();
  worker();
  worker();
}

function showEmpty() {
  emptyEl.hidden = false;
  panelTop.hidden = true;
  panelPosts.hidden = true;
  about.hidden = true;
  document.querySelector(".tabs-bar").hidden = true;
}

function showTab(tab) {
  state.tab = tab === "posts" ? "posts" : "top";
  const top = state.tab === "top";
  panelTop.hidden = !top;
  panelPosts.hidden = top;
  emptyEl.hidden = true;
  tabTop.setAttribute("aria-selected", top ? "true" : "false");
  tabPosts.setAttribute("aria-selected", top ? "false" : "true");
  tabTop.tabIndex = top ? 0 : -1;
  tabPosts.tabIndex = top ? -1 : 0;
}

function setPostsAvailable(ok) {
  postsMissing = !ok;
  postsEmpty.hidden = ok;
  postsTools.hidden = !ok;
  postsTableWrap.hidden = !ok;
  matchCount.hidden = !ok;
  if (!ok) pager.hidden = true;
}

function buildSegment() {
  productFilter.replaceChildren();
  const items = [{ id: "all", name: "All products" }].concat(productsInOrder());
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "radio");
    button.dataset.product = item.id;
    button.textContent = item.name;
    productFilter.append(button);
  }
  syncSegment();
}

function syncSegment() {
  const buttons = productFilter.querySelectorAll("button");
  buttons.forEach((button) => {
    const on = button.dataset.product === state.product;
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.tabIndex = on ? 0 : -1;
  });
}

function selectProduct(id) {
  if (!id || state.product === id) return;
  state.product = id;
  syncSegment();
  updateDetailLink();
  showCurrent(true);
  writeHash();
}

function syncSlider() {
  const last = Math.max(dates.length - 1, 0);
  dateInput.min = "0";
  dateInput.max = String(last);
  dateInput.value = String(Math.min(Math.max(state.dateIndex, 0), last));
  const date = dates[state.dateIndex] || "";
  dateInput.setAttribute("aria-valuetext", date);
  dateLabel.textContent = date;
  playButton.disabled = dates.length < 2;
}

function stopPlay() {
  state.playing = false;
  if (playTimer) {
    clearTimeout(playTimer);
    playTimer = 0;
  }
  playButton.textContent = "Play";
  playButton.setAttribute("aria-pressed", "false");
}

function playStep() {
  if (!state.playing) return;
  if (state.dateIndex >= dates.length - 1) {
    stopPlay();
    writeHash();
    return;
  }
  state.dateIndex += 1;
  state.scrubbing = false;
  syncSlider();
  showCurrent(true);
  writeHash();
  playTimer = setTimeout(playStep, 700);
}

function startPlay() {
  if (dates.length < 2) return;
  if (state.playing) {
    stopPlay();
    return;
  }
  if (state.dateIndex >= dates.length - 1) {
    state.dateIndex = 0;
    syncSlider();
    showCurrent(true);
  }
  state.playing = true;
  playButton.textContent = "Pause";
  playButton.setAttribute("aria-pressed", "true");
  playTimer = setTimeout(playStep, 700);
}

function createRow(code) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "row";
  row.dataset.code = code;
  row.setAttribute("aria-pressed", "false");
  ["rank", "name"].forEach((name) => {
    const span = document.createElement("span");
    span.className = name;
    row.append(span);
  });
  const track = document.createElement("span");
  track.className = "track";
  const fill = document.createElement("span");
  fill.className = "fill";
  track.append(fill);
  row.append(track);
  ["count", "share"].forEach((name) => {
    const span = document.createElement("span");
    span.className = name;
    row.append(span);
  });
  return row;
}

function placeAfter(previous, el) {
  if (previous.nextElementSibling !== el) previous.after(el);
}

function renderBars(items, ms) {
  setMotion(ms);
  const seen = new Set();
  const list = [];
  (items || []).forEach((item) => {
    if (!item || typeof item.code !== "string" || !item.code || seen.has(item.code)) return;
    seen.add(item.code);
    list.push(item);
  });
  if (list.length > 15) list.length = 15;
  lastItems = list;
  chartEmpty.hidden = list.length > 0;
  chartEmpty.textContent = "None";

  const maxCount = list.reduce((max, item) => Math.max(max, num(item.count)), 0);
  const fraction = list.every((item) => num(item.share) <= 1);
  const height = Math.max(list.length, 1) * cachedRowH;
  if (chart._h !== height) {
    chart.style.height = height + "px";
    chart._h = height;
  }

  rowEls.forEach((el, code) => {
    if (!seen.has(code)) retireRow(el, code, ms);
  });

  const entering = [];
  let previous = chartEmpty;
  list.forEach((item, index) => {
    let el = rowEls.get(item.code);
    const isNew = !el || !el.isConnected;
    if (isNew) {
      el = createRow(item.code);
      rowEls.set(item.code, el);
      chart.append(el);
    } else {
      const timer = retireTimers.get(el);
      if (timer) {
        clearTimeout(timer);
        retireTimers.delete(el);
      }
      el.dataset.leaving = "";
      el.removeAttribute("aria-hidden");
      el.removeAttribute("tabindex");
      delete el.dataset.enter;
    }
    const shareText = formatShare(num(item.share), fraction);
    el.querySelector(".rank").textContent = String(index + 1);
    el.querySelector(".name").textContent = item.label || useLabel(item.code);
    el.querySelector(".count").textContent = formatInt(item.count);
    el.querySelector(".share").textContent = shareText;
    const on = item.code === state.selectedCode;
    el.classList.toggle("is-on", on);
    el.setAttribute("aria-pressed", on ? "true" : "false");
    const y = index * cachedRowH;
    const scale = maxCount > 0 ? num(item.count) / maxCount : 0;
    const fill = el.querySelector(".fill");
    placeAfter(previous, el);
    previous = el;
    if (isNew && ms > 0) {
      el.classList.add("no-move");
      el.style.opacity = "0";
      el.style.transform = "translate3d(0," + y + "px,0)";
      fill.style.transform = "scaleX(0)";
      el.dataset.y = String(y);
      el.dataset.scale = String(scale);
      el.dataset.enter = "1";
      entering.push(el);
    } else {
      el.classList.remove("no-move");
      el.style.opacity = "1";
      el.style.transform = "translate3d(0," + y + "px,0)";
      fill.style.transform = "scaleX(" + scale + ")";
    }
  });

  if (!entering.length) return;
  chart.getBoundingClientRect();
  requestAnimationFrame(() => {
    entering.forEach((el) => {
      if (el.dataset.enter !== "1" || !el.isConnected || el.dataset.leaving === "1") return;
      el.dataset.enter = "";
      el.classList.remove("no-move");
      el.style.opacity = "1";
      el.style.transform = "translate3d(0," + el.dataset.y + "px,0)";
      const fill = el.querySelector(".fill");
      fill.style.transform = "scaleX(" + el.dataset.scale + ")";
    });
  });
}

function retireRow(el, code, ms) {
  el.dataset.leaving = "1";
  el.dataset.enter = "";
  el.setAttribute("aria-hidden", "true");
  el.tabIndex = -1;
  el.classList.remove("is-on");
  el.setAttribute("aria-pressed", "false");
  if (ms <= 0) el.classList.add("no-move");
  el.style.opacity = "0";
  const previous = retireTimers.get(el);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    if (el.dataset.leaving !== "1") return;
    el.remove();
    if (rowEls.get(code) === el) rowEls.delete(code);
  }, ms + 70);
  retireTimers.set(el, timer);
}

function showDetail(code) {
  if (!code) return;
  state.selectedCode = code;
  const category = taxonomyByCode.get(code);
  const item = lastItems.find((row) => row.code === code);
  detailBody.hidden = false;
  detailLabel.textContent = (category && category.label) || (item && item.label) || code;
  detailDef.textContent = (category && category.definition) || "No definition.";
  updateDetailLink();
  rowEls.forEach((el) => {
    const on = el.dataset.code === code && el.dataset.leaving !== "1";
    el.classList.toggle("is-on", on);
    if (el.dataset.leaving !== "1") el.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function updateDetailLink() {
  if (!state.selectedCode) return;
  detailLink.href = postsHref(state.product, state.selectedCode);
}

function postsHref(product, code) {
  const params = new URLSearchParams();
  if (product && product !== "all") params.set("product", product);
  if (code) params.set("use", code);
  const query = params.toString();
  return "#posts" + (query ? "?" + query : "");
}

function onRowIntent(event) {
  const row = event.target.closest(".row");
  if (!row || row.dataset.leaving === "1") return;
  if (row.dataset.code !== state.selectedCode) showDetail(row.dataset.code);
}

async function showCurrent(animate) {
  const token = ++renderToken;
  const date = dates[state.dateIndex];
  if (!date) return;
  let snap;
  try {
    snap = await loadSnapshot(date);
  } catch (error) {
    if (token !== renderToken) return;
    caption.textContent = "Snapshot unavailable · " + date;
    chartEmpty.hidden = false;
    chartEmpty.textContent = "No data yet";
    return;
  }
  if (token !== renderToken) return;
  const key = state.product && state.product !== "all" ? state.product : "all";
  const totals = snap && snap.totals ? snap.totals[key] : null;
  const rows = snap && snap.top15 && Array.isArray(snap.top15[key]) ? snap.top15[key] : [];
  const when = (snap && snap.date) || date;
  if (totals && Number.isFinite(Number(totals.posts)) && Number.isFinite(Number(totals.use_case_posts))) {
    caption.textContent =
      countPhrase(totals.posts, "post", "posts") +
      " / " +
      countPhrase(totals.use_case_posts, "use-case post", "use-case posts") +
      " · " +
      when;
  } else {
    caption.textContent = "No counts · " + when;
  }
  renderBars(rows, animate ? motionMs() : 0);
}

function fillSelect(select, options, allLabel) {
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "";
  all.textContent = allLabel;
  select.append(all);
  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.append(node);
  });
}

function ensureOption(select, value) {
  if (!value) return;
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (exists) return;
  const node = document.createElement("option");
  node.value = value;
  node.textContent = value;
  select.append(node);
}

function buildFilters() {
  const platforms = [];
  const seenPlatforms = new Set();
  posts.forEach((post) => {
    const platform = post.post_platform;
    if (!platform || seenPlatforms.has(platform)) return;
    seenPlatforms.add(platform);
    platforms.push(platform);
  });
  platforms.sort((a, b) => collator.compare(a, b));
  fillSelect(
    platformSelect,
    platforms.map((platform) => ({ value: platform, label: platform })),
    "All platforms"
  );
  fillSelect(
    productSelect,
    productsInOrder().map((product) => ({ value: product.id, label: product.name })),
    "All products"
  );
  let uses = [];
  if (taxonomy && Array.isArray(taxonomy.categories)) {
    uses = taxonomy.categories
      .filter((category) => category && category.code)
      .map((category) => ({ value: category.code, label: category.label || category.code }));
    uses.sort((a, b) => collator.compare(a.label, b.label));
  }
  const known = new Set(uses.map((item) => item.value));
  posts.forEach((post) => {
    (post.use_cases || []).forEach((code) => {
      if (!code || known.has(code)) return;
      known.add(code);
      uses.push({ value: code, label: code });
    });
  });
  fillSelect(useSelect, uses, "All use cases");
}

function preparePosts() {
  posts.forEach((post) => {
    post._q = String(post.quote || "").toLowerCase();
    post._name = productName(post.agent_product);
    post._use = (Array.isArray(post.use_cases) ? post.use_cases : []).map(useLabel).join(", ");
  });
}

function filterPosts() {
  const query = state.q.trim().toLowerCase();
  return posts.filter((post) => {
    if (state.platform && post.post_platform !== state.platform) return false;
    if (state.postProduct && post.agent_product !== state.postProduct) return false;
    if (state.use && !(post.use_cases || []).includes(state.use)) return false;
    if (query && !post._q.includes(query)) return false;
    return true;
  });
}

function sortKey(post) {
  if (state.sort === "platform") return post.post_platform || "";
  if (state.sort === "product") return post._name || "";
  if (state.sort === "use") return post._use || "";
  return post.date || "";
}

function sortPosts(list) {
  const dir = state.dir === "asc" ? 1 : -1;
  return list
    .map((post, index) => ({ post: post, index: index, key: sortKey(post) }))
    .sort((a, b) => {
      const cmp = collator.compare(String(a.key), String(b.key));
      return cmp === 0 ? a.index - b.index : cmp * dir;
    })
    .map((row) => row.post);
}

function cell(text, nowrap) {
  const td = document.createElement("td");
  if (nowrap) td.className = "nowrap";
  td.textContent = text;
  return td;
}

function renderPostRow(post) {
  const tr = document.createElement("tr");
  tr.append(cell(post.date || "", true));
  tr.append(cell(post.post_platform || "", true));
  tr.append(cell(post._name || "", true));
  tr.append(cell(post._use || ""));
  const quoteCell = document.createElement("td");
  const quote = document.createElement("p");
  quote.className = "quote";
  quote.textContent = post.quote || "";
  quoteCell.append(quote);
  if (post.author) {
    const author = document.createElement("p");
    author.className = "author";
    author.textContent = post.author;
    quoteCell.append(author);
  }
  tr.append(quoteCell);
  const linkCell = document.createElement("td");
  const href = safeUrl(post.url);
  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Post";
    linkCell.append(link);
  }
  tr.append(linkCell);
  return tr;
}

function syncSortHeaders() {
  document.querySelectorAll("thead th[data-sort]").forEach((th) => {
    if (th.dataset.sort === state.sort) {
      th.setAttribute("aria-sort", state.dir === "asc" ? "ascending" : "descending");
    } else {
      th.setAttribute("aria-sort", "none");
    }
  });
}

function syncPostControls() {
  ensureOption(platformSelect, state.platform);
  ensureOption(productSelect, state.postProduct);
  ensureOption(useSelect, state.use);
  platformSelect.value = state.platform;
  productSelect.value = state.postProduct;
  useSelect.value = state.use;
  if (quoteInput.value !== state.q) quoteInput.value = state.q;
}

function renderPosts() {
  if (postsMissing) return;
  const matched = sortPosts(filterPosts());
  const pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  if (state.page > pages) state.page = pages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * PAGE_SIZE;
  const slice = matched.slice(start, start + PAGE_SIZE);
  matchCount.textContent = countPhrase(matched.length, "post", "posts");
  const fragment = document.createDocumentFragment();
  if (!slice.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No posts";
    tr.append(td);
    fragment.append(tr);
  } else {
    slice.forEach((post) => fragment.append(renderPostRow(post)));
  }
  postsBody.replaceChildren(fragment);
  pager.hidden = matched.length <= PAGE_SIZE;
  pageLabel.textContent = slice.length ? formatInt(start + 1) + "–" + formatInt(start + slice.length) : "";
  prevButton.disabled = state.page <= 1;
  nextButton.disabled = state.page >= pages;
  syncSortHeaders();
}

function renderFooter() {
  const method = index && typeof index.method === "string" ? index.method : "";
  document.getElementById("method").textContent = method;
  document.getElementById("method-section").hidden = !method;

  const list = document.getElementById("product-list");
  list.replaceChildren();
  const items = productsInOrder();
  items.forEach((item) => {
    const product = productById.get(item.id) || { name: item.name };
    const li = document.createElement("li");
    const href = safeUrl(product.source_url);
    const name = document.createElement(href ? "a" : "span");
    name.textContent = product.name || item.id;
    if (href) {
      name.href = href;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
    }
    li.append(name);
    const meta = [];
    if (product.maker) meta.push(product.maker);
    if (product.launched) meta.push("Launched " + product.launched);
    meta.push(product.verified ? "Verified" : "Unverified");
    const metaEl = document.createElement("div");
    metaEl.className = "product-meta";
    metaEl.textContent = meta.join(" · ");
    li.append(metaEl);
    if (product.note) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = product.note;
      li.append(note);
    }
    list.append(li);
  });
  document.getElementById("products-section").hidden = items.length === 0;

  const taxSection = document.getElementById("taxonomy-section");
  const versionEl = document.getElementById("taxonomy-version");
  const changes = document.getElementById("changelog");
  changes.replaceChildren();
  if (taxonomy && Number.isInteger(taxonomy.version)) {
    versionEl.hidden = false;
    versionEl.textContent = "Version " + taxonomy.version;
  } else {
    versionEl.hidden = true;
    versionEl.textContent = "";
  }
  const changelog = taxonomy && Array.isArray(taxonomy.changelog) ? taxonomy.changelog : [];
  changelog.forEach((change) => {
    if (!change) return;
    const li = document.createElement("li");
    const date = document.createElement("span");
    date.className = "change-date";
    date.textContent = change.date || "";
    li.append(date, document.createTextNode(change.change || ""));
    changes.append(li);
  });
  taxSection.hidden = !taxonomy;

  const updated = document.getElementById("updated");
  if (index && index.updated) {
    updated.hidden = false;
    updated.textContent = "Updated " + formatPacific(index.updated);
  } else {
    updated.hidden = true;
  }
  about.hidden =
    document.getElementById("method-section").hidden &&
    document.getElementById("products-section").hidden &&
    taxSection.hidden &&
    updated.hidden;
}

function buildHash() {
  if (state.tab === "posts") {
    const params = new URLSearchParams();
    if (state.platform) params.set("platform", state.platform);
    if (state.postProduct) params.set("product", state.postProduct);
    if (state.use) params.set("use", state.use);
    if (state.q) params.set("q", state.q);
    if (state.sort !== "date") params.set("sort", state.sort);
    if (state.dir !== "desc") params.set("dir", state.dir);
    if (state.page > 1) params.set("page", String(state.page));
    const query = params.toString();
    return "#posts" + (query ? "?" + query : "");
  }
  const params = new URLSearchParams();
  if (state.product && state.product !== "all") params.set("product", state.product);
  const date = dates[state.dateIndex];
  if (date && state.dateIndex !== dates.length - 1) params.set("date", date);
  const query = params.toString();
  return "#top" + (query ? "?" + query : "");
}

function writeHash() {
  if (applyingHash) return;
  const next = buildHash();
  if (location.hash === next) return;
  history.replaceState(null, "", location.pathname + location.search + next);
}

function applyHash() {
  if (!ready) return;
  applyingHash = true;
  stopPlay();
  try {
    const raw = location.hash.replace(/^#/, "");
    const split = raw.indexOf("?");
    const tab = (split === -1 ? raw : raw.slice(0, split)) || "top";
    const params = new URLSearchParams(split === -1 ? "" : raw.slice(split + 1));
    if (tab === "posts") {
      state.platform = params.get("platform") || "";
      state.postProduct = params.get("product") || "";
      state.use = params.get("use") || "";
      state.q = params.get("q") || "";
      const sort = params.get("sort") || "date";
      state.sort = SORTS.indexOf(sort) === -1 ? "date" : sort;
      state.dir = params.get("dir") === "asc" ? "asc" : "desc";
      const page = Number(params.get("page") || "1");
      state.page = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
      syncPostControls();
      showTab("posts");
      renderPosts();
    } else {
      const product = params.get("product") || "all";
      state.product = productIds.indexOf(product) === -1 ? "all" : product;
      const date = params.get("date");
      const found = dates.indexOf(date);
      if (found >= 0) state.dateIndex = found;
      syncSegment();
      syncSlider();
      showTab("top");
      if (ready) showCurrent(false);
    }
  } finally {
    applyingHash = false;
  }
}

function activateTab(tab) {
  if (!ready) return;
  const next = tab === "posts" ? "posts" : "top";
  if (state.tab === next) {
    writeHash();
    return;
  }
  showTab(next);
  if (next === "posts") renderPosts();
  else showCurrent(false);
  writeHash();
}

function renderAboutLists() {
  buildSegment();
  buildFilters();
  preparePosts();
  setPostsAvailable(!postsMissing);
  renderFooter();
}

async function init() {
  measureRowH();
  const indexRaw = await fetchJson("data/index.json");
  const productsRaw = await fetchJson("data/products.json");
  const taxonomyRaw = await fetchJson("data/taxonomy.json");
  const postsRaw = await fetchJson("data/posts.json");
  const snapshots = indexRaw && Array.isArray(indexRaw.snapshots) ? indexRaw.snapshots : [];
  dates = snapshots.filter((day) => typeof day === "string" && day).slice().sort();
  if (!indexRaw || !dates.length) {
    showEmpty();
    return;
  }
  index = indexRaw;
  taxonomy = taxonomyRaw && typeof taxonomyRaw === "object" ? taxonomyRaw : null;
  if (taxonomy && Array.isArray(taxonomy.categories)) {
    taxonomy.categories.forEach((category) => {
      if (category && category.code) taxonomyByCode.set(category.code, category);
    });
  }
  if (Array.isArray(productsRaw)) {
    productsRaw.forEach((product) => {
      if (product && product.id) productById.set(product.id, product);
    });
  }
  productIds = (Array.isArray(index.products) ? index.products : []).filter((id) => typeof id === "string" && id);
  posts = Array.isArray(postsRaw) ? postsRaw.filter((post) => post && typeof post === "object") : [];
  postsMissing = !Array.isArray(postsRaw);
  state.dateIndex = dates.length - 1;
  renderAboutLists();
  syncSlider();
  ready = true;
  applyHash();
  prefetchAll();
}

productFilter.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  selectProduct(button.dataset.product);
});

productFilter.addEventListener("keydown", (event) => {
  const buttons = Array.from(productFilter.querySelectorAll("button"));
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  let next = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = buttons[(index + 1) % buttons.length];
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = buttons[(index - 1 + buttons.length) % buttons.length];
  if (!next) return;
  event.preventDefault();
  next.focus();
  selectProduct(next.dataset.product);
});

tabTop.addEventListener("click", () => activateTab("top"));
tabPosts.addEventListener("click", () => activateTab("posts"));
tabList.addEventListener("keydown", (event) => {
  const order = [tabTop, tabPosts];
  const index = order.indexOf(document.activeElement);
  if (index < 0) return;
  let next = null;
  if (event.key === "ArrowRight") next = order[(index + 1) % order.length];
  if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length];
  if (event.key === "Home") next = order[0];
  if (event.key === "End") next = order[1];
  if (!next) return;
  event.preventDefault();
  next.focus();
  activateTab(next === tabPosts ? "posts" : "top");
});

playButton.addEventListener("click", startPlay);
dateInput.addEventListener("pointerdown", () => {
  state.scrubbing = true;
  stopPlay();
});
window.addEventListener("pointerup", () => {
  state.scrubbing = false;
});
dateInput.addEventListener("keydown", () => {
  state.scrubbing = true;
  stopPlay();
});
dateInput.addEventListener("keyup", () => {
  state.scrubbing = false;
});
dateInput.addEventListener("input", () => {
  state.scrubbing = true;
  stopPlay();
  state.dateIndex = Number(dateInput.value);
  syncSlider();
  if (scrubRaf) return;
  scrubRaf = requestAnimationFrame(() => {
    scrubRaf = 0;
    showCurrent(true);
    writeHash();
  });
});
dateInput.addEventListener("change", () => {
  state.scrubbing = false;
  writeHash();
});

chart.addEventListener("pointerover", onRowIntent);
chart.addEventListener("click", onRowIntent);
chart.addEventListener("focusin", onRowIntent);

platformSelect.addEventListener("change", () => {
  state.platform = platformSelect.value;
  state.page = 1;
  renderPosts();
  writeHash();
});
productSelect.addEventListener("change", () => {
  state.postProduct = productSelect.value;
  state.page = 1;
  renderPosts();
  writeHash();
});
useSelect.addEventListener("change", () => {
  state.use = useSelect.value;
  state.page = 1;
  renderPosts();
  writeHash();
});
quoteInput.addEventListener("input", () => {
  state.q = quoteInput.value;
  state.page = 1;
  renderPosts();
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHash, 200);
});

document.querySelector("thead").addEventListener("click", (event) => {
  const th = event.target.closest("th[data-sort]");
  if (!th) return;
  const column = th.dataset.sort;
  if (state.sort === column) state.dir = state.dir === "asc" ? "desc" : "asc";
  else {
    state.sort = column;
    state.dir = column === "date" ? "desc" : "asc";
  }
  state.page = 1;
  renderPosts();
  writeHash();
});

prevButton.addEventListener("click", () => {
  if (state.page <= 1) return;
  state.page -= 1;
  renderPosts();
  writeHash();
});
nextButton.addEventListener("click", () => {
  state.page += 1;
  renderPosts();
  writeHash();
});

window.addEventListener("hashchange", applyHash);
window.addEventListener("resize", () => {
  if (resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = 0;
    measureRowH();
    chart._h = 0;
    if (ready && state.tab === "top") renderBars(lastItems, 0);
  });
});

init();
