const form = document.getElementById('registration-form');
const messageEl = document.getElementById('form-message');

function setMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `form-message ${type}`.trim();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();

  const email = form.email.value.trim();
  const password = form.password.value;

  if (!email || !password) {
    setMessage('Please enter both an email and a password.', 'error');
    return;
  }

  if (password.length < 8) {
    setMessage('Password must be at least 8 characters long.', 'error');
    form.password.focus();
    return;
  }

  setMessage(`Thanks for joining the co-op, ${email}!`, 'success');
  form.reset();
});
