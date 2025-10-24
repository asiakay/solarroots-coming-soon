const form = document.getElementById('login-form');
const message = document.getElementById('login-message');
const submitButton = form?.querySelector('button[type="submit"]');

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
  submitButton.textContent = isSubmitting ? 'Logging in…' : 'Log in';
}

function validateInputs(email, password) {
  if (!email) {
    setMessage('Please enter your email address.', 'error');
    return false;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    setMessage('That email doesn’t look quite right.', 'error');
    return false;
  }

  if (!password) {
    setMessage('Please enter your password.', 'error');
    return false;
  }

  return true;
}

if (form && message) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const email = (formData.get('email') ?? '').toString().trim().toLowerCase();
    const password = (formData.get('password') ?? '').toString();

    if (!validateInputs(email, password)) {
      return;
    }

    setSubmitting(true);
    setMessage('Checking your credentials…');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const errorMessage = data?.error ?? 'We could not verify your account just yet. Please try again soon.';
        setMessage(errorMessage, 'error');
        return;
      }

      setMessage(data.message ?? 'You are logged in! We will redirect you shortly.', 'success');
      form.reset();
    } catch (error) {
      console.error('Login request failed', error);
      setMessage('Something went wrong on our end. Please try again shortly.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
}
