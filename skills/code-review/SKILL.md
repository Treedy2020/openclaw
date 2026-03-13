---
name: code-review
description: "Two-round MR code review pipeline. Fetches Codeup MR diff, runs initial review with GPT, then final review with Gemini. Use when asked to review a MR or code changes. Accepts Codeup MR URL or project+MR ID."
metadata: { "openclaw": { "emoji": "🔍", "requires": { "bins": ["pi", "curl"] } } }
---

# Code Review Skill (Two-Round Pipeline)

Review Codeup MRs with a two-round model pipeline:

- **Round 1 (Initial Review)**: GPT — focus on code quality, bugs, security
- **Round 2 (Final Review)**: Gemini — focus on architecture, maintainability, final decision

## Input Formats

User may provide:

- Codeup MR URL: `https://codeup.aliyun.com/<org>/<repo>/merge_request/<id>`
- Project ID + MR ID: `project=<id> mr=<id>`
- Or just describe which MR to review

## Execution Steps

### Step 1: Fetch MR Diff

Use the Codeup API to get MR details and diff. The access token is available via:

```bash
CODEUP_TOKEN="$CODEUP_TOKEN_90_DAYS_EXPIRE"
```

Get MR info:

```bash
curl -s -H "x-codehub-token: $CODEUP_TOKEN" \
  "https://codeup.aliyun.com/api/v4/projects/<PROJECT_ID>/merge_requests/<MR_ID>"
```

Get MR diff (changes):

```bash
curl -s -H "x-codehub-token: $CODEUP_TOKEN" \
  "https://codeup.aliyun.com/api/v4/projects/<PROJECT_ID>/merge_requests/<MR_ID>/changes"
```

Save the diff content to a temp file for the reviewers.

### Step 2: Initial Review (GPT)

Run the first review round using GPT. Pass the diff via stdin or file:

```bash
pi --provider azure-openai-responses --model gpt-4o --print "$(cat <<'PROMPT'
You are a senior code reviewer performing the INITIAL review of a Merge Request.

## Review Focus
1. **Correctness**: Logic errors, edge cases, potential bugs
2. **Security**: Injection risks, credential leaks, unsafe operations
3. **Code Quality**: Naming, duplication, complexity
4. **Testing**: Missing test coverage for changed code paths

## MR Information
Title: <MR_TITLE>
Description: <MR_DESCRIPTION>
Source Branch: <SOURCE_BRANCH> → Target Branch: <TARGET_BRANCH>

## Code Changes
<DIFF_CONTENT>

## Output Format
Respond in this exact format:

### Initial Review Decision
**VERDICT**: APPROVE | REQUEST_CHANGES | COMMENT

### Issues Found
- [severity: critical|major|minor] file:line — description

### Summary
One paragraph summary of the review findings.
PROMPT
)"
```

### Step 3: Final Review (Gemini)

Run the second review round using Gemini, including the initial review results:

```bash
pi --provider google-vertex --model gemini-2.5-pro --print "$(cat <<'PROMPT'
You are a principal engineer performing the FINAL review of a Merge Request.
You have the initial review results from another reviewer below.

## Review Focus
1. **Architecture**: Does this change fit the codebase design?
2. **Maintainability**: Will this be easy to maintain and extend?
3. **Initial Review Assessment**: Do you agree with the initial reviewer's findings?
4. **Missing Concerns**: Anything the initial reviewer missed?

## MR Information
Title: <MR_TITLE>
Description: <MR_DESCRIPTION>

## Code Changes
<DIFF_CONTENT>

## Initial Review Results
<INITIAL_REVIEW_OUTPUT>

## Output Format
Respond in this exact format:

### Final Review Decision
**VERDICT**: APPROVE | REQUEST_CHANGES | COMMENT

### Assessment of Initial Review
Agree/disagree with initial findings and why.

### Additional Findings
- [severity: critical|major|minor] file:line — description

### Final Summary
One paragraph final assessment with merge recommendation.
PROMPT
)"
```

### Step 4: Aggregate and Report

Combine both reviews into a final report:

```
## MR Review Report: <MR_TITLE>

### Round 1 — Initial Review (GPT)
<initial_review_output>

### Round 2 — Final Review (Gemini)
<final_review_output>

### Final Decision
- Initial Review: APPROVE/REQUEST_CHANGES
- Final Review: APPROVE/REQUEST_CHANGES
- **Recommendation**: MERGE / DO NOT MERGE
```

Send this report back as the response.

## Important Notes

- Always fetch the actual diff, never guess code changes
- If the diff is too large (>100KB), summarize key files and review the most critical changes
- The `pi` CLI must be available in PATH on the server
- Model names may need adjustment based on available deployments; check with `pi --help` if a model is unavailable
- For Codeup API authentication, use the token from `CODEUP_TOKEN_90_DAYS_EXPIRE` env var
