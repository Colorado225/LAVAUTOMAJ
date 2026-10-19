import type { NextFunction, Request, Response } from "express"
import type { PoolClient } from "pg"
import { getPool } from "./db.ts"
import { HttpError } from "./auth.ts"

export function roleFromClerkRole(role: string | null | undefined): string {
 if(role==="org:admin"||role==="admin")return "owner"
 if(role==="org:manager"||role==="manager")return "manager"
 if(role==="org:member"||role==="member")return "cashier"
 return "cashier"
}
export async function requireTenantContext(req:Request,_res:Response,next:NextFunction){
 try{
  const auth=req.auth
  if(!auth)throw new HttpError(401,"authentication_required","Connectez-vous pour continuer.")
  const pool=getPool()
  if(!pool)throw new HttpError(503,"database_not_configured","La base de données n'est pas configurée.")
  if(!auth.clerkOrgId)throw new HttpError(403,"organization_required","Sélectionnez ou créez une organisation pour continuer.")
  const q=await pool.query(`SELECT o.id AS organization_id,u.id AS user_id,u.status,m.role
   FROM organizations o JOIN organization_members m ON m.organization_id=o.id
   JOIN users u ON u.id=m.user_id WHERE o.clerk_org_id=$1 AND u.clerk_user_id=$2 LIMIT 1`,[auth.clerkOrgId,auth.clerkUserId])
  const row=q.rows[0]
  if(!row||row.status!=="active")throw new HttpError(403,"organization_membership_required","Votre compte n'est pas membre de cette organisation.")
  req.tenant={organizationId:row.organization_id,userId:row.user_id,role:row.role}
  next()
 }catch(e){next(e)}
}
export async function assertOrganizationUserCapacity(client:PoolClient,organizationId:string,userId:string){
 await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[organizationId])
 const exists=await client.query("SELECT 1 FROM organization_members WHERE organization_id=$1 AND user_id=$2",[organizationId,userId])
 if(exists.rowCount)return
 const q=await client.query(`SELECT p.max_users, COUNT(m.id)::int AS active_count FROM organizations o
 LEFT JOIN subscriptions s ON s.organization_id=o.id
 LEFT JOIN plans p ON p.id=s.plan_id
 LEFT JOIN organization_members m ON m.organization_id=o.id
 WHERE o.id=$1 GROUP BY p.max_users`,[organizationId])
 const row=q.rows[0]
 if(row?.max_users!=null && Number(row.active_count)>=Number(row.max_users))throw new HttpError(409,"plan_user_limit","Le nombre maximal d'utilisateurs de votre forfait est atteint.")
}
