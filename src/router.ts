import { createRouter, createWebHashHistory } from 'vue-router';
import DashboardView from './views/DashboardView.vue';
import StudentDetailView from './views/StudentDetailView.vue';
import ChecklistsView from './views/ChecklistsView.vue';
import SettingsView from './views/SettingsView.vue';

export const router = createRouter({
  // Hash history works identically in the PWA and in Electron's file:// build.
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/students/:id', name: 'student', component: StudentDetailView, props: true },
    { path: '/checklists', name: 'checklists', component: ChecklistsView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});
