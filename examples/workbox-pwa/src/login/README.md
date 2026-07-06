---
title: Login
---

# Login

Auth shells can be precached so the interface opens offline, while form submissions remain network-only.

<form data-network-form action="/api/session" method="post">
  <label>
    Email
    <input name="email" type="email" autocomplete="email">
  </label>
  <label>
    Password
    <input name="password" type="password" autocomplete="current-password">
  </label>
  <p data-network-state>Checking network state.</p>
  <button type="submit">Sign in</button>
</form>
