const TARGET_BASE = (Deno.env.get("TARGET_DOMAIN") ?? "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

async function handler(req: Request): Promise<Response> {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", {
      status: 500,
    });
  }

  try {
    const url = new URL(req.url);
    const targetUrl = TARGET_BASE + url.pathname + url.search;

    const headers = new Headers();
    let clientIp: string | null = null;

    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k)) continue;
      if (k === "x-real-ip") { clientIp = value; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = value; continue; }
      headers.set(key, value);
    }
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const fetchOpts: RequestInit = { method, headers, redirect: "manual" };
    if (hasBody) {
      fetchOpts.body = req.body;
      // @ts-ignore duplex is needed for streaming body
      fetchOpts.duplex = "half";
    }

    const upstream = await fetch(targetUrl, fetchOpts);

    const responseHeaders = new Headers();
    for (const [k, v] of upstream.headers) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      responseHeaders.set(k, v);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("relay error:", err);
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}

Deno.serve(handler);
