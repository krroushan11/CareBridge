import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const sendOTPEmail = async (email: string, otp: string) => {
  await transporter.sendMail({
    from: `"CareBridge AI" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Password Reset OTP - CareBridge AI",

    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Password Reset Request</h2>

        <p>You requested to reset your password.</p>

        <h1 style="letter-spacing: 5px;">${otp}</h1>

        <p>This OTP will expire in 10 minutes.</p>

        <p>If you did not request a password reset, please ignore this email.</p>

        <br />

        <p>Regards,<br />CareBridge AI Team</p>
      </div>
    `,
  });
};