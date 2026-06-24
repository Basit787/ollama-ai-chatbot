export type Role = "user" | "admin";

export interface AuthUser {
  id: string;
  role: Role;
  email?: string;
  username?: string;
}

export interface JwtPayload extends AuthUser {
  sub: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
export const ROLES = { USER: "user" as Role, ADMIN: "admin" as Role };
