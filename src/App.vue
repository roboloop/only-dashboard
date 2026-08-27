<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <div class="app">
    <header>
      <h1>only-dashboard</h1>
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/stats">Stats</RouterLink>
      </nav>
    </header>

    <main>
      <RouterView />
    </main>

    <footer>Vue + Hono, served by a single Cloudflare Worker.</footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 60rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border);
}

h1 {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

nav {
  display: flex;
  gap: 1.25rem;
}

nav a {
  color: var(--text-muted);
  text-decoration: none;
}

nav a:hover {
  color: var(--text);
}

nav a.router-link-exact-active {
  color: var(--accent);
}

main {
  padding: 2rem 0;
}

footer {
  padding-top: 1.5rem;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
