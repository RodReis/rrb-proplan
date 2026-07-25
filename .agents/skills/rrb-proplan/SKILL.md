```markdown
# rrb-proplan Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and conventions used in the `rrb-proplan` TypeScript codebase. You'll learn about file organization, code style, commit patterns, and how to write and run tests. The repository does not use a specific framework, focusing instead on clean TypeScript practices.

## Coding Conventions

### File Naming
- Use **PascalCase** for all file names.
  - Example: `UserProfile.ts`, `ProjectPlan.test.ts`

### Import Style
- Use **relative imports** for referencing modules within the codebase.
  - Example:
    ```typescript
    import { calculateBudget } from './BudgetUtils';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // BudgetUtils.ts
    export function calculateBudget() { ... }
    ```

### Commit Patterns
- Commit types are **mixed**; common prefixes include `identity` and `docs`.
- Commit messages are concise, averaging 59 characters.
  - Example: `identity: add user authentication middleware`
  - Example: `docs: update API usage instructions`

## Workflows

### Code Contribution
**Trigger:** When adding new features or fixing bugs  
**Command:** `/contribute`

1. Create a new branch for your change.
2. Follow the coding conventions for file naming, imports, and exports.
3. Write or update tests in files matching `*.test.*`.
4. Use an appropriate commit prefix (`identity`, `docs`, etc.).
5. Submit a pull request for review.

### Documentation Update
**Trigger:** When updating or adding documentation  
**Command:** `/update-docs`

1. Edit or create documentation files as needed.
2. Use the `docs:` prefix in your commit message.
3. Submit your changes for review.

## Testing Patterns

- Test files follow the pattern: `*.test.*` (e.g., `ProjectPlan.test.ts`).
- The specific testing framework is not detected, but tests are colocated with source files or in a dedicated test directory.
- Example test file:
  ```typescript
  // ProjectPlan.test.ts
  import { calculateBudget } from './BudgetUtils';

  describe('calculateBudget', () => {
    it('returns correct budget for valid input', () => {
      expect(calculateBudget(100, 0.1)).toBe(110);
    });
  });
  ```

## Commands
| Command         | Purpose                                  |
|-----------------|------------------------------------------|
| /contribute     | Start the code contribution workflow     |
| /update-docs    | Start the documentation update workflow  |
```
