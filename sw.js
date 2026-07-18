const CACHE_NAME = "hkjc-model-v13-public-functional";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20260708-external-models",
  "./app.js?v=20260708-external-models",
  "./dashboard-layout.js?v=20260708-external-models",
  "./external-model-summary.js?v=20260708-external-models",
  "./adaptive-staking.js",
  "./meeting-countdown.js",
  "./multi-play-portfolio.js",
  "./public-dashboard-mode.js",
  "./hkjc-horse-model/src/value-betting-engine.js",
  "./research-program.js",
  "./bet-strategy.js",
  "./betting-products.js",
  "./self-test.js",
  "./manifest.webmanifest",
  "./icons/app-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    url.pathname.endsWith("/data/dashboard.json")
    || url.pathname.endsWith("/hkjc-horse-model/data/processed/model-leaderboard.json")
    || url.pathname.endsWith("/hkjc-horse-model/data/processed/model-training-report.json")
    || url.pathname.endsWith("/hkjc-horse-model/data/processed/strategy-risk-report.json")
    || url.pathname.endsWith("/hkjc-horse-model/data/processed/external-model-comparison-2026-07-08-HV.json")
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }

  if (url.origin === self.location.origin && /\.(html|css|js|webmanifest)$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return await cache.match(request) ?? await cache.match(fallbackUrl);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
