import { Router } from 'express';
import { getPool } from './db.ts';
import { asyncRoute } from './http.ts';
import { HttpError } from './auth.ts';
export function createAuthRouter(){const r=Router();r.get('/me',asyncRoute(async(req,res)=>{const a=req.auth;if(!a)throw new HttpError(401,'authentication_required','Connectez-vous.');const p=getPool();if(!p)throw new HttpError(503,'database_not_configured','Base de données indisponible.');const q=await p.query('SELECT id,email,first_name,last_name,avatar_url,status FROM users WHERE clerk_user_id=$1',[a.clerkUserId]);res.json({user:q.rows[0]||{clerk_user_id:a.clerkUserId},clerk:{organization_id:a.clerkOrgId,role:a.clerkRole}})}));return r}
