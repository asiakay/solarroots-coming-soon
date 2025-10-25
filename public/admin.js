const form = document.getElementById('admin-login');
const message = document.getElementById('admin-message');
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
  submitButton.textContent = isSubmitting ? 'Checking…' : 'Log in';
}

function validateInputs(email, password) {
  if (!email) {
    setMessage('Please enter your admin email address.', 'error');
    return false;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    setMessage('That email doesn’t look quite right.', 'error');
    return false;
  }

  if (!password) {
    setMessage('Please enter your admin password.', 'error');
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
    setMessage('Authenticating…');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const errorMessage = data?.error ?? 'We could not verify your admin access right now.';
        setMessage(errorMessage, 'error');
        return;
      }

      setMessage(data.message ?? 'Access granted. Redirecting to the admin dashboard…', 'success');
      form.reset();
    } catch (error) {
      console.error('Admin login request failed', error);
      setMessage('Something went wrong on our end. Please try again shortly.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
}
