import dns from "dns/promises";
import net from "net";
import { URL } from "url";

export function requireApiKey(expectedKey) {
  return (req, res, next) => {
    if (!expectedKey) return next(); // dev only
    const key = req.get("X-API-Key") || "";
    if (key !== expectedKey) return res.status(401).json({ error: "Unauthorized" });
    next();
  };
}

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split(".").map((n) => parseInt(n, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const n = ip.toLowerCase();
    if (n === "::1") return true;
    if (n.startsWith("fc") || n.startsWith("fd")) return true; // ULA
    if (n.startsWith("fe80")) return true; // link-local
    return false;
  }
  return true;
}

export async function isUrlAllowed(urlStr, allowedHosts = []) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }

  if (!["http:", "https:"].includes(u.protocol)) {
    return { ok: false, reason: "Only http/https allowed" };
  }

  const host = u.hostname;

  // Optional allowlist
  if (allowedHosts && allowedHosts.length) {
    const ok = allowedHosts.some((h) => h === host || (h.startsWith("*.") && host.endsWith(h.slice(1))));
    if (!ok) return { ok: false, reason: "Host not allowed" };
  }

  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        return { ok: false, reason: "Host resolves to private IP (blocked)" };
      }
    }
  } catch {
    return { ok: false, reason: "DNS lookup failed" };
  }

  return { ok: true };
}
