# Security Policy

## Reporting a vulnerability

Do not open a public issue containing student information, credentials, tokens, unpublished drafts, or exploit details. Contact the repository maintainers privately through the contact channel listed on the public website.

## Data policy

This GitHub Pages repository is public and contains only public website content and explicitly fictional development fixtures. Real student identities, drafts, editor notes, photographs, Google account data, OAuth tokens, API credentials, and backend secrets must never be committed.

Phase 1 authentication and authorization are development mocks and must not be treated as security. Before handling real editorial material, deploy a private backend that validates Google tokens and current Classroom membership server-side for each operation, issues secure sessions, and persists private data outside GitHub.
