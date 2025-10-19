# Solar Roots Agent Guidelines

- Use the Cloudflare Worker entry point at `src/index.ts` for server logic. Avoid adding new Pages Functions under `functions/`.
- Preserve the green and gold palette introduced in `public/index.html` (`#2e5e4e`, `#ffd85b`) when adjusting the landing page unless otherwise requested.
- Keep the subscription form status element with the id `form-message` in `public/index.html` so that front-end scripts can surface API responses.
