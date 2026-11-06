import type {
  DocumentTemplatePageSize,
  DocumentType,
} from "./document.dto";
import { LEGACY_DOCUMENT_TEMPLATES } from "./document.catalog.legacy";

type CatalogTemplate = {
  slug: string;
  documentType: DocumentType;
  name: string;
  description: string;
  pageSize: DocumentTemplatePageSize;
  content: string;
};

const logo = `{{#if school.logoUrl}}<img class="legacy-school-logo" src="{{school.logoUrl}}" alt="School logo">{{/if}}`;

function wrapSection(
  source: string,
  start: string,
  end: string,
  flag: string,
) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return source;
  return `${source.slice(0, startIndex + start.length)}\n{{#if ${flag}}}${source.slice(startIndex + start.length, endIndex)}{{/if}}\n${source.slice(endIndex)}`;
}

/** Legacy report designs predate independent print flags. These targeted
 * adaptations preserve their markup while making each optional section obey
 * the current report-card contract.
 *
 * Every flag is addressed through `@root`: the per-subject mode columns are
 * wrapped inside `{{#each subjects}}`, where a bare `reportSections` path would
 * resolve against the subject and silently hide the body cells while the
 * header (rendered at the root) still showed them.
 */
function adaptReportFlags(source: string) {
  let adapted = source.replace(
    /{{#each (subjects\.\[0\]\.modeConfig|this\.modeConfig)}}([\s\S]*?){{\/each}}/g,
    "{{#if @root.reportSections.includeModeMarks}}{{#each $1}}$2{{/each}}{{/if}}",
  );
  // The attendance-focus design groups its mode columns under one header and
  // spans the summary labels across them; both must follow the same flag as
  // the mode columns or the table loses its column alignment.
  adapted = adapted
    .replace(
      '<th colspan="2">Obtained Marks</th>',
      '{{#if @root.reportSections.includeModeMarks}}<th colspan="2">Obtained Marks</th>{{/if}}',
    )
    .replaceAll(
      '<td colspan="4" style="text-align:right;">',
      '<td colspan="{{#if @root.reportSections.includeModeMarks}}4{{else}}2{{/if}}" style="text-align:right;">',
    );
  adapted = wrapSection(
    adapted,
    "<!-- Co-Scholastic Areas -->",
    "<!-- Attendance -->",
    "@root.reportSections.includeCoScholastics",
  );
  adapted = wrapSection(
    adapted,
    "<!-- Grading Scale -->",
    "<!-- Footer -->",
    "@root.reportSections.includeGradingScale",
  );
  adapted = adapted.replace(
    /(<!-- CO-SCHOLASTIC \+ ATTENDANCE -->[\s\S]*?<div class="section flex">\s*)(<div class="box">[\s\S]*?<\/div>)(\s*{{#if attendance}})/,
    "$1{{#if @root.reportSections.includeCoScholastics}}$2{{/if}}$3",
  );
  return wrapSection(
    adapted,
    "<!-- GRADING SCALE -->",
    "<!-- SIGNATURES -->",
    "@root.reportSections.includeGradingScale",
  );
}

/** Replace one legacy context path with its current name. Only whole paths are
 * replaced, so renaming `bill.period` cannot also rewrite an already-current
 * `bill.periodKey` (or any other path that merely starts with the same text).
 */
function renameContextPath(source: string, from: string, to: string) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source.replace(
    new RegExp(`(?<![\\w.$@-])${escaped}(?![\\w$-])`, "g"),
    to,
  );
}

function adaptFinanceContext(source: string, type: "bill" | "receipt") {
  const replacements: Array<[string, string]> = [
    ["student.name", "admission.name"],
    ["student.admissionNo", "admission.number"],
    ["student.className", "admission.classLabel"],
    ["student.sectionName", "admission.sectionLabel"],
    ["student.fatherName", "admission.fatherName"],
    ["student.motherName", "admission.motherName"],
    ["student.rollNo", "admission.rollNumber"],
    ["currency.symbol", "currency.code"],
  ];
  if (type === "bill") {
    replacements.push(
      ["lineItems", "lines"],
      ["bill.generatedAt", "bill.issueDate"],
      ["bill.statementDate", "bill.issueDate"],
      ["bill.frequency", "bill.periodKey"],
      ["bill.period", "bill.periodKey"],
      ["totalAmount", "bill.total"],
      ["outstandingBefore", "balanceBefore"],
      ["netBill", "balanceAfter"],
    );
  } else {
    replacements.push(
      ["receiptNo", "payment.receiptNumber"],
      ["payment.date", "payment.receivedAt"],
      ["payment.type", "payment.method"],
      ["amountPaid", "payment.amount"],
    );
  }
  let adapted = replacements.reduce(
    (value, [from, to]) => renameContextPath(value, from, to),
    source,
  );
  if (type === "bill") {
    adapted = adapted.replace(
      '<div class="title">Fee Bill</div>',
      '<div class="title">Fee Bill</div><div style="text-align:center;margin-bottom:6px;">Bill No: {{bill.number}}</div>',
    );
  } else {
    adapted = adapted
      .replaceAll(
        "Payment Receipt",
        "{{#if transaction.isRefund}}REFUND RECEIPT{{else}}PAYMENT RECEIPT{{/if}}",
      )
      .replaceAll(
        "Amount Paid",
        "{{#if transaction.isRefund}}Amount returned{{else}}Amount received{{/if}}",
      );
  }
  return adapted;
}

const LEGACY_ROOT = ".legacy-template";

/** Rewrite the document-root type selectors of one selector (no commas) to the
 * slot wrapper. Only standalone `html`/`body` type selectors match: the
 * lookbehind rejects class (`.body`), ID (`#body`), hyphenated (`.ac-body`),
 * longer (`tbody`) and pseudo/escaped names, and attribute selectors or quoted
 * strings are skipped verbatim. `html body` and `html > body` collapse to one
 * wrapper because both elements map to the same slot element.
 */
function scopeSelector(selector: string) {
  return selector
    .replace(/(^|[\s>+~(])html\s*>?\s*body(?![\w-])/gi, "$1body")
    .replace(
      /(\[[^\]]*\]|"[^"]*"|'[^']*')|(?<![\w\\.#:-])(?:html|body)(?![\w-])/gi,
      (_match, skipped: string | undefined) => skipped ?? LEGACY_ROOT,
    );
}

/** Scope legacy stylesheet rules written for a whole HTML page to one slot.
 * Only rule selector preludes (text immediately before `{`) are rewritten, so
 * declarations, comments and at-rule preludes (`@media …`) are never touched.
 * Comments are removed first so commented-out text cannot be mistaken for a
 * selector. Exported for focused unit tests.
 */
export function scopeLegacyDocumentCss(css: string) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[{};])([^{};@]+)(?=\{)/g, (_match, lead: string, list: string) => {
      const selectors = [
        ...new Set(list.split(",").map((part) => scopeSelector(part.trim()))),
      ];
      return `${lead}${selectors.join(", ")} `;
    });
}

/** Convert a complete legacy HTML document into one self-contained slot. The
 * outer renderer, not the template, owns physical page breaks and @page rules.
 */
function normalizeLegacyTemplate(
  original: string,
  documentType: Exclude<DocumentType, "statement">,
) {
  let source =
    documentType === "report_card"
      ? adaptReportFlags(original)
      : documentType === "bill" || documentType === "receipt"
        ? adaptFinanceContext(original, documentType)
        : original;
  source = source.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.includes("school.logoUrl")
      ? "School logo"
      : tag.includes("student.photoUrl")
        ? "Student photograph"
        : null;
    if (!alt) return tag;
    if (/\balt="[^"]*"/i.test(tag))
      return tag.replace(/\balt="[^"]*"/i, `alt="${alt}"`);
    return tag.replace(/>$/, ` alt="${alt}">`);
  });

  const pageRule = source.match(/@page\s*\{[\s\S]*?\}/i)?.[0] ?? "";
  const pageMargin = pageRule.match(/margin\s*:\s*([^;}]*)/i)?.[1]?.trim();
  const styles = scopeLegacyDocumentCss(
    [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
      .map((match) => match[1])
      .join("\n")
      .replace(/@page\s*\{[\s\S]*?\}/gi, ""),
  ).replace(/(?:page-)?break-after\s*:\s*always\s*;?/gi, "");
  const bodyMatch = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch?.[1]
    ? bodyMatch[1]
    : source.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  if (!source.includes("school.logoUrl")) {
    body = body.replace(
      /(<div class="(?:header|head)">)/,
      `$1\n${logo}`,
    );
  }
  const padding = pageMargin
    ? `padding:${pageMargin};`
    : documentType === "admit_card"
      ? "padding:8mm;"
      : "";
  // The border-box reset has zero specificity (:where) and precedes the
  // design's own rules, so any explicit box-sizing in the design still wins. Complete legacy documents declare it
  // globally already; the admit-card fragments do not, yet size their root at
  // height:100% plus padding and border, which overflows (and is clipped by)
  // the slot under content-box sizing.
  return `<style>:where(${LEGACY_ROOT},${LEGACY_ROOT} *,${LEGACY_ROOT} *::before,${LEGACY_ROOT} *::after){box-sizing:border-box}\n${styles}\n.legacy-template{box-sizing:border-box;width:100%;height:100%;overflow:hidden;${padding}}.legacy-school-logo{display:block;width:14mm;height:14mm;object-fit:contain;margin:0 auto 3mm}</style><div class="legacy-template">${body}</div>`;
}

