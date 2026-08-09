export function onboardingEmail(opts: {
  name: string;
  email: string;
  frontendUrl: string;
}): { subject: string; html: string; text: string } {
  const { name, frontendUrl } = opts;
  const rawFirst = (name?.split(" ")[0] || "there").slice(0, 50);
  const firstName = rawFirst
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const dashboardUrl = `${frontendUrl}/dashboard`;
  const newUrl = `${frontendUrl}/new`;
  const displayHost = frontendUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const subject = `Welcome to Leenar, ${firstName} 👋`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#08080f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#08080f;">
<tr><td align="center" style="padding:48px 16px 0;">

  <!-- Logo -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;">
    <tr>
      <td align="center" style="padding-bottom:40px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);border-radius:10px;padding:9px 22px;">
              <span style="font-size:16px;font-weight:700;letter-spacing:-0.05em;color:#ffffff;">leenar</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Card -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;background:#0f0f18;border:1px solid rgba(255,255,255,0.07);border-radius:16px;overflow:hidden;">

    <!-- Top accent -->
    <tr>
      <td style="height:3px;background:linear-gradient(90deg,#3b82f6 0%,#6366f1 50%,#34d399 100%);font-size:0;line-height:0;">&nbsp;</td>
    </tr>

    <!-- Hero -->
    <tr>
      <td style="padding:48px 48px 0;">
        <p style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:rgba(99,102,241,0.7);">You're in</p>
        <h1 style="margin:0 0 16px;font-size:28px;font-weight:700;letter-spacing:-0.045em;color:#ffffff;line-height:1.2;">
          Hey ${firstName}, welcome to Leenar.
        </h1>
        <p style="margin:0 0 36px;font-size:15px;line-height:1.8;color:rgba(255,255,255,0.48);">
          You can now provision your entire cloud infrastructure from a single canvas — GitHub, Vercel, Supabase, Resend — all wired together automatically.
        </p>
      </td>
    </tr>

    <!-- Steps -->
    <tr>
      <td style="padding:0 48px 40px;">
        <p style="margin:0 0 14px;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.3);">Get started in 3 steps</p>

        <!-- Step 1 -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:10px;">
          <tr>
            <td style="padding:16px 18px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15);border-radius:10px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="top" style="padding-right:14px;padding-top:1px;">
                    <div style="width:26px;height:26px;background:rgba(59,130,246,0.2);border-radius:7px;text-align:center;line-height:26px;">
                      <span style="font-size:12px;font-weight:700;color:#3b82f6;">1</span>
                    </div>
                  </td>
                  <td valign="top">
                    <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);">Connect your accounts</p>
                    <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.38);">Link GitHub, Vercel, and Supabase in Settings → Connections. Takes 30 seconds.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Step 2 -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:10px;">
          <tr>
            <td style="padding:16px 18px;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-radius:10px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="top" style="padding-right:14px;padding-top:1px;">
                    <div style="width:26px;height:26px;background:rgba(99,102,241,0.2);border-radius:7px;text-align:center;line-height:26px;">
                      <span style="font-size:12px;font-weight:700;color:#6366f1;">2</span>
                    </div>
                  </td>
                  <td valign="top">
                    <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);">Describe what you're building</p>
                    <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.38);">Chat with the AI and get a tailored infrastructure proposal — no config files, no YAML.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Step 3 -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:36px;">
          <tr>
            <td style="padding:16px 18px;background:rgba(52,211,153,0.05);border:1px solid rgba(52,211,153,0.12);border-radius:10px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td width="32" valign="top" style="padding-right:14px;padding-top:1px;">
                    <div style="width:26px;height:26px;background:rgba(52,211,153,0.15);border-radius:7px;text-align:center;line-height:26px;">
                      <span style="font-size:12px;font-weight:700;color:#34d399;">3</span>
                    </div>
                  </td>
                  <td valign="top">
                    <p style="margin:0 0 3px;font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);">Hit Deploy</p>
                    <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.38);">Your stack provisions in order, env vars injected automatically. Done.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- CTA buttons -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
          <tr>
            <td align="center">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-right:10px;">
                    <a href="${newUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;font-size:13px;font-weight:600;letter-spacing:-0.02em;text-decoration:none;padding:12px 24px;border-radius:8px;">
                      Start building →
                    </a>
                  </td>
                  <td>
                    <a href="${dashboardUrl}" style="display:inline-block;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.6);font-size:13px;font-weight:500;text-decoration:none;padding:12px 24px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);">
                      Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Divider -->
    <tr>
      <td style="padding:0 48px;">
        <div style="height:1px;background:rgba(255,255,255,0.05);"></div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:22px 48px 32px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.2);">
          You received this because you created a Leenar account. If this wasn't you, ignore this email.
        </p>
      </td>
    </tr>

  </table>

  <!-- Bottom -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;">
    <tr>
      <td align="center" style="padding:28px 0 52px;">
        <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.15);">
          © ${new Date().getFullYear()} Leenar &nbsp;·&nbsp;
          <a href="${frontendUrl}" style="color:rgba(255,255,255,0.2);text-decoration:none;">${displayHost}</a>
        </p>
      </td>
    </tr>
  </table>

</td></tr>
</table>
</body>
</html>`;

  const text = `Hey ${firstName}, welcome to Leenar!

Get started in 3 steps:

1. Connect your accounts (GitHub, Vercel, Supabase) in Settings → Connections
2. Describe what you're building to the AI
3. Hit Deploy — your stack provisions automatically

Start building: ${newUrl}
Dashboard: ${dashboardUrl}

— Leenar
`;

  return { subject, html, text };
}
