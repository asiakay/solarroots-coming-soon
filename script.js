const form = document.getElementById('login-form');
const messageEl = document.getElementById('form-message');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.querySelector('.toggle-password');
const rememberCheckbox = document.getElementById('remember');
const submitButton = form.querySelector('button[type="submit"]');

const submitDefaultText = submitButton.textContent;
const submittingText = 'Signing you in…';
const REMEMBER_KEY = 'solarRootsRememberMe';

const KNOWN_USER = {
  email: 'member@solarroots.coop',
  passwordHash: 'f5fca203d4ac29dc1302719474214507ce87043c6f3b53b3e79fdb4c3948ca56'
};

const storageAvailable = (() => {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
})();

function getRememberedEmail() {
  if (!storageAvailable) {
    return '';
  }

  return localStorage.getItem(REMEMBER_KEY) || '';
}

function rememberEmail(email) {
  if (!storageAvailable) {
    return;
  }

  localStorage.setItem(REMEMBER_KEY, email);
}

function forgetRememberedEmail() {
  if (!storageAvailable) {
    return;
  }

  localStorage.removeItem(REMEMBER_KEY);
}

function setMessage(text, type = '') {
  messageEl.textContent = text;
  messageEl.className = ['form-message', type].filter(Boolean).join(' ');
}

function setSubmitting(isSubmitting) {
  const busyState = String(isSubmitting);
  submitButton.disabled = isSubmitting;
  submitButton.textContent = isSubmitting ? submittingText : submitDefaultText;
  submitButton.setAttribute('aria-busy', busyState);
  form.setAttribute('aria-busy', busyState);
}

function updateToggleButton(isVisible) {
  togglePasswordBtn.textContent = isVisible ? 'Hide' : 'Show';
  togglePasswordBtn.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
  togglePasswordBtn.setAttribute('aria-pressed', String(isVisible));
}

function resetPasswordVisibility() {
  passwordInput.type = 'password';
  updateToggleButton(false);
}

updateToggleButton(false);

if (!storageAvailable) {
  rememberCheckbox.checked = false;
  rememberCheckbox.disabled = true;
  rememberCheckbox.setAttribute('aria-disabled', 'true');
  const rememberLabel = rememberCheckbox.closest('.remember-me');

  if (rememberLabel) {
    rememberLabel.classList.add('is-disabled');
    rememberLabel.setAttribute('title', 'Remember me is unavailable in this browsing mode.');
  }
}

async function hashPassword(password) {
  if (!window.crypto || !window.crypto.subtle || !window.isSecureContext) {
    throw new Error('Secure hashing is not supported in this environment. Please try again over a secure connection.');
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

  const normalizedEmail = email.toLowerCase();

  if (normalizedEmail !== KNOWN_USER.email) {
    throw new Error('No account found for that email address.');
  }

  const hashedPassword = await hashPassword(password);

  if (hashedPassword !== KNOWN_USER.passwordHash) {
    throw new Error('The password you entered is incorrect.');
  }

  return { email: KNOWN_USER.email };
}

function restoreRememberedEmail() {
  const rememberedEmail = getRememberedEmail();

  if (rememberedEmail) {
    form.email.value = rememberedEmail;
    rememberCheckbox.checked = true;
  }
}

restoreRememberedEmail();

togglePasswordBtn.addEventListener('click', () => {
  const isCurrentlyHidden = passwordInput.type === 'password';
  passwordInput.type = isCurrentlyHidden ? 'text' : 'password';
  updateToggleButton(isCurrentlyHidden);

  try {
    passwordInput.focus({ preventScroll: true });
  } catch (error) {
    passwordInput.focus();
  }
});

form.addEventListener('input', () => {
  if (messageEl.classList.contains('error')) {
    setMessage('', '');
  }
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
    try {
      passwordInput.focus({ preventScroll: true });
    } catch (error) {
      passwordInput.focus();
    }
    return;
  }

  setMessage('Authenticating…', 'pending');
  setSubmitting(true);

  try {
    const result = await authenticate({ email, password });

    if (rememberCheckbox.checked) {
      rememberEmail(result.email);
    } else {
      forgetRememberedEmail();
    }

    setMessage(`Welcome back, ${result.email}! You are now securely signed in.`, 'success');
    form.reset();
    restoreRememberedEmail();
    resetPasswordVisibility();
  } catch (error) {
    const fallbackMessage = error instanceof Error
      ? error.message
      : 'We could not sign you in. Please try again.';

    setMessage(fallbackMessage, 'error');

    try {
      passwordInput.focus({ preventScroll: true });
    } catch (focusError) {
      passwordInput.focus();
    }
  } finally {
    setSubmitting(false);
  }
});
