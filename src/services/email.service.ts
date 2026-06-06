import nodemailer from 'nodemailer'
import type { FastifyInstance } from 'fastify'

export class EmailService {
  private transporter: nodemailer.Transporter

  constructor(private app: FastifyInstance) {
    this.transporter = nodemailer.createTransport({
      host: app.config.SMTP_HOST,
      port: parseInt(app.config.SMTP_PORT, 10),
      secure: app.config.SMTP_PORT === '465',
      auth: {
        user: app.config.SMTP_USER,
        pass: app.config.SMTP_PASS,
      },
    })
  }

  async sendMigrationEmail(email: string, migrationToken: string): Promise<void> {
    const url = `${this.app.config.FRONTEND_URL}/migrate?token=${migrationToken}`

    await this.transporter.sendMail({
      from: this.app.config.SMTP_FROM,
      to: email,
      subject: 'Secure your account',
      html: `
        <p>We're upgrading our security. Please secure your account by setting a password
        or linking a social login.</p>
        <p><a href="${url}">Secure my account</a></p>
        <p>This link expires in 15 minutes.</p>
      `,
    })
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<void> {
    const url = `${this.app.config.FRONTEND_URL}/reset-password?token=${resetToken}`

    await this.transporter.sendMail({
      from: this.app.config.SMTP_FROM,
      to: email,
      subject: 'Reset your password',
      html: `
        <p>You requested a password reset.</p>
        <p><a href="${url}">Reset my password</a></p>
        <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `,
    })
  }
}
