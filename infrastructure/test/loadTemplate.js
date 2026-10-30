"use strict";
/** Loads a CloudFormation YAML template into plain JS, turning short-form tags (!Ref, !Sub, ...) into their long form. */
const fs = require("node:fs");
const YAML = require("yaml");

const SHORT_FORMS = [
  "Ref", "Condition", "Sub", "GetAtt", "Join", "Select", "GetAZs", "If", "Equals", "Not", "And", "Or",
  "ImportValue", "FindInMap", "Split", "Base64", "Cidr",
];
const longName = (name) => (name === "Ref" || name === "Condition" ? name : `Fn::${name}`);

function customTags() {
  const tags = [];
  for (const name of SHORT_FORMS) {
    const key = longName(name);
    const wrap = (value) => ({ [key]: name === "GetAtt" && typeof value === "string" ? value.split(".") : value });
    tags.push({ tag: `!${name}`, resolve: (str) => wrap(str) });
    tags.push({ tag: `!${name}`, collection: "seq", resolve: (seq) => wrap(seq.toJSON()) });
    tags.push({ tag: `!${name}`, collection: "map", resolve: (map) => wrap(map.toJSON()) });
  }
  return tags;
}

function loadTemplate(file) {
  return YAML.parse(fs.readFileSync(file, "utf8"), { customTags: customTags() });
}

module.exports = { loadTemplate };
