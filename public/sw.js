// Deliberately no fetch handler or cache: financial records must stay online.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('Curated Financial', {
    body: 'You have a new update. Open your secure workspace to review it.',
    icon: '/icon.svg', badge: '/icon.svg', data: { url: '/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
