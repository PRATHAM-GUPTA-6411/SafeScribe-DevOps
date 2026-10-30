"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTemplate } = require("./loadTemplate");

const REPO = path.resolve(__dirname, "..", "..");
const CFN = path.join(REPO, "infrastructure", "cloudformation");
const network = loadTemplate(path.join(CFN, "network.yaml"));
const storage = loadTemplate(path.join(CFN, "storage.yaml"));
const auth = loadTemplate(path.join(CFN, "auth.yaml"));
const ALL = { network, storage, auth };

const ofType = (tpl, type) => Object.entries(tpl.Resources).filter(([, r]) => r.Type === type);
const refName = (v) => (v && typeof v === "object" ? v.Ref : undefined);

/** Every ingress rule in the network template, inline or standalone, as {group, rule}. */
function ingressRules(tpl) {
  const rules = [];
  for (const [id, r] of ofType(tpl, "AWS::EC2::SecurityGroup")) {
    for (const rule of r.Properties.SecurityGroupIngress || []) rules.push({ group: id, rule, conditional: false });
  }
  for (const [, r] of ofType(tpl, "AWS::EC2::SecurityGroupIngress")) {
    rules.push({ group: refName(r.Properties.GroupId), rule: r.Properties, conditional: Boolean(r.Condition) });
  }
  return rules;
}

test("no template creates IAM resources (the Learner Lab forbids them; LabRole is used instead)", () => {
  for (const [name, tpl] of Object.entries(ALL)) {
    for (const [id, r] of Object.entries(tpl.Resources)) {
      assert.ok(!r.Type.startsWith("AWS::IAM::"), `${name}: ${id} is an IAM resource`);
    }
  }
});

test("every template has a description, and no secret-like parameter lacks NoEcho or has a default", () => {
  for (const [name, tpl] of Object.entries(ALL)) {
    assert.ok(tpl.Description && tpl.Description.length > 20, `${name}: missing Description`);
    for (const [pname, p] of Object.entries(tpl.Parameters || {})) {
      if (/secret|password|token|apikey/i.test(pname)) {
        assert.equal(p.NoEcho, true, `${name}.${pname} must be NoEcho`);
        assert.equal(p.Default, undefined, `${name}.${pname} must not have a default`);
      }
    }
  }
});

test("no template contains a hard-coded AWS account id, access key or private key", () => {
  for (const file of fs.readdirSync(CFN)) {
    const text = fs.readFileSync(path.join(CFN, file), "utf8");
    assert.ok(!/\b\d{12}\b/.test(text), `${file}: contains a 12-digit number (account id?)`);
    assert.ok(!/AKIA[0-9A-Z]{16}/.test(text), `${file}: contains an access key`);
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(text), `${file}: contains a private key`);
  }
});

// ---------------------------------------------------------------- network

test("network: nothing allows SSH (port 22), anywhere", () => {
  for (const { group, rule } of ingressRules(network)) {
    assert.ok(!(rule.FromPort <= 22 && rule.ToPort >= 22), `${group} allows port 22`);
  }
});

test("network: only the load balancer group is open to the internet, and only on 80 and 443", () => {
  for (const { group, rule } of ingressRules(network)) {
    if (rule.CidrIp === "0.0.0.0/0" || rule.CidrIpv6 === "::/0") {
      assert.equal(group, "AlbSecurityGroup", `${group} is open to the internet`);
      assert.ok([80, 443].includes(rule.FromPort) && rule.FromPort === rule.ToPort);
    }
  }
});

test("network: app instances accept traffic only from the load balancer (8080) and the monitoring group (9464, 9100)", () => {
  const appRules = ingressRules(network).filter((r) => r.group === "AppSecurityGroup");
  assert.equal(appRules.length, 3);
  for (const { rule } of appRules) {
    assert.equal(rule.CidrIp, undefined, "app rules must reference a security group, not an address");
    assert.equal(rule.FromPort, rule.ToPort);
  }
  const bySource = Object.fromEntries(appRules.map(({ rule }) => [rule.FromPort, refName(rule.SourceSecurityGroupId)]));
  assert.deepEqual(bySource, { 8080: "AlbSecurityGroup", 9464: "MonitoringSecurityGroup", 9100: "MonitoringSecurityGroup" });
});

test("network: monitoring access exists only when an admin address is given, and only for Grafana and Prometheus", () => {
  const rules = ingressRules(network).filter((r) => r.group === "MonitoringSecurityGroup");
  assert.equal(rules.length, 2);
  for (const { rule, conditional } of rules) {
    assert.ok(conditional, "monitoring rules must be conditional");
    assert.deepEqual(rule.CidrIp, { Ref: "AdminCidr" });
    assert.ok([3000, 9090].includes(rule.FromPort));
  }
  assert.match(network.Parameters.AdminCidr.AllowedPattern, /\/32/, "admin address must be a single /32");
  assert.equal(network.Parameters.AdminCidr.Default, "");
});

