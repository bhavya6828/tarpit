# Agent Instructions

Working agreement for anyone, human or agent, touching this repo.

## SPEC.md is the source of truth

`SPEC.md` describes every behavior of the app. Any behavior change lands in the spec
first, then in code. If code and spec disagree, the spec wins and the code is a bug.
Never change behavior to match code that drifted.

## Commits

- Two commits per task in `tasks/`: one RED, one GREEN. The git log must show the tests
  landing before the code that satisfies them.
  - RED: `test(<scope>): add failing specs for <thing>`
  - GREEN: `feat(<scope>): <thing>`, or `fix(...)` / `refactor(...)` as appropriate
- Conventional Commits format, for example `feat(build): add dependency-free bundler`.
- Write every commit message with the `git-commit-formatter` skill. It owns the format, so do not
  hand-roll a message and hope it conforms.
- **Never add a `Co-Authored-By` trailer, and never list Claude as a co-author on any commit.**
- Push to `origin/main` after each task.

## Style

- Prioritize simplicity and readability over clever solutions.
- Start minimal, verify it works, then add complexity.
- Prefer functional and stateless code where it improves clarity.
- Keep core logic clean and push implementation details to the edges.
- Keep indentation, naming, and patterns consistent across the codebase.
- No em-dashes in prose.
- No comments on anything.