#!/usr/bin/env bash
# SafeScribe-DevOps AWS foundation: network, storage and sign-in stacks.
# Run in AWS CloudShell inside the Learner Lab (credentials are already set there).
#
#   bash scripts/aws/foundation.sh deploy    create or update the three stacks
#   bash scripts/aws/foundation.sh status    show the stacks and warn about anything that costs money while idle
#   bash scripts/aws/foundation.sh destroy   delete the three stacks (asks for confirmation)
#
# Optional environment variables (otherwise you are asked):
#   DOMAIN_PREFIX, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_CIDR (your public IP as x.x.x.x/32)
set -euo pipefail

REGION_REQUIRED="us-east-1"
NETWORK_STACK="safescribe-network"
STORAGE_STACK="safescribe-storage"
AUTH_STACK="safescribe-auth"
TAGS=("Project=SafeScribe-DevOps" "ManagedBy=CloudFormation")
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES="$HERE/../../infrastructure/cloudformation"

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo "==> $*"; }

require_region() {
  local region="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
  [ "$region" = "$REGION_REQUIRED" ] || die "Region is '${region:-unset}', expected $REGION_REQUIRED. Switch region in the console (top right) and reopen CloudShell."
  export AWS_DEFAULT_REGION="$region"
}

show_identity() {
  say "Signed in as: $(aws sts get-caller-identity --query Arn --output text)"
}

stack_status() {
  aws cloudformation describe-stacks --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NONE"
}

stack_output() { # stack key
  aws cloudformation describe-stacks --stack-name "$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text
}

# A stack whose first creation failed sits in ROLLBACK_COMPLETE and cannot be updated: remove it first.
clear_failed_stack() {
  local status
  status="$(stack_status "$1")"
  case "$status" in
    ROLLBACK_COMPLETE | CREATE_FAILED)
      say "Stack $1 is in $status (a failed first attempt). Deleting it so it can be created again."
      aws cloudformation delete-stack --stack-name "$1"
      aws cloudformation wait stack-delete-complete --stack-name "$1"
      ;;
  esac
}

validate() {
  local file
  for file in network storage auth; do
    say "Validating $file.yaml"
    aws cloudformation validate-template --template-body "file://$TEMPLATES/$file.yaml" >/dev/null
  done
}

deploy_stack() { # stack template [Key=Value ...]
  local stack="$1" template="$2"
  shift 2
  clear_failed_stack "$stack"
  say "Deploying $stack (this can take a few minutes)"
  if [ "$#" -gt 0 ]; then
    aws cloudformation deploy --stack-name "$stack" --template-file "$TEMPLATES/$template" \
      --parameter-overrides "$@" --tags "${TAGS[@]}" --no-fail-on-empty-changeset
  else
    aws cloudformation deploy --stack-name "$stack" --template-file "$TEMPLATES/$template" \
      --tags "${TAGS[@]}" --no-fail-on-empty-changeset
  fi
}

ask() { # variable prompt [silent]
  local var="$1" prompt="$2" silent="${3:-}" value="${!1:-}"
  if [ -z "$value" ]; then
    if [ "$silent" = "silent" ]; then
      read -rsp "$prompt: " value
      echo
    else
      read -rp "$prompt: " value
    fi
  fi
  [ -n "$value" ] || die "$var is required."
  printf -v "$var" '%s' "$value"
}

