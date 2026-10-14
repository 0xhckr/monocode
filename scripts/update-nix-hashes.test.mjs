import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { refreshHashes } from "./update-nix-hashes.mjs";

const oldHash = `sha256-${"A".repeat(43)}=`;
const newHash = `sha256-${"B".repeat(43)}=`;
const mismatch = {
  status: 1,
  output: `error: hash mismatch in fixed-output derivation '/nix/store/deps.drv':
         specified: ${oldHash}
            got:    ${newHash}
`,
};
const success = { status: 0, output: "" };

function fixture(t) {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), "monocode-nix-hashes-"),
  );
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repository, "nix"));
  const hashFile = path.join(repository, "nix/dependency-hashes.json");
  const original = `${JSON.stringify({ cargoHash: oldHash, npmHash: oldHash }, null, 2)}\n`;
  fs.writeFileSync(hashFile, original);
  return { repository, hashFile, original };
}

test("leaves matching hashes unchanged", (t) => {
  const { repository, hashFile, original } = fixture(t);
  refreshHashes(repository, () => success);
  assert.equal(fs.readFileSync(hashFile, "utf8"), original);
});

test("refreshes and verifies both dependency hashes", (t) => {
  const { repository, hashFile } = fixture(t);
  const calls = [];
  refreshHashes(repository, (attribute) => {
    calls.push(attribute);
    return calls.length % 2 === 1 ? mismatch : success;
  });
  assert.deepEqual(calls, ["npmDeps", "npmDeps", "cargoDeps", "cargoDeps"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(hashFile, "utf8")), {
    cargoHash: newHash,
    npmHash: newHash,
  });
});

test("restores all hashes if a later dependency fails", (t) => {
  const { repository, hashFile, original } = fixture(t);
  const results = [mismatch, success, { status: 1, output: "network failure" }];
  assert.throws(
    () => refreshHashes(repository, () => results.shift()),
    /network failure/,
  );
  assert.equal(fs.readFileSync(hashFile, "utf8"), original);
});

test("does not accept a hash until the dependency rebuild succeeds", (t) => {
  const { repository, hashFile, original } = fixture(t);
  assert.throws(
    () => refreshHashes(repository, () => mismatch),
    /hash mismatch/,
  );
  assert.equal(fs.readFileSync(hashFile, "utf8"), original);
});
