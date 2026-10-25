"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const dynalite = require("dynalite");
const { DynamoDBClient, CreateTableCommand } = require("@aws-sdk/client-dynamodb");
const { createNotesRepo } = require("../src/notesRepo");

// Dummy credentials: the emulator accepts anything.
process.env.AWS_ACCESS_KEY_ID = "test";
process.env.AWS_SECRET_ACCESS_KEY = "test";

const TABLE = "SafeScribeNotesTest";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server;
let repo;

test.before(async () => {
  server = dynalite({ createTableMs: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const admin = new DynamoDBClient({ region: "us-east-1", endpoint });
  await admin.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "userId", KeyType: "HASH" },
        { AttributeName: "noteId", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "userId", AttributeType: "S" },
        { AttributeName: "noteId", AttributeType: "S" },
      ],
    })
  );
  repo = createNotesRepo({ tableName: TABLE, region: "us-east-1", endpoint });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("create then list returns the stored note", async () => {
  const note = await repo.create("u-create", "CIPHERTEXT-A");
  assert.match(note.id, /^[0-9a-f-]{36}$/);
  assert.equal(note.createdAt, note.updatedAt);
  const list = await repo.list("u-create");
  assert.deepEqual(list, [note]);
});

test("list is ordered newest-updated first", async () => {
  const a = await repo.create("u-order", "A");
  await sleep(5);
  const b = await repo.create("u-order", "B");
  await sleep(5);
  await repo.update("u-order", a.id, "A2");
  const list = await repo.list("u-order");
  assert.deepEqual(list.map((n) => n.id), [a.id, b.id]);
});

test("update changes ciphertext and updatedAt, keeps createdAt", async () => {
  const note = await repo.create("u-update", "OLD");
  await sleep(5);
  const updated = await repo.update("u-update", note.id, "NEW");
  assert.equal(updated.ciphertext, "NEW");
  assert.equal(updated.createdAt, note.createdAt);
  assert.ok(updated.updatedAt > note.updatedAt);
});

test("update and delete of a missing note report not-found without creating anything", async () => {
  const missing = "00000000-0000-4000-8000-000000000000";
  assert.equal(await repo.update("u-missing", missing, "X"), null);
  assert.equal(await repo.remove("u-missing", missing), false);
  assert.deepEqual(await repo.list("u-missing"), []);
});

test("users are isolated: cannot update or delete each other's notes", async () => {
  const note = await repo.create("u-owner", "MINE");
  assert.equal(await repo.update("u-intruder", note.id, "HACK"), null);
  assert.equal(await repo.remove("u-intruder", note.id), false);
  assert.deepEqual(await repo.list("u-intruder"), []);
  const [still] = await repo.list("u-owner");
  assert.equal(still.ciphertext, "MINE");
});

test("delete removes the note", async () => {
  const note = await repo.create("u-delete", "BYE");
  assert.equal(await repo.remove("u-delete", note.id), true);
  assert.deepEqual(await repo.list("u-delete"), []);
  assert.equal(await repo.remove("u-delete", note.id), false);
});

test("list follows pagination (more than 1 MB of notes for one user)", async () => {
  const big = "z".repeat(250 * 1024);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await repo.create("u-page", big)).id); // ~1.25 MB > one 1 MB query page
  const list = await repo.list("u-page");
  assert.equal(list.length, 5);
  assert.deepEqual(new Set(list.map((n) => n.id)), new Set(ids));
});

test("a note at the size limit (300 KB) round-trips unchanged", async () => {
  const text = "ünïcode-" + "q".repeat(300 * 1024 - 20);
  const note = await repo.create("u-limit", text);
  const [read] = await repo.list("u-limit");
  assert.equal(read.id, note.id);
  assert.equal(read.ciphertext, text);
});