test("network: no NAT gateway or Elastic IP (both bill by the hour), two subnets in different zones", () => {
  assert.equal(ofType(network, "AWS::EC2::NatGateway").length, 0);
  assert.equal(ofType(network, "AWS::EC2::EIP").length, 0);
  const subnets = ofType(network, "AWS::EC2::Subnet");
  assert.equal(subnets.length, 2);
  const zones = subnets.map(([, s]) => JSON.stringify(s.Properties.AvailabilityZone));
  assert.equal(new Set(zones).size, 2);
});

// ---------------------------------------------------------------- storage

test("storage: the table matches what the application expects", () => {
  const [[, table]] = ofType(storage, "AWS::DynamoDB::Table");
  assert.equal(table.Properties.BillingMode, "PAY_PER_REQUEST");
  assert.deepEqual(
    table.Properties.KeySchema.map((k) => [k.AttributeName, k.KeyType]),
    [["userId", "HASH"], ["noteId", "RANGE"]]
  );
  const types = Object.fromEntries(table.Properties.AttributeDefinitions.map((a) => [a.AttributeName, a.AttributeType]));
  assert.deepEqual(types, { userId: "S", noteId: "S" });
  // Default table name must equal the API's default NOTES_TABLE.
  const config = fs.readFileSync(path.join(REPO, "backend", "src", "config.js"), "utf8");
  const appDefault = /NOTES_TABLE \|\| "([^"]+)"/.exec(config)[1];
  assert.equal(storage.Parameters.TableName.Default, appDefault);
});

test("storage: the ECR repository scans on push, uses immutable tags, expires old images and can be deleted", () => {
  const [[, repo]] = ofType(storage, "AWS::ECR::Repository");
  assert.equal(repo.Properties.ImageScanningConfiguration.ScanOnPush, true);
  assert.equal(repo.Properties.ImageTagMutability, "IMMUTABLE");
  assert.equal(repo.Properties.EmptyOnDelete, true);
  assert.ok(repo.Properties.LifecyclePolicy.LifecyclePolicyText);
});

// ---------------------------------------------------------------- auth

test("auth: Google is the only sign-in route, nobody can self-register", () => {
  const [[, pool]] = ofType(auth, "AWS::Cognito::UserPool");
  assert.equal(pool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
  const [[, client]] = ofType(auth, "AWS::Cognito::UserPoolClient");
  assert.deepEqual(client.Properties.SupportedIdentityProviders, ["Google"]);
});

test("auth: the app client is a public PKCE client with the authorization-code flow only", () => {
  const [[, client]] = ofType(auth, "AWS::Cognito::UserPoolClient");
  const p = client.Properties;
  assert.equal(p.GenerateSecret, false);
  assert.equal(p.AllowedOAuthFlowsUserPoolClient, true);
  assert.deepEqual(p.AllowedOAuthFlows, ["code"]);
  assert.deepEqual(p.ExplicitAuthFlows, ["ALLOW_REFRESH_TOKEN_AUTH"], "no password flows");
  assert.equal(p.PreventUserExistenceErrors, "ENABLED");
  assert.equal(p.EnableTokenRevocation, true);
});

test("auth: scopes, claims and attributes match what frontend/auth.js asks for and uses", () => {
  const [[, client]] = ofType(auth, "AWS::Cognito::UserPoolClient");
  const frontend = fs.readFileSync(path.join(REPO, "frontend", "auth.js"), "utf8");
  const requested = /scope: "([^"]+)"/.exec(frontend)[1].split(" ").sort();
  assert.deepEqual([...client.Properties.AllowedOAuthScopes].sort(), requested);
  const [[, idp]] = ofType(auth, "AWS::Cognito::UserPoolIdentityProvider");
  assert.equal(idp.Properties.ProviderType, "Google");
  assert.deepEqual(idp.Properties.ProviderDetails.authorize_scopes.split(" ").sort(), requested);
  for (const attr of ["email", "name", "picture"]) {
    assert.ok(attr in idp.Properties.AttributeMapping, `${attr} must be mapped from Google`);
    assert.ok(client.Properties.ReadAttributes.includes(attr), `${attr} must be readable (it ends up in the ID token)`);
    assert.ok(frontend.includes(`claims.${attr === "picture" ? "picture" : attr}`), `frontend/auth.js should use claims.${attr}`);
  }
});

test("auth: the Google client secret is a masked parameter that is passed only to the identity provider", () => {
  assert.equal(auth.Parameters.GoogleClientSecret.NoEcho, true);
  const text = JSON.stringify(auth.Resources);
  assert.equal(text.split("GoogleClientSecret").length - 1, 1, "the secret may be referenced exactly once");
  assert.ok(!JSON.stringify(auth.Outputs).includes("GoogleClientSecret"), "the secret must never be an output");
});

test("auth: local callback is plain http only for localhost; the redirect URI output points at Cognito", () => {
  assert.match(auth.Parameters.LocalCallbackUrl.Default, /^http:\/\/localhost(:\d+)?\//);
  assert.match(JSON.stringify(auth.Outputs.GoogleRedirectUri.Value), /\/oauth2\/idpresponse/);
});
