"use strict";
/**
 * DEVELOPMENT ONLY. In-memory DynamoDB emulator (dynalite) that creates the SafeScribe
 * notes table on start-up, so `docker compose up` works without an AWS account.
 * Data is lost when the container stops. Never used on AWS.
 */
const fs = require("node:fs");
const dynalite = require("dynalite");
const { DynamoDBClient, CreateTableCommand } = require("@aws-sdk/client-dynamodb");

process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "local";
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "local";

const TABLE = process.env.NOTES_TABLE || "SafeScribeNotes";
const PORT = Number(process.env.PORT || 8000);
const READY_FILE = process.env.READY_FILE || "/tmp/ready";

const server = dynalite({ createTableMs: 0 });
server.listen(PORT, "0.0.0.0", async () => {
  try {
    const client = new DynamoDBClient({ region: "us-east-1", endpoint: `http://127.0.0.1:${PORT}` });
    await client.send(
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
    fs.writeFileSync(READY_FILE, "ok");
    console.log(JSON.stringify({ msg: "local dynamodb ready", port: PORT, table: TABLE }));
  } catch (err) {
    console.error(JSON.stringify({ msg: "table creation failed", error: err.message }));
    process.exit(1);
  }
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
