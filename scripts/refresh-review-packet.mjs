import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packetPath = resolve(root, "docs/reviews/CLAUDE_REVIEW_CURRENT.md");
const start = "<!-- BEGIN CURRENT CODE REVIEW CONTEXT -->";
const end = "<!-- END CURRENT CODE REVIEW CONTEXT -->";
const read = async (path) =>
  (await readFile(path, "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

async function section(path, title) {
  const source = resolve(root, path);
  let text = await read(source);
  text = text.replace(/^# [^\n]+\n+/, "");
  text = text.replace(/^(#{1,5}) /gm, "#$1 ");
  text = text.replace(
    /(!?\[[^\]\n]*\]\()([^\n)]+)(\))/g,
    (match, prefix, target, suffix) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) return match;
      const [file, ...anchor] = target.split("#");
      const absolute = resolve(dirname(source), decodeURI(file));
      if (!absolute.startsWith(root + sep))
        throw new Error(`Document link escapes the repository: ${path}`);
      const destination = relative(dirname(packetPath), absolute)
        .split(sep)
        .join("/");
      return (
        prefix +
        encodeURI(destination) +
        (anchor.length ? "#" + anchor.join("#") : "") +
        suffix
      );
    },
  );
  return `## ${title}\n\n${text.trim()}\n\n`;
}

const previous = await read(packetPath);
let packet = previous;
const blockStart = packet.indexOf(start);
if (blockStart >= 0) {
  const blockEnd = packet.indexOf(end, blockStart);
  if (blockEnd < 0) throw new Error("Review context has no closing marker.");
  packet =
    packet.slice(0, blockStart) +
    packet.slice(blockEnd + end.length).replace(/^\n+/, "");
}
async function replaceSection(heading, nextHeading, path) {
  const from = packet.indexOf(`## ${heading}\n`);
  const to = packet.indexOf(`## ${nextHeading}\n`, from + 1);
  if (from < 0 || to < 0)
    throw new Error(`Historical packet boundary missing: ${heading}`);
  packet =
    packet.slice(0, from) + (await section(path, heading)) + packet.slice(to);
}
await replaceSection(
  "Current requirements",
  "Current architecture",
  "docs/REQUIREMENTS.md",
);
await replaceSection(
  "Current architecture",
  "Follow-up review response",
  "docs/ARCHITECTURE.md",
);

const sources = [
  ["docs/CODE_REVIEW_GUIDE.md", "Current independent code review guide"],
  ["docs/REQUIREMENTS_TRACEABILITY.md", "Current requirements traceability"],
  ["docs/DESIGN_DECISIONS.md", "Current implementation decisions"],
  ["docs/reference/SCREENSHOTS.md", "Original screenshot reference"],
  [
    "docs/design/SHEETS_CATEGORY_DEFAULTS.md",
    "Implemented Sheets category defaults",
  ],
  [
    "docs/design/PAY_HOURS_BACKUP_PLAN.md",
    "November 4 pay, hours and backup extension proposal",
  ],
];
let context = `${start}\n\nThis section is refreshed from the canonical review documents by \`npm run docs:refresh\`. Screenshot links reference the nine source PNGs in the repository; sharing this Markdown alone does not attach those images. Current requirements and architecture later in this packet are refreshed by the same command. The November 4 extension distinguishes planned payroll/backups from the implemented UI correction. Older checkpoint notes and supplied reviews remain historical.\n\n`;
for (const [path, title] of sources) context += await section(path, title);
context += `${end}\n\n`;
const headingEnd = packet.indexOf("\n\n");
if (headingEnd < 0) throw new Error("Packet title boundary missing.");
packet =
  packet.slice(0, headingEnd + 2) + context + packet.slice(headingEnd + 2);
packet = packet.trimEnd() + "\n";

if (process.argv.includes("--check")) {
  if (packet !== previous) {
    process.stderr.write("Review packet is stale. Run npm run docs:refresh.\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("Review packet matches the canonical documents.\n");
  }
} else {
  await writeFile(packetPath, packet, "utf8");
  process.stdout.write("Updated the complete Claude review packet.\n");
}
