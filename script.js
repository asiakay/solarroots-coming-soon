const form = document.getElementById('login-form');
const messageEl = document.getElementById('form-message');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.querySelector('.toggle-password');
const submitButton = form.querySelector('button[type="submit"]');

const KNOWN_USER = {
  email: 'member@solarroots.coop',
  passwordHash: 'f5fca203d4ac29dc1302719474214507ce87043c6f3b53b3e79fdb4c3948ca56'
};

function setMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `form-message ${type}`.trim();
}

async function hashPassword(password) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Secure hashing is not supported in this browser context.');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function authenticate({ email, password }) {
  await new Promise((resolve) => setTimeout(resolve, 400));

  if (email.toLowerCase() !== KNOWN_USER.email) {
    throw new Error('No account found for that email address.');
  }

  const hashedPassword = await hashPassword(password);

  if (hashedPassword !== KNOWN_USER.passwordHash) {
    throw new Error('The password you entered is incorrect.');
  }

  return { email };
}

function togglePasswordVisibility() {
  const isHidden = passwordInput.type === 'password';
  passwordInput.type = isHidden ? 'text' : 'password';
  togglePasswordBtn.textContent = isHidden ? 'Hide' : 'Show';
  togglePasswordBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
}

togglePasswordBtn.addEventListener('click', () => {
  togglePasswordVisibility();
  passwordInput.focus({ preventScroll: true });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = form.email.value.trim();
  const password = form.password.value;

  if (!email || !password) {
    setMessage('Please enter both an email and a password.', 'error');
    return;
  }

  if (password.length < 8) {
    setMessage('Password must be at least 8 characters long.', 'error');
    passwordInput.focus();
    return;
  }

  setMessage('Authenticating…', '');
  submitButton.disabled = true;
  submitButton.textContent = 'Signing you in…';

  try {
    const result = await authenticate({ email, password });
    const remember = form.remember.checked;

    if (remember) {
      localStorage.setItem('solarRootsRememberMe', result.email);
    } else {
      localStorage.removeItem('solarRootsRememberMe');
    }

    setMessage(`Welcome back, ${result.email}! You are now securely signed in.`, 'success');
    form.reset();
    passwordInput.type = 'password';
    togglePasswordBtn.textContent = 'Show';
    togglePasswordBtn.setAttribute('aria-label', 'Show password');
  } catch (error) {
    setMessage(error.message, 'error');
    passwordInput.focus();
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Sign In';
  }
});

(function populateRememberedEmail() {
  const rememberedEmail = localStorage.getItem('solarRootsRememberMe');

  if (rememberedEmail) {
    form.email.value = rememberedEmail;
    form.remember.checked = true;
  }
})();
