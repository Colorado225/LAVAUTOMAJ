import { Router } from 'express';
import { getPool } from './db.ts';
import { asyncRoute } from './http.ts';
import { HttpError, getClerkUserProfile } from './auth.ts';

export function createAuthRouter() {
  const r = Router();

  // POST /api/v1/auth/sync — called after Clerk sign-in/sign-up to ensure
  // the user exists in Neon. Idempotent; safe to retry.
  r.post('/sync', asyncRoute(async (req, res) => {
    const a = req.auth;
    if (!a) throw new HttpError(401, 'authentication_required', 'Connectez-vous.');
    const p = getPool();
    if (!p) throw new HttpError(503, 'database_not_configured', 'Base de données indisponible.');

    // Fetch the verified profile from Clerk (server-side, never trust browser).
    const profile = await getClerkUserProfile(a.clerkUserId);

    await p.query(
      `INSERT INTO users (clerk_user_id, email, first_name, last_name, avatar_url, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (clerk_user_id) DO UPDATE SET
         email = EXCLUDED.email,
         first_name = EXCLUDED.first_name,
         last_name = EXCLUDED.last_name,
         avatar_url = EXCLUDED.avatar_url,
         status = CASE WHEN users.status = 'inactive' THEN users.status ELSE 'active' END,
         updated_at = NOW()`,
      [a.clerkUserId, profile.email, profile.firstName, profile.lastName, profile.avatarUrl]
    );

    res.json({ ok: true, user_id: a.clerkUserId });
  }));

  // GET /api/v1/auth/me — current authenticated user + Clerk context
  r.get('/me', asyncRoute(async (req, res) => {
    const a = req.auth;
    if (!a) throw new HttpError(401, 'authentication_required', 'Connectez-vous.');
    const p = getPool();
    if (!p) throw new HttpError(503, 'database_not_configured', 'Base de données indisponible.');
    const q = await p.query(
      'SELECT id, email, first_name, last_name, avatar_url, status FROM users WHERE clerk_user_id = $1',
      [a.clerkUserId]
    );
    res.json({
      user: q.rows[0] || { clerk_user_id: a.clerkUserId },
      clerk: { organization_id: a.clerkOrgId, role: a.clerkRole },
    });
  }));

  return r;
}