// Service worker PWA TukangCatat.
// Strategi cache:
// - Navigasi: network-first, fallback ke cache (mode offline).
// - Aset ber-hash (/_next/static/...): cache-first — nama file berisi hash
//   konten, jadi aman di-cache lama (versi baru = URL baru).
// - Lainnya (termasuk /_next/image & gambar public): network-first + simpan
//   ke cache sebagai cadangan offline. JANGAN cache-first di sini karena
//   URL-nya stabil tapi isinya bisa berubah (pernah bikin aset stale di dev).
const CACHE_NAME = "tcat-v2";
const CORE_ASSETS = ["/", "/dash", "/manifest.webmanifest"];

// Pre-cache asset inti saat service worker terpasang.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Bersihkan cache lama saat service worker baru aktif.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigasi halaman: network-first, fallback cache (offline).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Aset ber-hash Next: cache-first, network sebagai fallback + simpan.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
    return;
  }

  // Lainnya: network-first, cache sebagai fallback offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// Notifikasi push pengingat nyatet (dikirim cron pada jam WIB pilihan user).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "TukangCatat", {
      body: data.body || "Sudah nyatet pengeluaran hari ini? ✍️",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "tukangcatat-reminder",
      data: { url: data.url || "/dash" },
    })
  );
});

// Tap notifikasi -> fokus/buka dashboard.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dash";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(url) && "focus" in client) return client.focus();
        }
        return self.clients.openWindow(url);
      })
  );
});