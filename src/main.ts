import { createApp } from 'vue';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { router } from './router';
import './styles/main.css';

const app = createApp(App);
app.use(router);
app.mount('#app');

// The Electron renderer is loaded from file:// and does not use a service
// worker. The PWA registers one for offline use.
if (!window.vca?.isElectron && 'serviceWorker' in navigator) {
  try {
    registerSW({ immediate: true });
  } catch {
    // Offline support is optional; the app still works online.
  }
}
