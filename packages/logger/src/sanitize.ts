/**
 * Log sanitiser — the logger's own safety net for secrets.
 *
 * The `redact` list on the pino options is a shallow key-path filter: it matches
 * `password` and `*.password`, and nothing deeper. That is enough for objects we
 * build ourselves and useless against anything we did not build, which in
 * practice means errors thrown by HTTP clients. An axios-shaped error carries the
 * whole request on itself, so one `log.error({ err }, …)` can write the request
 * body and the API credentials that signed it — the credentials in several
 * encodings at once, including a base64 `Authorization: Basic …` header and
 * `https://key:secret@host/…` URLs that no key-name filter can recognise.
 *
 * The first line of defence is not putting secrets in an error at all (see
 * `@campuspilot/email`, which rebuilds provider failures from an allowlist). This is
 * the layer that catches what we did not build and did not foresee.
 *
 * Two rules:
 * - {@link DENY_KEYS} / {@link DENY_SUFFIXES}: value replaced with the censor,
 *   matched on a normalised key so `API_KEY`, `apiKey` and `api-key` are one
 *   rule. Covers outright secrets and the HTTP/socket plumbing that hides them.
 *   Nothing is deleted — a missing key reads as "never logged", which sends
 *   whoever is debugging hunting for a field that is right there.
 * - {@link scrubString}: patterns that survive any key-based rule, because the
 *   secret is inside a string rather than under a name.
 * - {@link ERROR_ALLOWED_KEYS}: on an `Error`, the rule inverts — every own
 *   property outside the allowlist is censored, denied or not. A denylist can
 *   only ever name the payload carriers we have already met; an error is where
 *   the ones we have not met arrive.
 *
 * Applied in two places, because pino splits a record in two:
 * - {@link sanitizeLogRecord} as `formatters.log`, for the logged object.
 * - {@link sanitizeLogArgs} as the `logMethod` hook, for `msg` — which
 *   `formatters.log` never sees.
 *
 * Bounded on purpose ({@link MAX_DEPTH}, {@link MAX_NODES}): this runs on every
 * log call, and a runaway walk must cost a truncated line, not a stalled request.
 */

export const CENSOR = '[REDACTED]';

/**
 * Keys whose value is replaced with {@link CENSOR}.
 *
 * Two groups, one behaviour. The first are secrets in their own right. The
 * second are HTTP client and socket internals — `config`, `request`, the socket
 * and TLS graph — which are both where an SDK error hides its credentials and
 * megabytes of noise.
 */
const DENY_KEYS = new Set([
  'config',
  'request',
  'req',
  'res',
  'socket',
  'agent',
  'client',
  'parser',
  'header',
  'redirectable',
  'httpmessage',
  'tlsoptions',
  'sessioncache',
  'ssl',
  'password',
  'passwordhash',
  'secret',
  'apikey',
  'apisecret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'authorization',
  'auth',
  'bearer',
  'cookie',
  'setcookie',
  'credentials',
  'clientsecret',
  'privatekey',
  'otp',
  'email',
  'emailaddress',
  // Payload carriers. Not secrets — request and event bodies, database rows,
  // validation input: the user's own data, which has no business in a log line
  // whatever it is called. The `Error` allowlist covers these when they arrive
  // on an error; these entries cover the same names on anything else, including
  // the object a third-party library hands to `console.error` (see
  // `patchConsole`, which logs it as `payload`).
  'payload',
  'body',
  'rawbody',
  'event',
  'events',
  'issues',
  'detail',
  'internalquery',
  'rows',
  'row',
]);

/**
 * Suffix forms of {@link DENY_KEYS}, so a prefixed field is covered without
 * enumerating every prefix: `contactEmail`, `mailjetApiSecret`, `csrfToken`.
 */
const DENY_SUFFIXES = [
  'password',
  'secret',
  'token',
  'apikey',
  'email',
  'otp',
  'cookie',
];

/** An Error's identity lives in non-enumerable properties; copy them by hand. */
const ERROR_STRING_FIELDS = ['name', 'message', 'stack'] as const;

/**
 * The only own properties kept on an `Error`. Everything else is censored.
 *
 * Inverted from the rest of the module on purpose. An error is the one place a
 * request payload arrives under a name nobody chose: `ZodError.issues` carries
 * the values that failed validation, a `pg` `DatabaseError` carries row values
 * in `detail` and bound values in `internalQuery`, an axios error carries the
 * provider's response body in `response.data`, and a hand-thrown error carries
 * whatever was attached to it. Naming each of those in {@link DENY_KEYS} only
 * covers the shapes we have already been bitten by.
 *
 * Kept entries are the identity fields plus diagnostics that name a thing
 * rather than carry a value: an error class, a status, a constraint or column
 * name, a source position. Nothing here can hold a row.
 *
 * `message` and `stack` are the deliberate exception, and the reason "payload
 * never reaches the log" is a rule about fields and not a guarantee about text:
 * a library is free to interpolate a value into its own message ("invalid tax
 * id 12 345"), and dropping the message would leave an error record that says
 * nothing. {@link scrubString} is what runs over them.
 */
const ERROR_ALLOWED_KEYS = new Set([
  // Identity, for the enumerable case — `Object.assign(err, { name: "ZodError" })`.
  'type',
  'name',
  'message',
  'stack',
  'cause',
  // Machine-readable classification.
  'code',
  'errno',
  'syscall',
  'status',
  'statuscode',
  'severity',
  // Schema identifiers from a `pg` DatabaseError. Names of database objects,
  // never their contents — `detail`, `where`, `hint` and `internalQuery` hold
  // the contents and are deliberately absent.
  'constraint',
  'table',
  'column',
  'datatype',
  'schema',
  // Where in the source, not what the source was handed.
  'routine',
  'file',
  'line',
  'position',
]);

