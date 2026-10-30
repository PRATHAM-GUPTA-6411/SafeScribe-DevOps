# AWS foundation (Phase 5)

Three CloudFormation stacks, deployed from **AWS CloudShell** inside the Learner Lab (credentials are already there, nothing to paste into GitHub).

| Stack | Template | Contents | Idle cost |
|---|---|---|---|
| `safescribe-network` | `infrastructure/cloudformation/network.yaml` | VPC, 2 public subnets in 2 zones, internet gateway, route table, 3 security groups. No NAT gateway, no SSH | none |
| `safescribe-storage` | `storage.yaml` | DynamoDB table `SafeScribeNotes` (on-demand), ECR repository `safescribe-api` (immutable tags, scan on push, keeps 10 images) | cents |
| `safescribe-auth` | `auth.yaml` | Cognito user pool (Google only, no self-registration), hosted login domain, Google identity provider, one app client for local development | none (first 10,000 users free) |

The load balancer, Auto Scaling group and monitoring instance come in a later phase. **They are the part that costs real money**, so they live in separate stacks that can be deleted after every session.

## Security choices

- Security groups: only the load balancer is open to the internet (80 and 443). App instances accept 8080 from the load balancer only, and metrics ports from the monitoring group only. **No port 22 anywhere** (use Session Manager).
- Monitoring (Grafana 3000, Prometheus 9090) is closed unless you pass your own address as `ADMIN_CIDR` (one `/32`).
- No IAM resources are created (the lab forbids it); instances will use the lab's `LabInstanceProfile`.
- The Google client secret is a masked (`NoEcho`) parameter, typed with hidden input, never printed, never stored in Git.
- `frontend/auth.js`, the Cognito client and the template tests agree on scopes and claims; a test fails if they drift apart.

## Before you deploy: Google OAuth client (about 10 minutes, once)

1. Choose your **hosted-login prefix**, for example `safescribe-pratham-6411`. Lower-case letters, digits and hyphens; unique in the region; it must not contain `aws`, `amazon` or `cognito`.
2. In the [Google Cloud console](https://console.cloud.google.com/) create or pick a project.
3. Configure the OAuth consent screen (menu names change; look for **Google Auth Platform** or **APIs & Services, OAuth consent screen**): app name `SafeScribe`, your email as support email, audience **External**. While the app is in *Testing*, add your own Google account(s) (and your teammates') as **test users**; only they can sign in.
4. Create credentials: **OAuth client ID, Web application**. Under **Authorized redirect URIs** add exactly:
   `https://<your-prefix>.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
5. Copy the **Client ID** and **Client secret**. Keep them out of chat and out of Git.

## Deploy

1. Start the Learner Lab and open CloudShell (the `>_` icon in the console). Check the region says **N. Virginia (us-east-1)**.
2. Get the latest code. If you cloned the repository in CloudShell before:
   ```bash
   cd ~/SafeScribe-DevOps && git pull
   ```
   First time (or if that folder is missing):
   ```bash
   git clone https://github.com/PRATHAM-GUPTA-6411/SafeScribe-DevOps.git && cd SafeScribe-DevOps
   ```
3. Run:
   ```bash
   bash scripts/aws/foundation.sh deploy
   ```
   It validates the templates, deploys the three stacks in order, asks for the prefix, Client ID and Client secret (typing the secret is hidden), and prints a summary. Optional: `ADMIN_CIDR=<your-ip>/32 bash scripts/aws/foundation.sh deploy`.
4. **Real sign-in test.** The summary ends with a long address. Open it in your browser and sign in with an allowed Google account. Success means the browser lands on `http://localhost:8080/?code=...&state=manualtest`. The page itself will not load, that is expected: it proves Google, Cognito and the app client work together.

## Check what was created

```bash
aws dynamodb describe-table --table-name SafeScribeNotes --query "Table.[TableStatus,BillingModeSummary.BillingMode]" --output text
aws ecr describe-repositories --repository-names safescribe-api --query "repositories[0].[repositoryUri,imageTagMutability]" --output text
aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName,'safescribe-')].[StackName,StackStatus]" --output text
```

## End of every session

```bash
bash scripts/aws/foundation.sh status
```

It lists your stacks and warns about anything that bills while it exists (running instances, load balancers, NAT gateways, Elastic IPs). Also look at the budget on the Learner Lab page. These three stacks are fine to leave in place.

## Remove everything (end of project)

```bash
bash scripts/aws/foundation.sh destroy     # type DELETE to confirm; deletes ALL notes and images
```

## If something fails

| Message | Meaning | What to do |
|---|---|---|
| `Region is ... expected us-east-1` | Wrong region | Switch region in the console, reopen CloudShell |
| `Invalid prefix` or "domain already exists" | Prefix rules or name taken | Choose another prefix and run again |
| `AccessDenied` / `not authorized to perform` | The lab does not allow that service or action | Copy the full message to me; that service may need an alternative |
| Stack ends in `ROLLBACK_COMPLETE` | First attempt failed | Re-run `deploy`; the script deletes the failed stack first. Read the failure reason in the CloudFormation console, Events tab |

## What is verified

See `docs/TEST_RESULTS.md`, Phase 5. In short: the templates pass `cfn-lint` and security tests, and the script's logic is tested against a fake AWS CLI. **None of it has run against real AWS yet**; your first deploy is the first real test.
