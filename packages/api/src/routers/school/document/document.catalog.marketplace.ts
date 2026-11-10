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

/** Types whose designs were imported from the legacy application. */
type LegacyDocumentType = Exclude<DocumentType, "statement" | "notice">;

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

/** Legacy report designs took their mode columns from the first subject
 * (`subjects.[0].modeConfig`) and each row's cells from that row's own
 * `modeConfig`, which only lines up when every subject has the same modes.
 * Headers and the total row now iterate the report-wide `modeColumns`, and
 * rows iterate `modeCells` (one per column, blank where the subject lacks the
 * mode). A column's maximum is printed only when all its subjects share it.
 *
 * Catalog source is copied into immutable school revisions on import, so this
 * changes only future imports; revisions already imported keep their markup,
 * and `marks`/`modeConfig` stay in the context for them.
 */
function adaptReportModeColumns(source: string) {
  return source
    .replaceAll("{{#each subjects.[0].modeConfig}}", "{{#each @root.modeColumns}}")
    .replaceAll(
      "{{this.name}} ({{this.maxMarks}})",
      "{{this.name}}{{#if this.maxMarks}} ({{this.maxMarks}}){{/if}}",
    )
    .replace(
      /{{#each this\.modeConfig}}(\s*)<td>{{lookup \.\.\/marks @key}}<\/td>(\s*){{\/each}}/g,
      "{{#each this.modeCells}}$1<td>{{#if this.applicable}}{{this.mark}}{{/if}}</td>$2{{/each}}",
    );
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
  let adapted = adaptReportModeColumns(source).replace(
    /{{#each (@root\.modeColumns|this\.modeCells)}}([\s\S]*?){{\/each}}/g,
    "{{#if @root.reportSections.includeModeMarks}}{{#each $1}}$2{{/each}}{{/if}}",
  );
  // The attendance-focus design groups its mode columns under one header and
  // spans the summary labels across them; both must follow the same flag as
  // the mode columns or the table loses its column alignment.
  adapted = adapted
    .replace(
      '<th colspan="2">Obtained Marks</th>',
      '{{#if @root.reportSections.includeModeMarks}}<th colspan="{{@root.modeColumns.length}}">Obtained Marks</th>{{/if}}',
    )
    .replaceAll(
      '<td colspan="4" style="text-align:right;">',
      '<td colspan="{{#if @root.reportSections.includeModeMarks}}{{add @root.modeColumns.length 2}}{{else}}2{{/if}}" style="text-align:right;">',
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
  documentType: LegacyDocumentType,
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
  documentType: LegacyDocumentType,
  slug: string,
): DocumentTemplatePageSize {
  if (documentType === "admit_card") return "half";
  if (documentType === "bill" || documentType === "receipt")
    return slug.endsWith("-full") ? "full" : "half";
  return "full";
}

const legacyTemplates = Object.entries(LEGACY_DOCUMENT_TEMPLATES).flatMap(
  ([type, templates]) => {
    const documentType = type as LegacyDocumentType;
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

/**
 * The built-in notice design. It is also what a plain-text notice is
 * rendered with while the school has selected no Notice template, so it
 * must always render a title and the paragraphs, at both print sizes.
 *
 * Notice designs are size-adaptive: every notice chooses full or half A4
 * (`notice.page_size`) and the design reads it as `print.size`. The root
 * carries `notice--{{print.size}}`, and the `.notice--half` rules make the
 * letterhead and type compact enough for a half-A4 page. A Notice catalog
 * entry's `pageSize` is therefore always `full` (it is not a footprint for
 * notices; see `validateTemplatePageSize`).
 *
 * It has no fixed height and no outer padding: notices flow over as many
 * pages as they need and the renderer's `@page` margin frames every page
 * (`flowingNoticeLayout`). Paragraph text keeps the author's line breaks
 * through `white-space: pre-wrap`; values are escaped by Handlebars.
 */
export const NOTICE_DEFAULT_TEMPLATE_SLUG = "notice-default";
const noticeDefaultTemplate = `<style>.notice{font:14px/1.55 Arial,Helvetica,sans-serif;color:#1f2933}.notice *{box-sizing:border-box}.notice-head{display:flex;align-items:center;gap:5mm;padding-bottom:4mm;border-bottom:2px solid #1f2933}.notice-head img{width:20mm;height:20mm;object-fit:contain;flex:none}.notice-school{flex:1;min-width:0}.notice-school h1{margin:0;font-size:22px;line-height:1.2}.notice-school p{margin:1mm 0 0;font-size:12px;color:#52606d}.notice-meta{display:flex;justify-content:space-between;gap:6mm;margin:5mm 0 0;font-size:12px;color:#52606d}.notice-label{margin:7mm 0 2mm;text-align:center;font-size:13px;font-weight:bold;letter-spacing:3px;text-transform:uppercase}.notice-title{margin:0 0 6mm;text-align:center;font-size:18px;line-height:1.3}.notice-body p{margin:0 0 4mm;white-space:pre-wrap;overflow-wrap:anywhere;orphans:2;widows:2}.notice--half{font-size:12px;line-height:1.45}.notice--half .notice-head{gap:3mm;padding-bottom:2mm}.notice--half .notice-head img{width:12mm;height:12mm}.notice--half .notice-school h1{font-size:16px}.notice--half .notice-school p{margin-top:0.5mm;font-size:10px}.notice--half .notice-meta{margin-top:2mm;font-size:10px}.notice--half .notice-label{margin:3mm 0 1mm;font-size:10px;letter-spacing:2px}.notice--half .notice-title{margin:0 0 3mm;font-size:14px}.notice--half .notice-body p{margin:0 0 2mm}</style>
<div class="notice notice--{{print.size}}">
  <header class="notice-head">
    {{#if school.logoUrl}}<img src="{{school.logoUrl}}" alt="School logo">{{/if}}
    <div class="notice-school">
      <h1>{{school.name}}</h1>
      {{#if school.location}}<p>{{school.location}}</p>{{/if}}
      {{#if school.registrationNo}}<p>Registration no. {{school.registrationNo}}</p>{{/if}}
    </div>
  </header>
  <div class="notice-meta">
    <span>Session {{session.startYear}}-{{session.endYear}}</span>
    <span>Date: {{notice.issuedOnDisplay}}</span>
  </div>
  <p class="notice-label">Notice</p>
  <h2 class="notice-title">{{notice.title}}</h2>
  <main class="notice-body">
    {{#each notice.paragraphs}}<p>{{this}}</p>{{/each}}
  </main>
</div>`;

/**
 * A compact letterhead: logo, school name and date on one line, a thin
 * rule and the title. Designed for half-A4 notices (it leaves most of a
 * half page for the text) and still tidy on full A4, where `.notice--full`
 * only enlarges the type.
 */
const noticeCompactTemplate = `<style>.cn{font:12px/1.45 Arial,Helvetica,sans-serif;color:#1f2933}.cn *{box-sizing:border-box}.cn-head{display:flex;align-items:center;gap:3mm;padding-bottom:1.5mm;border-bottom:1px solid #9aa5b1}.cn-head img{width:10mm;height:10mm;object-fit:contain;flex:none}.cn-school{flex:1;min-width:0}.cn-school strong{display:block;font-size:14px;line-height:1.2}.cn-school span{font-size:9.5px;color:#52606d}.cn-date{flex:none;text-align:right;font-size:10px;color:#52606d}.cn-title{margin:3mm 0 2mm;font-size:13px;line-height:1.3}.cn-title small{display:block;font-size:9px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#52606d}.cn-body p{margin:0 0 2mm;white-space:pre-wrap;overflow-wrap:anywhere;orphans:2;widows:2}.cn--full{font-size:14px;line-height:1.55}.cn--full .cn-head img{width:14mm;height:14mm}.cn--full .cn-school strong{font-size:18px}.cn--full .cn-school span,.cn--full .cn-date{font-size:11px}.cn--full .cn-title{margin:5mm 0 4mm;font-size:17px}.cn--full .cn-body p{margin-bottom:3.5mm}</style>
<div class="cn cn--{{print.size}}">
  <header class="cn-head">
    {{#if school.logoUrl}}<img src="{{school.logoUrl}}" alt="School logo">{{/if}}
    <div class="cn-school">
      <strong>{{school.name}}</strong>
      {{#if school.location}}<span>{{school.location}}</span>{{/if}}
    </div>
    <div class="cn-date">{{notice.issuedOnDisplay}}<br>Session {{session.startYear}}-{{session.endYear}}</div>
  </header>
  <h2 class="cn-title"><small>Notice</small>{{notice.title}}</h2>
  <main class="cn-body">
    {{#each notice.paragraphs}}<p>{{this}}</p>{{/each}}
  </main>
</div>`;

const noticeTemplates: CatalogTemplate[] = [
  {
    slug: NOTICE_DEFAULT_TEMPLATE_SLUG,
    documentType: "notice",
    name: "Standard Notice",
    description:
      "A school letterhead with the notice date, title and text. Prints full or half A4 (a smaller letterhead on half pages); long notices continue on further pages.",
    pageSize: "full",
    content: noticeDefaultTemplate,
  },
  {
    slug: "notice-compact",
    documentType: "notice",
    name: "Compact Notice",
    description:
      "A one-line letterhead that leaves room for the text, made for half-A4 notices (two copies per A4 sheet) and also tidy on full A4.",
    pageSize: "full",
    content: noticeCompactTemplate,
  },
];

/** Published slugs are immutable provenance. The current catalog intentionally
 * replaces the former generated style families with the legacy application’s
 * named designs, plus matching statement designs which had no legacy source.
 */
export const DOCUMENT_MARKETPLACE: CatalogTemplate[] = [
  ...legacyTemplates,
  ...statementTemplates,
  ...noticeTemplates,
];
