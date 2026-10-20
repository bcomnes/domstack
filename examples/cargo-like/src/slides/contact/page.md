---
title: Say hello
layout: slide
slide:
  id: contact
  order: 7
  label: Contact
  theme: ink
  kind: contact
  background: /slides/interval/concrete.jpg
---

<div class="contact-composition">
  <div class="contact-intro">
    <p class="eyebrow">An open invitation / 007</p>
    <h2 class="contact-title">Say<br /><em>hello.</em></h2>
    <p id="contact-notice">A contact-form experiment. Preview a message here; nothing is sent, stored, or logged. Please use made-up details.</p>
  </div>
  <form class="contact-form" data-contact-form method="dialog" aria-label="Demo contact form" aria-describedby="contact-notice">
    <fieldset data-contact-fields disabled>
      <legend>Compose a message</legend>
      <p class="contact-hint">All fields required unless marked optional.</p>
      <div class="contact-fields">
        <div class="contact-field"><label for="contact-name">Name</label><input id="contact-name" name="name" autocomplete="name" required maxlength="80" aria-describedby="contact-name-error" /><span class="contact-error" id="contact-name-error"></span></div>
        <div class="contact-field"><label for="contact-email">Email</label><input id="contact-email" name="email" type="email" autocomplete="email" required maxlength="254" aria-describedby="contact-email-error" /><span class="contact-error" id="contact-email-error"></span></div>
        <div class="contact-field contact-field--wide"><label for="contact-subject">Subject <span>(optional)</span></label><input id="contact-subject" name="subject" maxlength="120" aria-describedby="contact-subject-error" /><span class="contact-error" id="contact-subject-error"></span></div>
        <div class="contact-field contact-field--wide"><label for="contact-message">Message</label><textarea id="contact-message" name="message" required minlength="10" maxlength="2000" rows="4" aria-describedby="contact-message-hint contact-message-error"></textarea><span class="contact-hint" id="contact-message-hint">10–2,000 characters.</span><span class="contact-error" id="contact-message-error"></span></div>
      </div>
      <div class="contact-actions"><button type="submit">Preview message <span aria-hidden="true">↗</span></button><button type="reset">Start over</button></div>
    </fieldset>
    <noscript><p>This local demo needs JavaScript. The fields are disabled; nothing can be submitted.</p></noscript>
    <p class="contact-status" data-contact-status role="status" aria-live="polite" tabindex="-1"></p>
    <div class="contact-preview" data-contact-preview hidden>
      <h3>Message preview</h3>
      <dl><dt>Name</dt><dd data-preview-name></dd><dt>Email</dt><dd data-preview-email></dd><dt>Subject</dt><dd data-preview-subject></dd><dt>Message</dt><dd data-preview-message></dd></dl>
    </div>
  </form>
</div>
