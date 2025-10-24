const form = document.getElementById('profile-form');
const message = document.getElementById('profile-message');
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
  submitButton.textContent = isSubmitting ? 'Saving…' : 'Save my profile';
}

function validateInputs(email, name, password, bio) {
  if (!email) {
    setMessage('Please provide an email address.', 'error');
    return false;
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    setMessage('That email doesn’t look quite right.', 'error');
    return false;
  }

  if (!name) {
    setMessage('Share your name so we know what to call you.', 'error');
    return false;
  }

  if (!password) {
    setMessage('Create a password so you can log in later.', 'error');
    return false;
  }

  if (password.length < 8) {
    setMessage('Passwords need to be at least 8 characters long.', 'error');
    return false;
  }

  if (!bio) {
    setMessage('A short bio helps us learn about you. Please add a few words.', 'error');
    return false;
  }

  return true;
}

if (form && message) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const email = (formData.get('email') ?? '').toString().trim().toLowerCase();
    const name = (formData.get('name') ?? '').toString().trim();
    const password = (formData.get('password') ?? '').toString();
    const bio = (formData.get('bio') ?? '').toString().trim();

    if (!validateInputs(email, name, password, bio)) {
      return;
    }

    setSubmitting(true);
    setMessage('Saving your profile…');

    try {
      const response = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name, password, bio }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const errorMessage = data?.error ?? 'We could not save your profile. Please try again.';
        setMessage(errorMessage, 'error');
        return;
      }

      setMessage(data.message ?? 'Profile saved successfully!', 'success');
      form.reset();
    } catch (error) {
      console.error('Profile request failed', error);
      setMessage('Something went wrong on our end. Please try again shortly.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
}
