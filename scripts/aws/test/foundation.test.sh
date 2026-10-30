#!/usr/bin/env bash
# Tests scripts/aws/foundation.sh against a fake AWS CLI. No AWS account or network needed.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../foundation.sh"
PASS=0
FAIL=0
SECRET="s3cr3t-VALUE-do-not-print"
STATE=""
OUT=""
CODE=0

setup() { # fresh fake state, fake aws first on PATH, clean environment
  STATE="$(mktemp -d)"
  export FAKE_STATE="$STATE"
  mkdir -p "$STATE/bin" && cp "$HERE/fake-aws" "$STATE/bin/aws"
  chmod +x "$STATE/bin/aws" # executable bits do not survive zip files or Windows Git, so never rely on them
  export PATH="$STATE/bin:$PATH"
  unset FAKE_REGION FAKE_VALIDATE_FAIL FAKE_DEPLOY_FAIL FAKE_INSTANCES FAKE_NATS FAKE_EIPS FAKE_ALBS FAKE_ELB_DENIED
  unset DOMAIN_PREFIX GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET ADMIN_CIDR AWS_REGION AWS_DEFAULT_REGION
}
check() { # description, then a command that must succeed
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
    echo "  PASS  $description"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $description"
  fi
}
run() { # stdin is closed and a time limit applies, so a script that unexpectedly waits for input fails instead of hanging
  OUT="$(timeout 30 "$@" 2>&1 </dev/null)"
  CODE=$?
}

# ---- assertions (each returns 0 when true)
calls() { cat "$STATE/calls.log" 2>/dev/null || true; }
contains() { grep -qF -- "$1" <<<"$2"; }
lacks() { ! contains "$1" "$2"; }
call_count() { calls | grep -cF -- "$1" || true; }
exit_ok() { [ "$CODE" -eq 0 ]; }
exit_failed() { [ "$CODE" -ne 0 ]; }
no_calls_matching() { [ "$(call_count "$1")" -eq 0 ]; }
sequence_is() { # expected, grep pattern, sed expression applied to each matching call
  [ "$(calls | grep -E "$2" | sed -E "$3" | tr '\n' ' ')" = "$1 " ]
}

echo "1. deploy with environment variables"
setup
export DOMAIN_PREFIX=safescribe-test-1 GOOGLE_CLIENT_ID=gid.apps.googleusercontent.com GOOGLE_CLIENT_SECRET="$SECRET"
run bash "$SCRIPT" deploy
check "exits 0" exit_ok
check "validates 3 templates, then deploys network, storage, auth in that order" \
  sequence_is "validate-template validate-template validate-template --stack-name safescribe-network --stack-name safescribe-storage --stack-name safescribe-auth" \
  'validate-template|cloudformation deploy' 's/.*(validate-template|--stack-name [a-z-]+).*/\1/'
check "auth stack gets the prefix and client id" contains "DomainPrefix=safescribe-test-1 GoogleClientId=gid.apps.googleusercontent.com" "$(calls)"
check "the client secret is NEVER printed" lacks "$SECRET" "$OUT"
check "prints the Google test URL with the client id" contains "client_id=fakeclientid123" "$OUT"
check "all three stacks carry the Project tag" test "$(call_count 'Project=SafeScribe-DevOps')" -eq 3
check "no admin CIDR parameter when ADMIN_CIDR is unset" lacks "AdminCidr=" "$(calls)"

echo "2. ADMIN_CIDR goes to the network stack only"
setup
export DOMAIN_PREFIX=pfx1 GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET="$SECRET" ADMIN_CIDR=203.0.113.7/32
run bash "$SCRIPT" deploy
check "network gets AdminCidr=203.0.113.7/32" contains "network.yaml --parameter-overrides AdminCidr=203.0.113.7/32" "$(calls)"
check "storage and auth do not" test "$(calls | grep -E 'storage.yaml|auth.yaml' | grep -cF AdminCidr || true)" -eq 0

