---
title: App Shell
---

<section class="app-layout">
  <div class="app-summary">
    <div>
      <h1>Static PWA shell</h1>
      <p>This page is built as ordinary static HTML, then the service worker uses Domstack's domstack manifest to cache the static shell for offline launches.</p>
      <div class="pill-row" aria-label="Cache policy">
        <span class="pill ok">Pages</span>
        <span class="pill ok">Bundles</span>
        <span class="pill ok">Static assets</span>
        <span class="pill warn">No API cache</span>
      </div>
    </div>
    <div class="status-list" aria-live="polite">
      <div class="status-row">
        <span>Worker</span>
        <strong data-pwa-status>Not registered</strong>
      </div>
      <div class="status-row">
        <span>Cache version</span>
        <strong data-pwa-version>Waiting for domstack manifest</strong>
      </div>
      <div class="status-row">
        <span>Network</span>
        <strong data-online-state>Checking</strong>
      </div>
    </div>
  </div>

  <ul class="route-grid" aria-label="Example routes">
    <li class="route-card">
      <h2>Docs</h2>
      <p>Docs are part of the first offline bundle.</p>
      <a class="button" href="/docs/">Open docs</a>
      <div class="pill-row"><span class="pill ok">Precached</span></div>
    </li>
    <li class="route-card">
      <h2>Legal</h2>
      <p>Legal-style static pages use the same offline policy as docs.</p>
      <a class="button" href="/legal/">Open legal</a>
      <div class="pill-row"><span class="pill ok">Precached</span></div>
    </li>
    <li class="route-card">
      <h2>Login</h2>
      <p>Auth shells can load offline while submissions remain network-only.</p>
      <a class="button" href="/login/">Open login</a>
      <div class="pill-row"><span class="pill ok">Precached</span></div>
    </li>
    <li class="route-card">
      <h2>Offline fallback</h2>
      <p>Excluded navigations fall back to a small static page.</p>
      <a class="button" href="/offline/">Open fallback</a>
      <div class="pill-row"><span class="pill ok">Precached</span></div>
    </li>
    <li class="route-card">
      <h2>Blog</h2>
      <p>Blog pages are intentionally left out to reduce first install cost.</p>
      <a class="button secondary" href="/blog/">Open blog</a>
      <div class="pill-row"><span class="pill warn">Excluded</span></div>
    </li>
    <li class="route-card">
      <h2>Admin</h2>
      <p>Protected routes should stay network-only.</p>
      <a class="button secondary" href="/admin/">Open admin</a>
      <div class="pill-row"><span class="pill warn">Excluded</span></div>
    </li>
    <li class="route-card">
      <h2>Opted-out</h2>
      <p>Page vars can opt a static route out of precaching.</p>
      <a class="button secondary" href="/private/">Open page</a>
      <div class="pill-row"><span class="pill warn">Excluded</span></div>
    </li>
  </ul>
</section>
