"use strict";
const crypto = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

/**
 * DynamoDB access for notes. Table design:
 *   partition key  userId (S)  = Cognito `sub`
 *   sort key       noteId (S)  = random UUID
 *   attributes     ciphertext, createdAt, updatedAt (ISO-8601)
 * The server only ever sees ciphertext produced in the browser.
 */
function createNotesRepo({ tableName, region, endpoint, client }) {
  const doc =
    client ||
    DynamoDBDocumentClient.from(new DynamoDBClient({ region, ...(endpoint ? { endpoint } : {}) }), {
      marshallOptions: { removeUndefinedValues: true },
    });

  const toNote = (item) => ({
    id: item.noteId,
    ciphertext: item.ciphertext,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  });
  const isConditionFailure = (err) => err && err.name === "ConditionalCheckFailedException";

  return {
    /** All notes of one user, newest-updated first (same order the original Firestore query used). */
    async list(userId) {
      const items = [];
      let startKey;
      do {
        const out = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "userId = :u",
            ExpressionAttributeValues: { ":u": userId },
            ExclusiveStartKey: startKey,
          })
        );
        items.push(...(out.Items || []));
        startKey = out.LastEvaluatedKey;
      } while (startKey);
      return items.map(toNote).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    },

    async create(userId, ciphertext) {
      const now = new Date().toISOString();
      const item = { userId, noteId: crypto.randomUUID(), ciphertext, createdAt: now, updatedAt: now };
      await doc.send(
        new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(noteId)" })
      );
      return toNote(item);
    },

    /** Returns the updated note, or null if this user has no such note. */
    async update(userId, noteId, ciphertext) {
      try {
        const out = await doc.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { userId, noteId },
            UpdateExpression: "SET #c = :c, #u = :u",
            ConditionExpression: "attribute_exists(noteId)",
            ExpressionAttributeNames: { "#c": "ciphertext", "#u": "updatedAt" },
            ExpressionAttributeValues: { ":c": ciphertext, ":u": new Date().toISOString() },
            ReturnValues: "ALL_NEW",
          })
        );
        return toNote(out.Attributes);
      } catch (err) {
        if (isConditionFailure(err)) return null;
        throw err;
      }
    },

    /** Returns true if deleted, false if this user has no such note. */
    async remove(userId, noteId) {
      try {
        await doc.send(
          new DeleteCommand({
            TableName: tableName,
            Key: { userId, noteId },
            ConditionExpression: "attribute_exists(noteId)",
          })
        );
        return true;
      } catch (err) {
        if (isConditionFailure(err)) return false;
        throw err;
      }
    },
  };
}

module.exports = { createNotesRepo };
