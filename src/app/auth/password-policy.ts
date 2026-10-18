/**
 * Password policy — must match the Clerk dashboard configuration
 * (Dashboard > Settings > Authentication > Password > minimum length).
 * Current Clerk instance: min_length = 15 (verified via API — form_password_length_too_short).
 */
export const MIN_PASSWORD_LENGTH = 15;