function legacyPageSize(
  documentType: Exclude<DocumentType, "statement">,
  slug: string,
): DocumentTemplatePageSize {
  if (documentType === "admit_card") return "half";
  if (documentType === "bill" || documentType === "receipt")
    return slug.endsWith("-full") ? "full" : "half";
  return "full";
}

const legacyTemplates = Object.entries(LEGACY_DOCUMENT_TEMPLATES).flatMap(
  ([type, templates]) => {
    const documentType = type as Exclude<DocumentType, "statement">;
    return templates.map(
      (template): CatalogTemplate => ({
        slug: `${documentType}-${template.slug}`,
        documentType,
        name: template.name,
        description: template.description,
        pageSize: legacyPageSize(documentType, template.slug),
        content: normalizeLegacyTemplate(template.source, documentType),
      }),
    );
  },
);

function statementTemplate(compact: boolean) {
  const root = compact
    ? "font:11px Arial,sans-serif;padding:12px 16px"
    : "font:13px Arial,sans-serif;padding:15mm";
  return `<style>*{box-sizing:border-box}.statement{${root};height:100%;color:#222;overflow:hidden}.statement header{text-align:center;border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:10px}.statement .legacy-school-logo{width:${compact ? "11mm" : "16mm"};height:${compact ? "11mm" : "16mm"};object-fit:contain;margin-bottom:4px}.statement h1{font-size:${compact ? "15px" : "22px"};margin:0}.statement p{margin:3px 0}.statement .title{text-align:center;font-weight:bold;letter-spacing:1px;margin:8px 0}.statement .details,.statement table{width:100%;border-collapse:collapse}.statement .details td{padding:2px 5px}.statement th,.statement td{border:1px solid #999;padding:${compact ? "3px 5px" : "7px 9px"};text-align:left}.statement th{background:#f0f0f0}.statement .amount{text-align:right}.statement .summary{display:flex;justify-content:space-between;border:1px solid #999;padding:${compact ? "6px" : "10px"};margin:8px 0}.statement footer{display:flex;justify-content:space-between;margin-top:10px;color:#666;font-size:9px}</style><main class="statement"><header>${logo}<h1>{{school.name}}</h1><p>{{school.location}}</p>{{#if school.registrationNo}}<p>Reg. No: {{school.registrationNo}}</p>{{/if}}</header><div class="title">ACCOUNT STATEMENT</div><table class="details"><tr><td><strong>Student</strong></td><td>{{admission.name}}</td><td><strong>Admission No.</strong></td><td>{{admission.number}}</td></tr><tr><td><strong>Class / Section</strong></td><td>{{admission.classLabel}} {{admission.sectionLabel}}</td><td><strong>Statement period</strong></td><td>{{statement.periodStartDate}} – {{statement.throughDate}}</td></tr></table><div class="summary"><span>Opening balance</span><strong>{{currency.code}} {{statement.openingBalance}}</strong></div><table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="amount">Debit</th><th class="amount">Credit</th><th class="amount">Balance</th></tr></thead><tbody>{{#each entries}}<tr><td>{{effectiveAt}}</td><td>{{reference}}</td><td>{{description}}</td><td class="amount">{{debit}}</td><td class="amount">{{credit}}</td><td class="amount">{{balance}}</td></tr>{{else}}<tr><td colspan="6">No account activity in this period.</td></tr>{{/each}}</tbody></table><div class="summary"><span>Closing balance</span><strong>{{currency.code}} {{statement.closingBalance}}</strong></div><footer><span>Computer-generated statement</span><span>Generated {{generatedAt}}</span></footer></main>`;
}

const statementTemplates: CatalogTemplate[] = [
  {
    slug: "statement-default",
    documentType: "statement",
    name: "Standard Account Statement (Half A4)",
    description:
      "A half-A4 account statement adapted from the legacy finance templates. Two statements print per sheet.",
    pageSize: "half",
    content: statementTemplate(true),
  },
  {
    slug: "statement-compact",
    documentType: "statement",
    name: "Compact Account Statement (Half A4)",
    description:
      "An ink-friendly half-A4 statement for concise account histories. Two statements print per sheet.",
    pageSize: "half",
    content: statementTemplate(true).replace("border-bottom:2px", "border-bottom:1px"),
  },
  {
    slug: "statement-default-full",
    documentType: "statement",
    name: "Standard Account Statement (Full A4)",
    description:
      "A spacious full-A4 account statement for longer account histories.",
    pageSize: "full",
    content: statementTemplate(false),
  },
];

/** Published slugs are immutable provenance. The current catalog intentionally
 * replaces the former generated style families with the legacy application’s
 * named designs, plus matching statement designs which had no legacy source.
 */
export const DOCUMENT_MARKETPLACE: CatalogTemplate[] = [
  ...legacyTemplates,
  ...statementTemplates,
];
