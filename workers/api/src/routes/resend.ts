import { Hono } from "hono";
import type { Env } from "../types";
import { getUserToken } from "../utils";
import { listDomains } from "../connectors/resend";
import { createLogger } from "../logger";

const log = createLogger({ route: "resend" });

export const resend = new Hono<{
  Bindings: Env;
  Variables: { userId: string };
}>();

resend.get("/domains", async (c) => {
  const userId = c.get("userId");
  try {
    const token = await getUserToken(c.env, userId, "resend");
    const domains = await listDomains(token);
    return c.json(domains);
  } catch (e: unknown) {
    log.error("resend_domains_list_error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json({ error: "Resend operation failed. Please try again." }, 500);
  }
});

// POST /api/resend/domains — add a new domain to Resend account
resend.post("/domains", async (c) => {
  const userId = c.get("userId");
  const { name, region } = await c.req.json<{
    name: string;
    region?: string;
  }>();
  if (!name?.trim()) return c.json({ error: "domain name required" }, 400);
  const VALID_REGIONS = new Set(["us-east-1", "eu-west-1", "sa-east-1"]);
  if (region !== undefined && !VALID_REGIONS.has(region)) {
    return c.json({ error: "Invalid region. Valid: us-east-1, eu-west-1, sa-east-1" }, 400);
  }
  try {
    const token = await getUserToken(c.env, userId, "resend");
    const res = await fetch("https://api.resend.com/domains", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: name.trim(),
        ...(region ? { region } : {}),
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok)
      return c.json(
        { error: (data as any).message ?? `Resend error ${res.status}` },
        502,
      );
    return c.json(data, 201);
  } catch (e: unknown) {
    log.error("resend_domains_create_error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json({ error: "Resend operation failed. Please try again." }, 500);
  }
});

const RESEND_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// GET /api/resend/domains/:id/records — get DNS records for a domain
resend.get("/domains/:id/records", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!RESEND_ID_RE.test(id))
    return c.json({ error: "Invalid domain id" }, 400);
  try {
    const token = await getUserToken(c.env, userId, "resend");
    const res = await fetch(`https://api.resend.com/domains/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      log.error("resend_domain_records_failed", {
        status: res.status,
        body: body.slice(0, 200),
      });
      return c.json(
        { error: `Upstream error (${res.status}). Please try again.` },
        502,
      );
    }
    const data = (await res.json()) as { records?: unknown[] };
    return c.json(data.records ?? []);
  } catch (e: unknown) {
    log.error("resend_domain_records_error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json({ error: "Resend operation failed. Please try again." }, 500);
  }
});

// DELETE /api/resend/domains/:id — remove a domain
resend.delete("/domains/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  if (!RESEND_ID_RE.test(id))
    return c.json({ error: "Invalid domain id" }, 400);
  try {
    const token = await getUserToken(c.env, userId, "resend");
    const res = await fetch(`https://api.resend.com/domains/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text();
      log.error("resend_domain_delete_failed", {
        status: res.status,
        body: body.slice(0, 200),
      });
      return c.json(
        { error: `Upstream error (${res.status}). Please try again.` },
        502,
      );
    }
    return c.json({ ok: true });
  } catch (e: unknown) {
    log.error("resend_domain_delete_error", {
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json({ error: "Resend operation failed. Please try again." }, 500);
  }
});
