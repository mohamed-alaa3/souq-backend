
const nodemailer = require('nodemailer');

let cachedTransporter = null;

const isEmailConfigured = () =>
  Boolean(
    process.env.EMAIL_HOST &&
      process.env.EMAIL_USER &&
      process.env.EMAIL_PASS,
  );

const getTransporter = () => {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (!isEmailConfigured()) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return cachedTransporter;
};

const sendEmail = async ({ to, subject, html, text }) => {
  const transporter = getTransporter();

  if (!transporter) {
    throw new Error(
      'Email is not configured. Set EMAIL_HOST, EMAIL_PORT, EMAIL_USER and EMAIL_PASS in .env',
    );
  }

  const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const fromName = process.env.EMAIL_FROM_NAME || 'Souq';

  await transporter.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    text,
    html,
  });
};

// =========================================================
// EMAIL VERIFICATION
// =========================================================

const sendEmailVerificationEmail = async ({
  to,
  name,
  otp,
  expiresMinutes,
}) => {
  const subject = 'Verify your Souq email address';

  const safeName = String(name || 'there')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const html = `
  <div style="background:#f6f9f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e9e9;">
      
      <div style="background:linear-gradient(135deg,#0f7c74,#0c665f);padding:28px 32px;text-align:center;">
        <span style="display:inline-block;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px;">
          SOUQ
        </span>
      </div>

      <div style="padding:32px;">
        <h2 style="margin:0 0 12px;color:#1e2929;font-size:20px;">
          Verify your email
        </h2>

        <p style="margin:0 0 20px;color:#526d82;font-size:14px;line-height:1.6;">
          Hi ${safeName}, welcome to Souq!
          Please use the verification code below to verify your email address
          and activate your account.
        </p>

        <div style="margin:0 0 24px;text-align:center;">
          <span style="display:inline-block;padding:14px 28px;background:#f0f9f8;border:1px dashed #0f7c74;border-radius:12px;font-size:28px;font-weight:800;letter-spacing:8px;color:#0f7c74;">
            ${otp}
          </span>
        </div>

        <p style="margin:0 0 8px;color:#7b8787;font-size:12px;line-height:1.6;">
          This verification code expires in ${expiresMinutes} minutes.
        </p>

        <p style="margin:0;color:#7b8787;font-size:12px;line-height:1.6;">
          If you didn't create a Souq account, you can safely ignore this email.
          Never share this code with anyone.
        </p>
      </div>
    </div>
  </div>`;

  const text =
    `Your Souq email verification code is ${otp}. ` +
    `It expires in ${expiresMinutes} minutes. ` +
    `If you didn't create a Souq account, you can ignore this email.`;

  await sendEmail({
    to,
    subject,
    text,
    html,
  });
};

// =========================================================
// PASSWORD RESET
// =========================================================

const sendPasswordResetEmail = async ({
  to,
  name,
  otp,
  expiresMinutes,
}) => {
  const subject = 'Your Souq password reset code';

  const safeName = String(name || 'there')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const html = `
  <div style="background:#f6f9f9;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e9e9;">
      
      <div style="background:linear-gradient(135deg,#0f7c74,#0c665f);padding:28px 32px;text-align:center;">
        <span style="display:inline-block;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:1px;">
          SOUQ
        </span>
      </div>

      <div style="padding:32px;">
        <h2 style="margin:0 0 12px;color:#1e2929;font-size:20px;">
          Reset your password
        </h2>

        <p style="margin:0 0 20px;color:#526d82;font-size:14px;line-height:1.6;">
          Hi ${safeName}, we received a request to reset the password on your
          Souq account. Use the verification code below to continue.
          This code is valid for ${expiresMinutes} minutes.
        </p>

        <div style="margin:0 0 24px;text-align:center;">
          <span style="display:inline-block;padding:14px 28px;background:#f0f9f8;border:1px dashed #0f7c74;border-radius:12px;font-size:28px;font-weight:800;letter-spacing:8px;color:#0f7c74;">
            ${otp}
          </span>
        </div>

        <p style="margin:0 0 8px;color:#7b8787;font-size:12px;line-height:1.6;">
          If you didn't request a password reset, you can safely ignore this email -
          your password will remain unchanged.
        </p>

        <p style="margin:0;color:#7b8787;font-size:12px;line-height:1.6;">
          Never share this code with anyone, including someone claiming to be
          from Souq support.
        </p>
      </div>
    </div>
  </div>`;

  const text =
    `Your Souq password reset code is ${otp}. ` +
    `It expires in ${expiresMinutes} minutes. ` +
    `If you didn't request this, you can ignore this email.`;

  await sendEmail({
    to,
    subject,
    text,
    html,
  });
};

module.exports = {
  sendEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  isEmailConfigured,
};

