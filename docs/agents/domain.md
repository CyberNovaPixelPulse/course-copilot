# Domain docs

This repo uses a single-context layout:
GLOSSARY.md at the repo root and architecture decisions in docs/adr/.

## Before exploring the codebase

Read the root GLOSSARY.md and ADRs in docs/adr/ relevant to the work.

If these files do not exist, proceed silently. Domain-modeling creates
them lazily when terminology or decisions are resolved.

## Use the glossary's vocabulary

Use the glossary's terms when naming domain concepts in issues,
proposals, hypotheses, tests, and code.

If a needed concept is missing, reconsider whether it belongs to the
project's vocabulary; record a real terminology gap for domain-modeling.

## Surface ADR conflicts

If a proposal contradicts an existing ADR, identify the ADR and explain
why the decision should be reconsidered.