const MAX_DEPTH = 8;
const MAX_NODES = 1500;

/** `API_KEY`, `api-key` and `apiKey` all normalise to `apikey`. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function isDenied(normalized: string): boolean {
  if (DENY_KEYS.has(normalized)) return true;
  return DENY_SUFFIXES.some(
    (suffix) =>
      normalized.length > suffix.length && normalized.endsWith(suffix),
  );
}

/**
 * Credentials that no key-based rule can catch, because the key is innocent and
 * the secret is inside the string.
 *
 * The URL rule runs first so it can keep the scheme it matched.
 */
function scrubString(value: string): string {
  return (
    value
      // https://KEY:SECRET@host/path — axios records this as the resolved URL.
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, `$1${CENSOR}@`)
      // Authorization: Basic <base64(key:secret)> — a raw request header dump.
      .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9\-._~+/]{8,}=*/gi, `$1 ${CENSOR}`)
      // Bare addresses: senders and recipients leak through provider messages
      // ("… is not an authorized sender") as often as through named fields.
      //
      // Narrower than a spec-complete address on purpose. `/` is excluded from
      // the local part and the last label must be alphabetic, so it cannot
      // swallow a file path or a `package@1.2.3` version string — both of which
      // appear in stack traces, the thing an error log exists for.
      .replace(
        /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
        CENSOR,
      )
  );
}

interface Budget {
  nodes: number;
}

function sanitizeValue(
  value: unknown,
  depth: number,
  budget: Budget,
  seen: Set<object>,
): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;

  if (depth >= MAX_DEPTH) return '[TRUNCATED depth]';
  if (budget.nodes >= MAX_NODES) return '[TRUNCATED size]';
  budget.nodes += 1;

  const obj = value;

  // Leaves. Checked before `seen` so they are never treated as ancestors —
  // otherwise the same Date under two keys would report as a cycle.
  if (obj instanceof Date || obj instanceof RegExp) return value;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj))
    return `[Buffer ${obj.length}]`;

  // `seen` holds the ancestors of this node, not everything visited: a value
  // that legitimately appears twice in one record is not a cycle, and calling it
  // one would put a false statement in the log. Released on the way out below,
  // so only genuine self-reference is reported.
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  if (Array.isArray(obj)) {
    const items = obj.map((entry) =>
      sanitizeValue(entry, depth + 1, budget, seen),
    );
    seen.delete(obj);
    return items;
  }

  const out: Record<string, unknown> = {};
  const isError = obj instanceof Error;

  // An Error's identity is non-enumerable, so a plain key walk would reduce it
  // to `{}` — and pino's own error serializer never sees this object, because
  // `formatters.log` runs before `serializers`. `type` is emitted to preserve the
  // field that serializer used to write, so existing log queries keep working.
  if (obj instanceof Error) {
    out.type = obj.constructor?.name ?? 'Error';
    for (const field of ERROR_STRING_FIELDS) {
      const field_value = (obj as unknown as Record<string, unknown>)[field];
      if (typeof field_value === 'string')
        out[field] = scrubString(field_value);
    }
    // `cause` is an own property but non-enumerable, so the key walk misses it.
    // It is the usual place a wrapped provider error hides.
    if (obj.cause !== undefined)
      out.cause = sanitizeValue(obj.cause, depth + 1, budget, seen);
  }

  for (const [key, entry] of Object.entries(obj)) {
    const normalized = normalizeKey(key);
    if (
      isDenied(normalized) ||
      (isError && !ERROR_ALLOWED_KEYS.has(normalized))
    ) {
      out[key] = CENSOR;
      continue;
    }
    out[key] = sanitizeValue(entry, depth + 1, budget, seen);
  }

  seen.delete(obj);
  return out;
}

/**
 * Sanitise the object of one log record. Wired in as `formatters.log`, which
 * hands us the merged bindings + logged object and takes our return value as the
 * record to write.
 */
export function sanitizeLogRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const result = sanitizeValue(record, 0, { nodes: 0 }, new Set());
  // sanitizeValue returns a plain object for any object input; the guard is for
  // the type system, and for a contract that must never widen.
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : record;
}

/**
 * Sanitise the arguments of one log call, which is where `msg` lives.
 *
 * `formatters.log` never sees the message string, so on its own it leaves a whole
 * field unguarded — and not a minor one. pino derives `msg` from `err.message`
 * when an error is logged as the first argument, so an unsanitised error would
 * print its address-bearing text as `msg` while the very same string sat scrubbed
 * inside `err`. `patchConsole` passes `err.message` explicitly, which is the path
 * every third-party library takes.
 *
 * The error-first form is rewritten to the object form pino would build anyway
 * (`{ err }` plus a message), so the record's shape is unchanged and only the
 * message text differs.
 */
export function sanitizeLogArgs(args: unknown[]): unknown[] {
  const [first] = args;
  if (first instanceof Error) {
    const provided = typeof args[1] === 'string' ? args[1] : first.message;
    return [{ err: first }, scrubString(provided), ...args.slice(2)];
  }
  return args.map((arg) => (typeof arg === 'string' ? scrubString(arg) : arg));
}
