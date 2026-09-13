import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
   forgotPassword,
    resetPassword,
     verifyResetOTP
     ,updateUserRole
} from "../controllers/authController";

import { authenticateToken, requireRole } from "../middlewares/authMiddleware";

const router = Router();

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Please try again later"
  }
});

const verifyResetOTPLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many OTP verification attempts. Please try again later"
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later"
  }
});

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many registration attempts. Please try again later"
  }
});

// Register user
router.post("/register", registrationLimiter, register);

// Login user
router.post("/login", loginLimiter, login);

// Protected Profile Route
router.get("/profile", authenticateToken, getProfile);
// Update Profile
router.put("/profile", authenticateToken, updateProfile);
// Change Password
router.put("/change-password", authenticateToken, changePassword);
router.put(
  "/admin/users/:id/role",
  authenticateToken,
  requireRole("admin"),
  updateUserRole
);
// Forgot Password - Send OTP
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);

// Verify OTP
router.post("/verify-reset-otp", verifyResetOTPLimiter, verifyResetOTP);

// Reset Password
router.post("/reset-password", resetPassword);
export default router;
