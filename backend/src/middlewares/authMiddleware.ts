import { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";

export const USER_ROLES = ["patient", "caregiver", "doctor", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === "string" &&
  (USER_ROLES as readonly string[]).includes(value);

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

export const getJwtSecret = (): string | undefined => {
  const secret = process.env.JWT_SECRET;
  return secret && secret.trim().length > 0 ? secret : undefined;
};

export const validateJwtSecret = (): void => {
  const secret = getJwtSecret();

  if (
    !secret ||
    secret.length < 32 ||
    /replace-with|change-this|your-secret|secret-key/i.test(secret)
  ) {
    throw new Error("JWT_SECRET must be a unique random value of at least 32 characters");
  }
};

export const authenticateToken = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Access token required"
      });
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format"
      });
    }

    const jwtSecret = getJwtSecret();

    if (!jwtSecret) {
      return res.status(500).json({
        success: false,
        message: "Authentication configuration error"
      });
    }

    const decoded = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });

    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof decoded.id !== "string" ||
      typeof decoded.email !== "string" ||
      !isUserRole(decoded.role)
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload"
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
};

export const requireRole = (...allowedRoles: UserRole[]): RequestHandler => (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  if (!allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Insufficient permissions",
    });
  }

  next();
};