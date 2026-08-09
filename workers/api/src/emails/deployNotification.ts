export function deploySuccessEmail(opts: {
  projectName: string;
  services: string[];
  deployUrl?: string;
  workflowUrl: string;
  durationMs?: number;
}): { subject: string; html: string; text: string } {
  const { projectName, services, deployUrl, workflowUrl, durationMs } = opts;

  const safeName = escapeHtml(projectName);
  const subject = `✅ "${projectName}" deployed successfully`;

  const serviceList = services
    .map((s) => `<li style="margin:4px 0;color:#334155;">${escapeHtml(s)}</li>`)
    .join("");

  const serviceText = services.map((s) => `  • ${s}`).join("\n");

  const durationLabel = durationMs
    ? `<p style="margin:0 0 16px;font-size:14px;color:#64748b;">Completed in ${formatDuration(durationMs)}.</p>`
    : "";

  const safeDeployUrl = deployUrl ? safeUrl(deployUrl) : null;
  const safeWorkflowUrl = safeUrl(workflowUrl);

  const urlBlock = safeDeployUrl
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
        <tr>
          <td>
            <a href="${safeDeployUrl}" style="display:inline-block;padding:10px 20px;background:#0166f8;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
              Open Deployment →
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const urlText = deployUrl ? `\nOpen your deployment: ${deployUrl}\n` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>✅ &quot;${safeName}&quot; deployed successfully</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:48px 16px;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">

    <!-- Logo -->
    <tr>
      <td align="center" style="padding-bottom:28px;">
        <a href="${safeWorkflowUrl}" style="text-decoration:none;">
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.04em;color:#0f172a;">leenar</span>
        </a>
      </td>
    </tr>

    <!-- Card -->
    <tr>
      <td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

        <!-- Green top bar -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="height:3px;background:#22c55e;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>

        <!-- Body -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="padding:40px 44px 36px;">

              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#0f172a;line-height:1.3;letter-spacing:-0.02em;">
                Deployment successful
              </h1>

              <p style="margin:0 0 20px;font-size:15px;line-height:1.75;color:#475569;">
                <strong style="color:#0f172a;">${safeName}</strong> is live. Here's what was provisioned:
              </p>

              <ul style="margin:0 0 20px;padding-left:20px;">
                ${serviceList}
              </ul>

              ${durationLabel}

              ${urlBlock}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;">
                <tr><td style="height:1px;background:#f1f5f9;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>

              <p style="margin:0;font-size:14px;color:#64748b;">
                <a href="${safeWorkflowUrl}" style="color:#0166f8;text-decoration:none;">View canvas →</a>
              </p>

            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="padding:16px 44px 20px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                You received this because you deployed a project on <a href="${safeWorkflowUrl}" style="color:#94a3b8;text-decoration:underline;">Leenar</a>.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>

  </table>

</td></tr>
</table>
</body>
</html>`;

  const text = `Deployment successful — ${projectName}

Your stack is live. Services provisioned:
${serviceText}
${urlText}
View canvas: ${workflowUrl}

— Leenar
`;

  return { subject, html, text };
}

export function deployFailureEmail(opts: {
  projectName: string;
  errorMessage: string;
  workflowUrl: string;
  failedService?: string;
}): { subject: string; html: string; text: string } {
  const { projectName, errorMessage, workflowUrl, failedService } = opts;

  const safeName = escapeHtml(projectName);
  const subject = `❌ Deployment failed — "${projectName}"`;
  const safeWorkflowUrl = safeUrl(workflowUrl);

  const serviceNote = failedService
    ? `<p style="margin:0 0 16px;font-size:14px;color:#64748b;">Failed while provisioning: <strong style="color:#0f172a;">${escapeHtml(failedService)}</strong></p>`
    : "";

  const serviceNoteText = failedService
    ? `Failed while provisioning: ${failedService}\n`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>❌ Deployment failed — &quot;${safeName}&quot;</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:48px 16px;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;">

    <!-- Logo -->
    <tr>
      <td align="center" style="padding-bottom:28px;">
        <a href="${safeWorkflowUrl}" style="text-decoration:none;">
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.04em;color:#0f172a;">leenar</span>
        </a>
      </td>
    </tr>

    <!-- Card -->
    <tr>
      <td style="background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">

        <!-- Red top bar -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="height:3px;background:#ef4444;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
        </table>

        <!-- Body -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="padding:40px 44px 36px;">

              <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#0f172a;line-height:1.3;letter-spacing:-0.02em;">
                Deployment failed
              </h1>

              <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#475569;">
                We couldn't finish deploying <strong style="color:#0f172a;">${safeName}</strong>.
              </p>

              ${serviceNote}

              <!-- Error box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;">
                <tr>
                  <td style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;font-size:13px;font-family:monospace;color:#991b1b;word-break:break-word;">${escapeHtml(errorMessage)}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px;font-size:14px;line-height:1.75;color:#475569;">
                You can retry the deployment from your canvas. If the error persists, check your service connections in Settings.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;">
                <tr>
                  <td>
                    <a href="${safeWorkflowUrl}" style="display:inline-block;padding:10px 20px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
                      Go to canvas →
                    </a>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:20px;">
                <tr><td style="height:1px;background:#f1f5f9;font-size:0;line-height:0;">&nbsp;</td></tr>
              </table>

              <p style="margin:0;font-size:14px;color:#64748b;">
                Need help? Reply to this email and we'll take a look.
              </p>

            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="padding:16px 44px 20px;border-top:1px solid #f1f5f9;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                You received this because a deployment was triggered on <a href="${safeWorkflowUrl}" style="color:#94a3b8;text-decoration:underline;">Leenar</a>.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>

  </table>

</td></tr>
</table>
</body>
</html>`;

  const text = `Deployment failed — ${projectName}

We couldn't finish deploying your stack.
${serviceNoteText}
Error: ${errorMessage}

You can retry from your canvas: ${workflowUrl}

Need help? Reply to this email.

— Leenar
`;

  return { subject, html, text };
}

// ── Helpers ───────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeUrl(u: string): string {
  try {
    const p = new URL(u);
    if (p.protocol !== "https:" && p.protocol !== "http:") return "#";
    return escapeHtml(p.toString());
  } catch {
    return "#";
  }
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
