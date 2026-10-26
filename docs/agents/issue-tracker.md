# Issue tracker: GitHub

Issues and specs live in GitHub Issues for
CyberNovaPixelPulse/course-copilot. Use the gh CLI from this repo.

## Conventions

- Create: gh issue create --title "..." --body-file <file>
- Read: gh issue view <number> --json number,title,body,labels,comments
- List: gh issue list --state open --json number,title,body,labels,assignees
  Add label and state filters as needed; paginate when a complete list is required.
- Comment: gh issue comment <number> --body-file <file>
- Apply labels: gh issue edit <number> --add-label "<label>"
- Remove labels: gh issue edit <number> --remove-label "<label>"
- Close: gh issue close <number> --comment "..."

For multiline issue bodies and comments, write the exact text to a file
and pass --body-file.

## Parent and child issues

Link child tickets using GitHub sub-issues when supported by the
installed CLI/API. Otherwise, put "Part of #<parent>" at the top
of the child body and add the child to a task list in the parent.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill operations

When a skill says "publish to the issue tracker", create a GitHub issue.
When a skill says "fetch the relevant ticket", read the GitHub issue.

## Wayfinding operations

- Map: one issue labelled wayfinder:map containing Notes,
  Decisions-so-far, and Fog.
- Child ticket: link it to the map and apply wayfinder:<type>,
  where type is research, prototype, grilling, or task.
- Blocking: use native GitHub issue dependencies when available.
  Dependency API calls require numeric database IDs, not issue numbers
  or node IDs. Otherwise, record "Blocked by: #<n>" in the child body.
- Frontier: inspect the map's open children in map order; select
  the first unassigned child with no open blockers.
- Claim: assign the selected issue to the driving developer.
- Resolve: comment with the answer, close the child, and append
  a brief result with a link to the map's Decisions-so-far.
