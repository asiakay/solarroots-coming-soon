const form = document.getElementById('subscribe');
const message = document.getElementById('form-message');
const submitButton = form?.querySelector('button[type="submit"]');
const defaultButtonText = submitButton?.textContent ?? 'Join the Waitlist';

function setMessage(text, status) {
  if (!message) return;
  message.textContent = text;
  message.classList.remove('success', 'error');
  if (status) {
    message.classList.add(status);
  }
}

function setSubmitting(isSubmitting) {
  if (!submitButton) return;
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? 'Sending…' : defaultButtonText;
}

function isValidEmail(value) {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return pattern.test(value);
}

if (form && message) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const email = formData.get('email');

    if (typeof email !== 'string') {
      setMessage('Please enter your email address.', 'error');
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setMessage('Please enter your email address.', 'error');
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setMessage('That email doesn’t look quite right.', 'error');
      return;
    }

    setMessage('Sending confirmation…');
    setSubmitting(true);

    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const error = data?.error ?? 'We could not process your request. Please try again.';
        setMessage(error, 'error');
        return;
      }

      setMessage(data.message ?? 'You are all set! Check your inbox for updates soon.', 'success');
      form.reset();
    } catch (error) {
      console.error('Subscription request failed', error);
      setMessage('Something went wrong on our end. Please try again shortly.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
}
