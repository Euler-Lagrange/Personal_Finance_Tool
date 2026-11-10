import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { toCsv } from "../core/csv";
import { summarizeYear } from "../core/year";
import { cellRef, excelDay, toXlsx, zip } from "./export";

/** Reads a zip back by walking its directory, the way a spreadsheet program would. */
function unzip(archive: Buffer): Map<string, string> {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const files = new Map<string, string>();
  let at = archive.readUInt32LE(end + 16);
  for (let i = 0; i < archive.readUInt16LE(end + 10); i++) {
    expect(archive.readUInt32LE(at)).toBe(0x02014b50);
    const packedSize = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const local = archive.readUInt32LE(at + 42);
    expect(archive.readUInt32LE(local)).toBe(0x04034b50);
    const dataStart = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(archive.subarray(dataStart, dataStart + packedSize));
    expect(zlib.crc32(data)).toBe(archive.readUInt32LE(at + 16));
    expect(data.length).toBe(archive.readUInt32LE(at + 24));
    files.set(name, data.toString("utf8"));
    at += 46 + nameLength;
  }
  return files;
}

describe("export", () => {
  it("writes a zip that reads back byte for byte", () => {
    const files = unzip(zip([{ name: "a.txt", data: Buffer.from("hello") }, { name: "dir/b.txt", data: Buffer.from("x".repeat(5000)) }]));
    expect([...files.keys()]).toEqual(["a.txt", "dir/b.txt"]);
    expect(files.get("a.txt")).toBe("hello");
    expect(files.get("dir/b.txt")).toHaveLength(5000);
  });

  it("names cells and counts days the way Excel does", () => {
    expect([cellRef(0, 0), cellRef(25, 0), cellRef(26, 9), cellRef(701, 0), cellRef(702, 0)]).toEqual(["A1", "Z1", "AA10", "ZZ1", "AAA1"]);
    expect(excelDay("1900-03-01")).toBe(61);
    expect(excelDay("2026-12-05")).toBe(46361);
  });

  it("builds a workbook with one part per sheet, typed cells and safe text", () => {
    const files = unzip(
      toXlsx([
        { name: "Transactions", rows: [["Date", "Description", "Amount"], [{ date: "2026-12-05" }, 'Tom & "Jerry" <deli>', { money: 126699 }], [null, "", 3]] },
        { name: "Year: A/B [2026] and a very long sheet name indeed", rows: [["Only"]] },
      ]),
    );
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A2" s="2"><v>46361</v></c>');
    expect(sheet).toContain("Tom &amp; &quot;Jerry&quot; &lt;deli&gt;");
    expect(sheet).toContain('<c r="C2" s="1"><v>1266.99</v></c>');
    expect(sheet).toContain('<c r="C3"><v>3</v></c>');
    expect(sheet).not.toContain('r="A3"');
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Year  A B  2026  and a very lon" sheetId="2" r:id="rId2"/>');
  });

  it("writes CSV that keeps commas, quotes and line breaks inside one value", () => {
    expect(toCsv([["Date", "Description", "Amount"], [{ date: "2026-12-05" }, 'Deli, "the good one"', { money: -1250 }], [null, "two\nlines", 3]])).toBe(
      'Date,Description,Amount\r\n2026-12-05,"Deli, ""the good one""",-12.50\r\n,"two\nlines",3\r\n',
    );
  });
});

describe("the year summary", () => {
  const months = (...pairs: [number, number][]) => {
    const out = Array.from({ length: 12 }, () => 0);
    for (const [m, c] of pairs) out[m] = c;
    return out;
  };
  it("totals each row and group and averages over the months that have entries", () => {
    const s = summarizeYear(
      [
        { category_id: 1, name: "Housing", grp: "Needs", kind: "expense", monthly: months([0, 100000], [1, 100000], [2, 110000]) },
        { category_id: 2, name: "Groceries", grp: "Needs", kind: "expense", monthly: months([0, 40000], [2, 50001]) },
        { category_id: 3, name: "Hobbies", grp: "Wants", kind: "expense", monthly: months([1, 9000]) },
        { category_id: 4, name: "Odd", grp: "Elsewhere", kind: "expense", monthly: months([2, 500]) },
        { category_id: 5, name: "Paycheck", grp: "Income", kind: "income", monthly: months([0, 300000], [1, 300000], [2, 300000]) },
      ],
      ["Needs", "Wants", "Savings"],
      3,
    );
    expect(s.groups.map((g) => [g.grp, g.total, g.average])).toEqual([["Needs", 400001, 133334], ["Wants", 9000, 3000], ["Elsewhere", 500, 167]]);
    expect(s.groups[0].rows[1]).toMatchObject({ name: "Groceries", total: 90001, average: 30000 });
    expect(s.income).toMatchObject({ total: 900000, average: 300000 });
    expect(s.expenses.total).toBe(409501);
    expect(s.net.monthly.slice(0, 3)).toEqual([160000, 191000, 139499]);
    expect(s.net.total).toBe(s.income.total - s.expenses.total);
    expect(summarizeYear([], ["Needs"], 0)).toMatchObject({ groups: [], expenses: { total: 0, average: 0 } });
  });
});