echo "3. interactive prompts (nothing in the environment)"
setup
run bash -c "printf 'prompted-prefix\nprompted-id\n%s\n' '$SECRET' | bash '$SCRIPT' deploy"
check "exits 0" exit_ok
check "uses the typed prefix" contains "DomainPrefix=prompted-prefix" "$(calls)"
check "the typed secret is not echoed" lacks "$SECRET" "$OUT"

echo "4. wrong region stops before touching anything"
setup
export FAKE_REGION=us-west-2
run bash "$SCRIPT" deploy
check "exits non-zero" exit_failed
check "tells you the required region" contains "us-east-1" "$OUT"
check "no CloudFormation call was made" no_calls_matching "cloudformation"

echo "5. bad hosted-login prefixes are refused before the auth stack is touched"
for bad in "Bad_Prefix" "my-cognito-app" "UPPER" "-leading"; do
  setup
  export DOMAIN_PREFIX="$bad" GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET="$SECRET"
  run bash "$SCRIPT" deploy
  check "refuses '$bad' (exit non-zero)" exit_failed
  check "...and never deploys the auth stack for '$bad'" no_calls_matching "stack-name safescribe-auth"
done

echo "6. a template that fails validation stops the run"
setup
export FAKE_VALIDATE_FAIL=1 DOMAIN_PREFIX=pfx1 GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET="$SECRET"
run bash "$SCRIPT" deploy
check "exits non-zero" exit_failed
check "deploys nothing" no_calls_matching "cloudformation deploy"

echo "7. a stack stuck in ROLLBACK_COMPLETE is deleted before redeploying"
setup
echo ROLLBACK_COMPLETE > "$STATE/status_safescribe-network"
export DOMAIN_PREFIX=pfx1 GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET="$SECRET"
run bash "$SCRIPT" deploy
check "deletes the failed stack, then deploys it" \
  sequence_is "delete-stack deploy" 'delete-stack --stack-name safescribe-network|deploy --stack-name safescribe-network' 's/.*(delete-stack|deploy).*/\1/'

echo "8. a failing deployment stops the run"
setup
export FAKE_DEPLOY_FAIL=safescribe-storage DOMAIN_PREFIX=pfx1 GOOGLE_CLIENT_ID=gid GOOGLE_CLIENT_SECRET="$SECRET"
run bash "$SCRIPT" deploy
check "exits non-zero" exit_failed
check "the auth stack was not attempted" no_calls_matching "stack-name safescribe-auth"

echo "9. status"
setup
echo CREATE_COMPLETE > "$STATE/status_safescribe-network"
run bash "$SCRIPT" status
check "all clear: no warnings" lacks "WARNING" "$OUT"
export FAKE_INSTANCES=3 FAKE_ALBS=1 FAKE_NATS=1 FAKE_EIPS=2
run bash "$SCRIPT" status
check "warns about running instances" contains "WARNING  3 running EC2 instances" "$OUT"
check "warns about the load balancer" contains "WARNING  1 load balancers" "$OUT"
check "warns about NAT gateways" contains "WARNING  1 NAT gateways" "$OUT"
check "warns about Elastic IPs" contains "WARNING  2 Elastic IP addresses" "$OUT"
export FAKE_ELB_DENIED=1
run bash "$SCRIPT" status
check "says so when a check cannot be made, instead of claiming all clear" contains "could not check load balancers" "$OUT"

echo "10. destroy"
setup
for s in network storage auth; do echo CREATE_COMPLETE > "$STATE/status_safescribe-$s"; done
run bash -c "echo no | bash '$SCRIPT' destroy"
check "anything but DELETE cancels (exit non-zero)" exit_failed
check "...and deletes nothing" no_calls_matching "delete-stack"
run bash -c "echo DELETE | bash '$SCRIPT' destroy"
check "deletes auth, then storage, then network" \
  sequence_is "safescribe-auth safescribe-storage safescribe-network" 'delete-stack' 's/.*--stack-name //'

echo
echo "foundation.sh tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