cmd_deploy() {
  require_region
  show_identity
  validate

  local admin_args=()
  [ -n "${ADMIN_CIDR:-}" ] && admin_args=("AdminCidr=$ADMIN_CIDR")
  deploy_stack "$NETWORK_STACK" network.yaml "${admin_args[@]}"
  deploy_stack "$STORAGE_STACK" storage.yaml

  DOMAIN_PREFIX="${DOMAIN_PREFIX:-}"
  GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
  GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"
  ask DOMAIN_PREFIX "Hosted-login prefix (lower-case letters, digits, hyphens; unique; no 'aws', 'amazon' or 'cognito')"
  [[ "$DOMAIN_PREFIX" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die "Invalid prefix '$DOMAIN_PREFIX'."
  case "$DOMAIN_PREFIX" in *aws* | *amazon* | *cognito*) die "The prefix must not contain aws, amazon or cognito." ;; esac
  ask GOOGLE_CLIENT_ID "Google OAuth client ID"
  ask GOOGLE_CLIENT_SECRET "Google OAuth client secret (typing is hidden)" silent
  deploy_stack "$AUTH_STACK" auth.yaml \
    "DomainPrefix=$DOMAIN_PREFIX" "GoogleClientId=$GOOGLE_CLIENT_ID" "GoogleClientSecret=$GOOGLE_CLIENT_SECRET"

  print_summary
}

print_summary() {
  local domain client pool repo table
  domain="$(stack_output "$AUTH_STACK" HostedLoginDomain)"
  client="$(stack_output "$AUTH_STACK" LocalAppClientId)"
  pool="$(stack_output "$AUTH_STACK" UserPoolId)"
  repo="$(stack_output "$STORAGE_STACK" RepositoryUri)"
  table="$(stack_output "$STORAGE_STACK" TableName)"
  echo
  say "Foundation is ready"
  echo "  User pool:      $pool"
  echo "  Local client:   $client"
  echo "  Login domain:   $domain"
  echo "  ECR repository: $repo"
  echo "  DynamoDB table: $table"
  echo
  echo "Real Google sign-in test (open this address in your browser, sign in with a Google account"
  echo "that is allowed on your OAuth consent screen). Success = the browser lands on"
  echo "http://localhost:8080/?code=...&state=manualtest (the page itself will not load, that is expected):"
  echo
  echo "  ${domain}/oauth2/authorize?response_type=code&client_id=${client}&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2F&scope=openid+email+profile&identity_provider=Google&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=manualtest"
  echo
  echo "These three stacks cost (almost) nothing while idle. Run '$0 status' at the end of every session."
}

count_or_unknown() { # description, command...
  local description="$1" result
  shift
  if result="$("$@" 2>/dev/null)"; then
    if [ "$result" = "0" ] || [ "$result" = "None" ] || [ -z "$result" ]; then
      echo "  ok       0 $description"
    else
      echo "  WARNING  $result $description (these bill while they exist or run)"
    fi
  else
    echo "  ?        could not check $description"
  fi
}

cmd_status() {
  require_region
  show_identity
  say "Stacks"
  aws cloudformation describe-stacks \
    --query "Stacks[?starts_with(StackName,'safescribe-')].[StackName,StackStatus]" --output text | sed 's/^/  /' || true
  echo
  say "Things that cost money while they exist or run"
  count_or_unknown "running EC2 instances" aws ec2 describe-instances \
    --filters Name=instance-state-name,Values=pending,running --query 'length(Reservations[].Instances[])' --output text
  count_or_unknown "load balancers" aws elbv2 describe-load-balancers --query 'length(LoadBalancers)' --output text
  count_or_unknown "NAT gateways" aws ec2 describe-nat-gateways \
    --filter Name=state,Values=pending,available --query 'length(NatGateways)' --output text
  count_or_unknown "Elastic IP addresses" aws ec2 describe-addresses --query 'length(Addresses)' --output text
  echo
  echo "Also check the budget on the Learner Lab page (top of the lab screen)."
}

cmd_destroy() {
  require_region
  show_identity
  echo "This deletes: $AUTH_STACK, $STORAGE_STACK (including ALL notes in DynamoDB and ALL images in ECR) and $NETWORK_STACK."
  local answer
  read -rp "Type DELETE to continue: " answer
  [ "$answer" = "DELETE" ] || die "Cancelled. Nothing was deleted."
  local stack
  for stack in "$AUTH_STACK" "$STORAGE_STACK" "$NETWORK_STACK"; do
    if [ "$(stack_status "$stack")" = "NONE" ]; then
      say "$stack does not exist, skipping"
      continue
    fi
    say "Deleting $stack"
    aws cloudformation delete-stack --stack-name "$stack"
    aws cloudformation wait stack-delete-complete --stack-name "$stack"
  done
  say "Done. Run '$0 status' to confirm nothing is left."
}

case "${1:-help}" in
  deploy) cmd_deploy ;;
  status) cmd_status ;;
  destroy) cmd_destroy ;;
  *) sed -n '2,10p' "${BASH_SOURCE[0]}" ;;
esac
