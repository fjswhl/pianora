import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins/email-otp';

export interface AccountEnv {
  DB?: D1Database;
  PRIVATE_SCORES?: R2Bucket;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  EMAIL?: SendEmail;
  AUTH_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export function providers(env: AccountEnv) {
  const configured = !!(env.DB && env.PRIVATE_SCORES && env.BETTER_AUTH_URL && env.BETTER_AUTH_SECRET);
  return {
    email: configured && !!(env.EMAIL && env.AUTH_FROM),
    google: configured && !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
}

export function authFor(env: AccountEnv) {
  const enabled = providers(env);
  return betterAuth({
    appName: 'Pianora', baseURL: env.BETTER_AUTH_URL!, secret: env.BETTER_AUTH_SECRET!,
    database: env.DB!,
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    rateLimit: { enabled: true, storage: 'database' },
    socialProviders: enabled.google ? {
      google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
    } : {},
    plugins: enabled.email ? [emailOTP({
      expiresIn: 300, allowedAttempts: 5, storeOTP: 'hashed',
      rateLimit: { window: 60, max: 3 },
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'sign-in') throw new Error('Unsupported verification request');
        await env.EMAIL!.send({
          from: env.AUTH_FROM!, to: email, subject: 'Pianora 登录验证码',
          text: `你的 Pianora 登录验证码是 ${otp}，5 分钟内有效。如果你没有请求登录，可以忽略这封邮件。`,
        });
      },
    })] : [],
  });
}
