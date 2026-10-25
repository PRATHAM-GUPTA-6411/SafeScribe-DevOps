"use strict";
// Guards the claim "files copied from the original SafeScribe are unchanged".
// If one of these fails, a file was altered (even by tooling adding metadata). Restore it from the original zip.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REPO = path.resolve(__dirname, "..", "..");
const lines = fs
  .readFileSync(path.join(REPO, "docs", "ORIGINAL_FILE_HASHES.txt"), "utf8")
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("#"))
  .map((l) => l.trim().split(/\s+/));

test("hash list covers all 10 original files", () => {
  assert.equal(lines.length, 10);
});

for (const [hash, original, repoPath] of lines) {
  if (repoPath === "-") continue;
  test(`${repoPath} is byte-identical to the original ${original}`, () => {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(REPO, repoPath))).digest("hex");
    assert.equal(actual, hash);
  });
}
