import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/database";
import crypto from "crypto";
import { sendOTPEmail } from "../services/emailService";
import { isUserRole, UserRole } from "../middlewares/authMiddleware";
import { z } from "zod";

const passwordSchema = z.string().min(8).max(128);
const emailSchema = z.string().trim().email().max(150);
const registrationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  password: passwordSchema,
});

// REGISTER USER
export const register = async (req: Request, res: Response) => {
  try {
    const parsed = registrationSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "Name, valid email, and a password of at least 8 characters are required",
      });
    }

    const { name, email, password } = parsed.data;

    // Check existing user
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await pool.query(
      `INSERT INTO users (name, email, password, role)
       VALUES ($1, $2, $3, 'patient')
       RETURNING id, name, email, role, created_at`,
      [name, email.toLowerCase(), hashedPassword]
    );

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: newUser.rows[0],
    });
  } catch (error) {
    console.error("Register Error:", error);

    return res.status(500).json({
      success: false,
      message: "Registration failed",
    });
  }
};


// LOGIN USER
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Check fields
    if (
      typeof email !== "string" ||
      !emailSchema.safeParse(email).success ||
      typeof password !== "string" ||
      !passwordSchema.safeParse(password).success
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const user = userResult.rows[0];

    // Compare password
    const isPasswordValid = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      console.error("JWT_SECRET is not configured");

      return res.status(500).json({
        success: false,
        message: "Authentication configuration error",
      });
    }

    // Generate JWT Token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      jwtSecret,
      {
        expiresIn: "7d",
      }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};

export const updateUserRole = async (req: Request, res: Response) => {
  const requestedRole = req.body?.role;

  if (!isUserRole(requestedRole)) {
    return res.status(400).json({
      success: false,
      message: "Invalid role",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET role = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, email, role, created_at`,
      [requestedRole satisfies UserRole, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User role updated successfully",
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Update User Role Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update user role",
    });
  }
};

// GET PROFILE
export const getProfile = async (req: any, res: any) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT id, name, email, role, created_at 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile fetched successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Get profile error:", error);

    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
// UPDATE PROFILE
export const updateProfile = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { name, email } = req.body;

    if (
      (name !== undefined && (typeof name !== "string" || !name.trim())) ||
      (email !== undefined && (!emailSchema.safeParse(email).success))
    ) {
      return res.status(400).json({
        success: false,
        message: "Name and email must be valid",
      });
    }

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           email = COALESCE($2, email)
       WHERE id = $3
       RETURNING id, name, email, created_at`,
      [name?.trim(), email?.toLowerCase(), userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Update profile error:", error);

    res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
// Change Password
export const changePassword = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;

    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (
      typeof currentPassword !== "string" ||
      !passwordSchema.safeParse(newPassword).success
    ) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    // Find user
    const userResult = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [userId]
);

const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check current password
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
   await pool.query(
    "UPDATE users SET password = $1 WHERE id = $2",
    [hashedPassword, userId]
);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });

  } catch (error) {
    console.error("Change Password Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
// FORGOT Password
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (typeof email !== "string" || !emailSchema.safeParse(email).success) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Find user
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(200).json({
        success: true,
        message: "If an account exists for this email, an OTP has been sent",
      });
    }

    const user = userResult.rows[0];

    // Generate 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();

    // Hash OTP before storing
    const hashedOTP = await bcrypt.hash(otp, 10);

    // OTP expires in 10 minutes
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Save OTP in database
    await pool.query(
      `UPDATE users
       SET reset_otp = $1,
           reset_otp_expiry = $2,
           reset_otp_verified = false,
           reset_authorization_token_hash = NULL,
           reset_authorization_expiry = NULL
       WHERE id = $3`,
      [hashedOTP, otpExpiry, user.id]
    );

    // Send OTP via email
    await sendOTPEmail(email, otp);

    return res.status(200).json({
      success: true,
      message: "If an account exists for this email, an OTP has been sent",
    });

  } catch (error) {
    console.error("Forgot Password Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
    });
  }
};
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { email, newPassword, resetToken } = req.body;

    if (
      typeof email !== "string" ||
      !emailSchema.safeParse(email).success ||
      !passwordSchema.safeParse(newPassword).success
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and new password are required"
      });
    }

    if (!resetToken || typeof resetToken !== "string") {
      return res.status(403).json({
        success: false,
        message: "Please verify OTP before resetting password"
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    // Update password and clear reset data
    const resetResult = await pool.query(
    `UPDATE users
       SET password = $1,
           reset_otp = NULL,
           reset_otp_expiry = NULL,
           reset_otp_verified = FALSE,
           reset_authorization_token_hash = NULL,
           reset_authorization_expiry = NULL
       WHERE email = $2
         AND reset_otp_verified = TRUE
         AND reset_otp IS NOT NULL
         AND reset_otp_expiry IS NOT NULL
         AND reset_otp_expiry >= NOW()
         AND reset_authorization_token_hash = $3
         AND reset_authorization_expiry IS NOT NULL
         AND reset_authorization_expiry >= NOW()
       RETURNING id`,
    [hashedPassword, email, resetTokenHash]
);

    if (resetResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Please verify OTP before resetting password"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password reset successfully"
    });

  } catch (error) {
    console.error("Reset Password Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
export const verifyResetOTP = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP are required"
      });
    }

    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    const user = userResult.rows[0];

    if (user.reset_otp_verified) {
      return res.status(400).json({
        success: false,
        message: "OTP already verified. Please reset your password"
      });
    }

    // Check OTP
    if (!user.reset_otp) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new OTP"
      });
    }

    const isOTPValid = await bcrypt.compare(
      String(otp),
      user.reset_otp
    );

    if (!isOTPValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Check OTP expiry
    if (!user.reset_otp_expiry || new Date() > new Date(user.reset_otp_expiry)) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired"
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    const resetAuthorizationExpiry = new Date(Date.now() + 5 * 60 * 1000);

    // Mark OTP as verified
    const verificationResult = await pool.query(
      `UPDATE users
       SET reset_otp_verified = TRUE,
           reset_authorization_token_hash = $3,
           reset_authorization_expiry = $4
       WHERE id = $1
         AND reset_otp = $2
         AND reset_otp_verified = FALSE
         AND reset_otp_expiry >= NOW()
       RETURNING id`,
      [user.id, user.reset_otp, resetTokenHash, resetAuthorizationExpiry]
    );

    if (verificationResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      resetToken
    });

  } catch (error) {
    console.error("Verify OTP Error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error"
    });
  }
};
