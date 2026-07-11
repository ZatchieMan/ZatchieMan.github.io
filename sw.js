/* Iron Log service worker.
   Strategy:
     - App page (HTML): NETWORK-FIRST, so the newest deploy always wins.
       Falls back to cache only when offline.
     - Other same-origin files (icons, manifest): cache-first, refreshed in the background.
     - Cross-origin (Google Fonts, Supabase CDN, avatars): not intercepted — straight to network.
   To force every device to drop old caches on the next visit, change CACHE below. */

var CACHE = "ironlog-2026-07-10";

self.addEventListener("install", function (e) {
  self.skipWaiting();                       // new worker activates without waiting
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(["/", "/index.html"]);
    }).catch(function () {})
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);   // remove every older cache
      }));
    }).then(function () {
      return self.clients.claim();          // take control of open pages immediately
    })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let CDN / fonts / Supabase go to network

  var accept = req.headers.get("accept") || "";
  var isHTML = req.mode === "navigate" || accept.indexOf("text/html") !== -1;

  if (isHTML) {
    // Network-first: fetch fresh, cache a copy, fall back to cache when offline.
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match(req).then(function (r) { return r || caches.match("/index.html"); });
      })
    );
    return;
  }

  // Other same-origin assets: serve cache fast, update in the background.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});

/* Workout-reminder push notifications, sent by the send-workout-reminders Supabase Edge Function. */
self.addEventListener("push", function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(data.title || "Iron Log", {
      body: data.body || "Time for your workout!",
      icon: "/icon-192.png",
      badge: "/icon-badge.png",
      tag: "workout-reminder"
    })
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow("/");
    })
  );
});
