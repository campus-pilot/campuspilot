import { describe, expect, it } from "vitest";
import { CENSOR, sanitizeLogArgs, sanitizeLogRecord } from "../sanitize";

/**
 * The shape node-mailjet hangs off a failed send: credentials in three
 * encodings plus the rendered body. See ../sanitize.ts.
 */
function axiosShapedError(): Error {
  const err = new Error('Unsuccessful: Status Code: "401"');
  Object.assign(err, {
    code: "ERR_BAD_REQUEST",
    statusCode: 401,
    config: {
      auth: { username: "MJ_KEY", password: "MJ_SECRET" },
      data: '{"Messages":[{"TextPart":"Your login code is 424242"}]}',
    },
    response: {
      status: 401,
      request: {
        _header: "POST /v3.1/send HTTP/1.1\r\nAuthorization: Basic TUpfS0VZOk1KX1NFQ1JFVA==\r\n\r\n",
        _redirectable: { _currentUrl: "https://MJ_KEY:MJ_SECRET@api.mailjet.com/v3.1/send" },
      },
    },
  });
  return err;
}

describe("sanitizeLogRecord", () => {
  it("leaves an ordinary record alone", () => {
    const record = { level: "INFO", status: 200, durationMs: 12, path: "/health" };
    expect(sanitizeLogRecord({ ...record })).toEqual(record);
  });

  it("censors denied keys at any depth", () => {
    const out = sanitizeLogRecord({ a: { b: { c: { d: { password: "p", keep: 1 } } } } });
    expect(out).toEqual({ a: { b: { c: { d: { password: CENSOR, keep: 1 } } } } });
  });

  it("normalises key spelling", () => {
    const out = sanitizeLogRecord({ API_KEY: "k", "api-secret": "s", apiKey: "k", contactEmail: "a@b.co" });
    expect(out).toEqual({ API_KEY: CENSOR, "api-secret": CENSOR, apiKey: CENSOR, contactEmail: CENSOR });
  });

  it("keeps keys that merely resemble denied ones", () => {
    const out = sanitizeLogRecord({ emailVerified: true, tokenCount: 3, authorized: true });
    expect(out).toEqual({ emailVerified: true, tokenCount: 3, authorized: true });
  });

  it("scrubs credentials embedded in strings", () => {
    const out = sanitizeLogRecord({
      url: "GET https://KEY:SECRET@api.example.com/v1",
      basic: "Authorization: Basic TUpfS0VZOk1KX1NFQ1JFVA==",
      // Not keyed `bearer`/`authorization` on purpose: those are denied by key,
      // and what is under test here is the string rule catching an innocent key.
      note: "sent Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig upstream",
      reason: "no-reply@polyteia.de is not an authorized sender",
    });
    expect(out.url).toBe(`GET https://${CENSOR}@api.example.com/v1`);
    expect(out.basic).toBe(`Authorization: Basic ${CENSOR}`);
    expect(out.note).toBe(`sent Bearer ${CENSOR} upstream`);
    expect(out.reason).toBe(`${CENSOR} is not an authorized sender`);
  });

  it("censors rather than deletes, so a field never looks unlogged", () => {
    const out = sanitizeLogRecord({ err: axiosShapedError() }) as { err: Record<string, unknown> };
    expect(out.err.config).toBe(CENSOR);
    expect(out.err.type).toBe("Error");
    expect(out.err.message).toBe('Unsuccessful: Status Code: "401"');
    expect(out.err.stack).toContain("Error:");
    expect(out.err.statusCode).toBe(401);
  });

  it("lets no encoding of the credentials or the body survive", () => {
    for (const record of [{ err: axiosShapedError() }, { args: [axiosShapedError()] }]) {
      const serialized = JSON.stringify(sanitizeLogRecord(record));
      for (const secret of ["MJ_SECRET", "MJ_KEY", "TUpfS0VZOk1KX1NFQ1JFVA==", "424242"]) {
        expect(serialized, secret).not.toContain(secret);
      }
    }
  });

  it("keeps only allowlisted own properties on an error", () => {
    // A `pg` DatabaseError: the schema identifiers name database objects and
    // survive; `detail`, `where` and `internalQuery` carry the row values that
    // tripped the constraint and must not.
    const err = Object.assign(new Error('duplicate key value violates unique constraint "form_slug_uq"'), {
      code: "23505",
      severity: "ERROR",
      table: "form",
      constraint: "form_slug_uq",
      routine: "_bt_check_unique",
      detail: "Key (slug, name)=(steuer-2026, Hans Mueller) already exists.",
      where: "PL/pgSQL function ingest() line 12",
      internalQuery: "SELECT * FROM form WHERE tax_id = '12345'",
    });
    const out = sanitizeLogRecord({ err }) as { err: Record<string, unknown> };
    expect(out.err.code).toBe("23505");
    expect(out.err.table).toBe("form");
    expect(out.err.constraint).toBe("form_slug_uq");
    expect(out.err.routine).toBe("_bt_check_unique");
    expect(out.err.detail).toBe(CENSOR);
    expect(out.err.where).toBe(CENSOR);
    expect(out.err.internalQuery).toBe(CENSOR);
    expect(JSON.stringify(out)).not.toContain("Hans Mueller");
    expect(JSON.stringify(out)).not.toContain("12345");
  });

  it("censors a validation error's issues, values and all", () => {
    // ZodError.issues holds `received` — the value the caller submitted.
    const err = Object.assign(new Error("validation failed"), {
      name: "ZodError",
      issues: [{ code: "invalid_type", received: "12 345 678", path: ["applicant", "taxId"] }],
    });
    const out = sanitizeLogRecord({ err }) as { err: Record<string, unknown> };
    // The name still identifies what kind of failure it was.
    expect(out.err.name).toBe("ZodError");
    expect(out.err.issues).toBe(CENSOR);
    expect(JSON.stringify(out)).not.toContain("12 345 678");
  });

  it("censors an event payload attached to an error", () => {
    const err = Object.assign(new Error("ingest failed"), {
      event: { name: "dataset/ingest.run", data: { rows: [{ iban: "DE89370400440532013000" }] } },
    });
    const out = sanitizeLogRecord({ err }) as { err: Record<string, unknown> };
    expect(out.err.event).toBe(CENSOR);
    expect(JSON.stringify(out)).not.toContain("DE89370400440532013000");
  });

  it("censors payload carriers outside an error too", () => {
    // `payload` is the key `patchConsole` gives an object a library handed to
    // `console.error`; `body`, `event` and `rows` are the shapes we build.
    const out = sanitizeLogRecord({
      payload: { citizen: "Hans" },
      body: "{...}",
      event: { data: {} },
      rows: [{ iban: "DE89" }],
      eventName: "dataset/ingest.run",
      rowCount: 3,
    });
    expect(out).toEqual({
      payload: CENSOR,
      body: CENSOR,
      event: CENSOR,
      rows: CENSOR,
      // Counts and names describe the payload without being it.
      eventName: "dataset/ingest.run",
      rowCount: 3,
    });
  });

  it("does not mistake a repeated object for a cycle", () => {
    // One object under two keys is a DAG, not a cycle. Reporting it as circular
    // would put a false statement in the log.
    const shared = { Name: "Polyteia" };
    const out = sanitizeLogRecord({ a: shared, b: shared });
    expect(out).toEqual({ a: { Name: "Polyteia" }, b: { Name: "Polyteia" } });
  });

  it("leaves paths and version specifiers intact", () => {
    // Stack traces are what an error log is for; the address pattern must not
    // eat them.
    const stack = "at fn (/app/node_modules/.pnpm/node-mailjet@6.0.11/dist/index.js:2:1)";
    const out = sanitizeLogRecord({ stack, pkg: "@scope/thing@1.2.3" });
    expect(out.stack).toBe(stack);
    expect(out.pkg).toBe("@scope/thing@1.2.3");
  });

  it("follows a non-enumerable cause", () => {
    const out = sanitizeLogRecord({
      err: new Error("outer", { cause: new Error("inner", { cause: { apiSecret: "s" } }) }),
    }) as { err: { cause: { message: string; cause: { apiSecret: string } } } };
    expect(out.err.cause.message).toBe("inner");
    expect(out.err.cause.cause.apiSecret).toBe(CENSOR);
  });

  it("survives a cycle", () => {
    const node: Record<string, unknown> = { name: "a" };
    node.self = node;
    expect((sanitizeLogRecord({ node }) as { node: { self: string } }).node.self).toBe("[Circular]");
  });

  it("truncates rather than walking without bound", () => {
    let deep: Record<string, unknown> = { end: "leaf" };
    for (let i = 0; i < 40; i += 1) deep = { nest: deep };
    expect(JSON.stringify(sanitizeLogRecord(deep))).toContain("[TRUNCATED depth]");

    const wide = { many: Array.from({ length: 4000 }, (_, i) => ({ i })) };
    expect(JSON.stringify(sanitizeLogRecord(wide))).toContain("[TRUNCATED size]");
  });
});

describe("sanitizeLogArgs", () => {
  it("scrubs an explicit message string", () => {
    const [, msg] = sanitizeLogArgs([{ ok: 1 }, "mail to citizen@example.org via https://KEY:SECRET@api.host failed"]);
    expect(msg).toBe(`mail to ${CENSOR} via https://${CENSOR}@api.host failed`);
  });

  it("scrubs the message pino would derive from an error", () => {
    // Without this the same string is scrubbed inside `err` and verbatim in `msg`.
    const err = new Error("no-reply@polyteia.de is not an authorized sender");
    const [payload, msg] = sanitizeLogArgs([err]);
    expect(payload).toEqual({ err });
    expect(msg).toBe(`${CENSOR} is not an authorized sender`);
  });

  it("keeps an explicitly provided message when an error is logged with one", () => {
    const [, msg] = sanitizeLogArgs([new Error("inner detail"), "notification.email.send-failed"]);
    expect(msg).toBe("notification.email.send-failed");
  });

  it("leaves a plain call alone", () => {
    expect(sanitizeLogArgs([{ status: 200 }, "http.request.end"])).toEqual([{ status: 200 }, "http.request.end"]);
  });
});
