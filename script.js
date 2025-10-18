const form = document.getElementById('login-form');
const messageEl = document.getElementById('form-message');
const passwordInput = document.getElementById('password');
const emailInput = document.getElementById('email');
const togglePasswordBtn = document.querySelector('.toggle-password');
const rememberCheckbox = document.getElementById('remember');

if (!form || !messageEl || !passwordInput || !emailInput || !togglePasswordBtn || !rememberCheckbox) {
  throw new Error('Login form initialisation failed – required elements are missing.');
}

const submitButton = form.querySelector('button[type="submit"]');
form.dataset.state = 'idle';
form.dataset.enhanced = 'true';
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

const fieldErrors = new Map([
  [emailInput, document.getElementById('email-error')],
  [passwordInput, document.getElementById('password-error')]
]);

function clearFieldError(field) {
  const errorEl = fieldErrors.get(field);

  if (!errorEl) {
    return;
  }

  errorEl.textContent = '';
  field.removeAttribute('aria-invalid');
}

function setFieldError(field, message) {
  const errorEl = fieldErrors.get(field);

  if (!errorEl) {
    return;
  }

  errorEl.textContent = message;

  if (message) {
    field.setAttribute('aria-invalid', 'true');
  } else {
    field.removeAttribute('aria-invalid');
  }
}

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
  form.dataset.state = isSubmitting ? 'submitting' : 'idle';
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
    return null;
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

  if (!hashedPassword) {
    throw new Error('Secure hashing is unavailable in this session. Please open the site over HTTPS and try again.');
  }

  if (hashedPassword !== KNOWN_USER.passwordHash) {
    throw new Error('The password you entered is incorrect.');
  }

  return { email: KNOWN_USER.email };
}

function restoreRememberedEmail() {
  const rememberedEmail = getRememberedEmail();

  if (rememberedEmail) {
    emailInput.value = rememberedEmail;
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

form.addEventListener('input', (event) => {
  const target = event.target;

  if (fieldErrors.has(target)) {
    clearFieldError(target);
  }

  if (messageEl.classList.contains('error')) {
    setMessage('', '');
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  let hasError = false;

  if (!email) {
    setFieldError(emailInput, 'Please enter your email address.');
    hasError = true;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setFieldError(emailInput, 'Enter a valid email address.');
    hasError = true;
  }

  if (!password) {
    setFieldError(passwordInput, 'Please enter your password.');
    hasError = true;
  } else if (password.length < 8) {
    setFieldError(passwordInput, 'Password must be at least 8 characters long.');
    hasError = true;
  }

  if (hasError) {
    setMessage('Please fix the highlighted fields and try again.', 'error');
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
    fieldErrors.forEach((errorEl, field) => {
      errorEl.textContent = '';
      field.removeAttribute('aria-invalid');
    });
    restoreRememberedEmail();
    resetPasswordVisibility();
  } catch (error) {
    const fallbackMessage = error instanceof Error
      ? error.message
      : 'We could not sign you in. Please try again.';

    setMessage(fallbackMessage, 'error');
    clearFieldError(passwordInput);

    try {
      passwordInput.focus({ preventScroll: true });
    } catch (focusError) {
      passwordInput.focus();
    }
  } finally {
    setSubmitting(false);
  }
});
