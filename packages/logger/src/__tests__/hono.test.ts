import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { resolveClientIp, resolveClientIpFromHeaders } from "../hono";

/**
 * Runs `resolveClientIp` against a real Hono request so the header lookup is the
 * framework's own, not a hand-rolled stub that might disagree about casing or
 * empty values.
 */
async function resolve(headers: Record<string, string>): Promise<string | undefined> {
  let resolved: string | undefined;
  const app = new Hono();
  app.get("/", (c) => {
    resolved = resolveClientIp(c);
    return c.text("ok");
  });
  await app.request("/", { headers });
  return resolved;
}

describe("resolveClientIpFromHeaders", () => {
  it("reads straight off a Headers object", async () => {
    expect(resolveClientIpFromHeaders(new Headers({ "x-real-ip": "10.0.0.1" }))).toBe("10.0.0.1");
    expect(resolveClientIpFromHeaders(new Headers())).toBeUndefined();
  });
});

describe("resolveClientIp", () => {
  it("goes through the raw Request, not c.req.header()", async () => {
    // createContext is handed context doubles that implement `req.raw` and
    // nothing else. Reading `c.req.header()` here would throw for every one of
    // them — and it did, until this was pinned down.
    const doubleWithOnlyRaw = {
      req: { raw: new Request("https://x.test/", { headers: { "x-real-ip": "10.0.0.1" } }) },
    } as Parameters<typeof resolveClientIp>[0];

    expect(resolveClientIp(doubleWithOnlyRaw)).toBe("10.0.0.1");
  });

  it("prefers x-real-ip over x-forwarded-for", async () => {
    // The ingress overwrites x-real-ip with the single peer address it observed,
    // while x-forwarded-for is append-only and partly carries whatever the
    // caller sent. Order matters for safety, not just consistency — see the
    // SECURITY note on the helper.
    expect(
      await resolve({ "x-real-ip": "10.0.0.1", "x-forwarded-for": "1.2.3.4" }),
    ).toBe("10.0.0.1");
  });

  it("uses x-forwarded-for whole, not just its first hop", async () => {
    // Voyager reads the raw header value. Splitting to the first entry here
    // would make the same request key differently in the two services.
    expect(await resolve({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 172.16.0.1" })).toBe(
      "1.2.3.4, 10.0.0.1, 172.16.0.1",
    );
  });

  it("ignores the CDN headers entirely", async () => {
    // Voyager consults neither, so neither may produce a key here. Nothing in
    // the request path sets them today.
    expect(await resolve({ "cf-connecting-ip": "9.9.9.9" })).toBeUndefined();
    expect(await resolve({ "true-client-ip": "8.8.8.8" })).toBeUndefined();
    expect(
      await resolve({ "cf-connecting-ip": "9.9.9.9", "true-client-ip": "8.8.8.8" }),
    ).toBeUndefined();
  });

  it("returns undefined when no header identifies the caller", async () => {
    // The `127.0.0.1` substitution voyager makes is left to the callers that
    // need a key; context.ip stays null so audit rows do not claim an address
    // the proxy never reported.
    expect(await resolve({})).toBeUndefined();
  });

  it("falls through an empty x-real-ip instead of resolving to an empty string", async () => {
    // An empty header resolving to "" would collapse every such caller into a
    // single rate-limit bucket, which is worse than having no key at all. Go's
    // net/http strips the whitespace around a field value while parsing, so
    // voyager's `== ""` check already behaves this way.
    expect(await resolve({ "x-real-ip": "", "x-forwarded-for": "1.2.3.4" })).toBe("1.2.3.4");
    expect(await resolve({ "x-real-ip": "   ", "x-forwarded-for": "1.2.3.4" })).toBe("1.2.3.4");
  });

  it("returns undefined when both candidate headers are empty", async () => {
    expect(await resolve({ "x-real-ip": "", "x-forwarded-for": "" })).toBeUndefined();
    expect(await resolve({ "x-real-ip": "  ", "x-forwarded-for": "  " })).toBeUndefined();
  });
});
