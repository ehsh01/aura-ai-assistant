# Recall AI App — Security & Privacy

## 1. Purpose

Recall will handle sensitive personal, work, financial, family, and project information.

Security must be built into the foundation.

## 2. Security Principles

- least privilege
- protect secrets
- preserve user control
- audit important access
- avoid unnecessary data duplication
- encrypt sensitive data
- design for local/private deployment if needed
- do not expose institutional data to unapproved services without explicit decision

## 3. Authentication

The app should require authentication before accessing personal data.

Possible approaches:

- local account
- OAuth provider
- single-user secure login
- session-based authentication

For early development, do not overbuild, but do not leave endpoints open accidentally.

## 4. Authorization

Even if Recall starts as a single-user app, design with future permission boundaries in mind.

Potential future roles:

- owner
- family member
- read-only viewer
- admin
- connector service account

## 5. Secrets Management

Secrets include:

- API keys
- finance API tokens
- database credentials
- AI provider keys
- extension tokens
- OAuth refresh tokens

Rules:

- never commit secrets
- use environment variables
- encrypt stored tokens
- avoid logging secrets
- rotate credentials when needed

## 6. Browser Extension Security

The extension should:

- request minimal permissions
- only capture when user clicks
- show preview where appropriate
- send data only to configured Recall endpoint
- avoid broad background scraping
- avoid storing sensitive data longer than necessary

## 7. Data Classification

Recall data may include:

- public
- personal
- work-related
- financial
- family
- confidential
- sensitive institutional information

The app should eventually support tagging or classification.

## 8. AI Privacy

Before sending data to an AI provider, consider:

- what data is included
- whether sensitive information is needed
- whether redaction is possible
- whether local AI is preferred
- whether logs store prompts/responses

## 9. Logging

Logs should include:

- system events
- errors
- sync results
- job status

Logs should not include:

- full financial account numbers
- passwords
- tokens
- unnecessary message bodies
- sensitive raw captures unless explicitly needed for debugging

## 10. Backups

Recall should support backup and restore.

Backup strategy should include:

- database backups
- document storage backups
- configuration backups
- encryption
- restore testing

## 11. Audit Trail

Important changes should be auditable:

- task creation
- task completion
- connector sync
- user corrections
- AI extraction
- data deletion
- credential changes

## 12. Deletion and Privacy

The user should be able to delete sensitive data.

Deletion must consider:

- raw capture
- derived tasks
- evidence
- AI extraction records
- source records
- search indexes
- embeddings

## 13. Institutional Restrictions

University systems may restrict external integrations.

Recall should avoid depending on blocked APIs.

Browser capture and manual capture may be more practical than direct Outlook/Teams API integration.

## 14. Security Anti-Patterns

Avoid:

- storing tokens in frontend code
- granting extension permissions to all sites unnecessarily
- silent background capture
- sending entire inboxes to AI without user intent
- no backup strategy
- no data deletion path
- logging raw sensitive data carelessly
