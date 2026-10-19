import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from './auth.ts';
export function asyncRoute(fn:(req:Request,res:Response,next:NextFunction)=>unknown){return (req:Request,res:Response,next:NextFunction)=>Promise.resolve(fn(req,res,next)).catch(next)}
export function body<T extends z.ZodTypeAny>(schema:T,value:unknown):z.infer<T>{const r=schema.safeParse(value);if(!r.success)throw new HttpError(400,'invalid_data',r.error.issues.map(i=>i.message).join('; '));return r.data}
export function tenant(req:Request){if(!req.tenant)throw new HttpError(401,'tenant_required','Organisation active requise.');return req.tenant}
export function requireRole(...roles:string[]){return (req:Request,_res:Response,next:NextFunction)=>{if(!req.tenant||!roles.includes(req.tenant.role))return next(new HttpError(403,'forbidden','Vous n’avez pas l’autorisation.'));next()}}
export function parseId(value:string){const r=z.string().uuid().safeParse(value);if(!r.success)throw new HttpError(400,'invalid_id','Identifiant invalide.');return r.data}
export function pageParams(req:Request){const page=Math.max(1,Number(req.query.page)||1),limit=Math.max(1,Math.min(100,Number(req.query.limit)||25));return {page,limit,offset:(page-1)*limit}}
