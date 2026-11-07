<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import SaveStatus from './components/SaveStatus.vue';
import {
  clearMessages,
  errorMessage,
  exportFiles,
  initStore,
  isBusy,
  isDraftMode,
  isReady,
  issues,
  lastMessage,
  lastWarning,
  refreshNow,
  retryLoad,
  saveNow,
  sourceLabel,
  status,
} from './app/store';

const logoUrl = computed(() => new URL('vca-logo.png', document.baseURI).href);
const errorIssues = computed(() => issues.value.filter((issue) => issue.severity === 'error'));
const warningIssues = computed(() => issues.value.filter((issue) => issue.severity === 'warning'));

let timer: number | undefined;

onMounted(async () => {
  await initStore();
  timer = window.setInterval(refreshNow, 60 * 60 * 1000);
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="container app-header-inner">
        <RouterLink class="brand" to="/">
          <img :src="logoUrl" alt="Vienna Combat Academy logo" />
          <span>
            <span class="brand-title">Luta Belt Tracker</span><br />
            <span class="brand-subtitle">Vienna Combat Academy</span>
          </span>
        </RouterLink>

        <nav class="nav" aria-label="Main navigation">
          <RouterLink to="/">Dashboard</RouterLink>
          <RouterLink to="/checklists">Checklists</RouterLink>
          <RouterLink to="/settings">Settings</RouterLink>
        </nav>

        <span class="header-spacer" />
        <SaveStatus />
      </div>
    </header>

    <main class="app-main">
      <div class="container">
        <div v-if="!isReady" class="card card-pad" style="text-align: center">
          <p class="muted">Loading local data…</p>
        </div>

        <template v-else>
          <div class="banners">
            <div v-if="errorMessage" class="banner banner-error">
              <span><strong>Save/load problem:</strong> {{ errorMessage }}</span>
              <span class="spacer" />
              <button type="button" class="btn btn-sm btn-secondary" :disabled="isBusy" @click="saveNow">
                Retry save
              </button>
              <button type="button" class="btn btn-sm btn-ghost" @click="clearMessages">Dismiss</button>
            </div>

            <div v-if="isDraftMode" class="banner banner-warning">
              <span>
                <strong>Browser working copy.</strong>
                Changes are kept in this browser but are <em>not</em> written to your CSV
                files yet. Export the files or connect a data folder to make them canonical.
              </span>
              <span class="spacer" />
              <button type="button" class="btn btn-sm btn-secondary" :disabled="isBusy" @click="exportFiles">
                Export CSV
              </button>
              <RouterLink class="btn btn-sm btn-primary" to="/settings">Data settings</RouterLink>
            </div>

            <div v-if="lastWarning" class="banner banner-warning">
              <span>{{ lastWarning }}</span>
              <span class="spacer" />
              <button type="button" class="btn btn-sm btn-ghost" @click="clearMessages">Dismiss</button>
            </div>

            <div v-if="lastMessage" class="banner banner-success">
              <span>{{ lastMessage }}</span>
              <span class="spacer" />
              <button type="button" class="btn btn-sm btn-ghost" @click="clearMessages">Dismiss</button>
            </div>

            <div v-if="status === 'error' && !errorMessage" class="banner banner-error">
              <span>The last operation failed. Your previous data is unchanged.</span>
              <span class="spacer" />
              <button type="button" class="btn btn-sm btn-secondary" @click="retryLoad">Reload</button>
            </div>

            <div v-if="errorIssues.length > 0" class="banner banner-error">
              <span>
                <strong>{{ errorIssues.length }} data error(s)</strong> need attention:
                {{ errorIssues[0].message }}
              </span>
              <span class="spacer" />
              <RouterLink class="btn btn-sm btn-secondary" to="/settings">Review</RouterLink>
            </div>

            <div v-if="warningIssues.length > 0 && !isDraftMode" class="banner banner-info">
              <span>
                {{ warningIssues.length }} data note(s) are available in Settings.
                {{ warningIssues[0].message }}
              </span>
              <span class="spacer" />
              <RouterLink class="btn btn-sm btn-ghost" to="/settings">Details</RouterLink>
            </div>
          </div>

          <RouterView />
        </template>
      </div>
    </main>

    <footer class="app-footer">
      <div class="container footer-inner">
        <span>Local-first grading tracker · No server, cloud database or account required.</span>
        <span>Data source: {{ sourceLabel || '—' }}</span>
      </div>
    </footer>
  </div>
</template>
