/// <reference lib="dom" />
export function initializeContactForms () {
  document.querySelectorAll<HTMLFormElement>('[data-contact-form]').forEach(form => {
    const fieldset = form.querySelector<HTMLFieldSetElement>('[data-contact-fields]')!
    const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    const status = form.querySelector<HTMLElement>('[data-contact-status]')!
    const preview = form.querySelector<HTMLElement>('[data-contact-preview]')!

    function validate (field: HTMLInputElement | HTMLTextAreaElement): boolean {
      const value = field.value.trim()
      let error = ''
      if (field.required && !value) error = `Please enter your ${field.name}.`
      else if (field.validity.typeMismatch) error = 'Please enter a valid email address.'
      else if (field.name === 'message' && value.length < 10) error = 'Please write at least 10 characters.'
      else if (field.maxLength > 0 && value.length > field.maxLength) error = `Please use no more than ${field.maxLength} characters.`
      form.querySelector<HTMLElement>(`#${field.id}-error`)!.textContent = error
      if (error) field.setAttribute('aria-invalid', 'true')
      else field.removeAttribute('aria-invalid')
      return !error
    }

    // Bind before enabling: the static form must never submit personal data.
    form.addEventListener('submit', event => {
      event.preventDefault()
      preview.hidden = true
      const invalid = fields.filter(field => !validate(field))
      if (invalid.length) {
        status.textContent = 'Please check the highlighted fields. Nothing was sent.'
        invalid[0]?.focus()
        return
      }
      fields.forEach(field => {
        preview.querySelector<HTMLElement>(`[data-preview-${field.name}]`)!.textContent = field.value.trim() || '—'
      })
      preview.hidden = false
      status.textContent = 'Preview ready. Nothing was sent or saved.'
      status.focus()
    })
    fields.forEach(field => {
      field.addEventListener('input', () => {
        preview.hidden = true
        status.textContent = ''
        if (field.hasAttribute('aria-invalid')) validate(field)
      })
    })
    form.addEventListener('reset', () => {
      preview.hidden = true
      preview.querySelectorAll('dd').forEach(element => { element.textContent = '' })
      status.textContent = ''
      fields.forEach(field => {
        field.removeAttribute('aria-invalid')
        form.querySelector<HTMLElement>(`#${field.id}-error`)!.textContent = ''
      })
      fields[0]?.focus()
    })
    form.noValidate = true
    fieldset.disabled = false
  })
}
