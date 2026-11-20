// Service worker: shows dose reminders pushed by the server, even when the app is closed.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Medicine reminder', body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Medicine reminder', {
      body: data.body, tag: data.tag, icon: '/icon-192.png', badge: '/icon-192.png',
      requireInteraction: true, data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow(event.notification.data?.url || '/');
    }),
  );
});
