const form = document.getElementById('subscribe');
const message = document.getElementById('form-message');

function setMessage(text, status) {
  message.textContent = text;
  message.classList.remove('success', 'error');
  if (status) {
    message.classList.add(status);
  }
}

if (form && message) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const email = formData.get('email');

    if (typeof email !== 'string' || !email.trim()) {
      setMessage('Please enter a valid email address.', 'error');
      return;
    }

    setMessage('Sending confirmation…');

    try {
      const response = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
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
    }
  });
}
