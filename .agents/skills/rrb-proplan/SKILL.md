```markdown
# rrb-proplan Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `rrb-proplan` TypeScript repository. You'll learn how to structure files, write imports and exports, follow commit conventions, and implement and run tests using Jest. This guide is ideal for onboarding contributors or maintaining consistency across the codebase.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `dataIngestion.ts`

### Import Style
- Use **relative imports** for referencing modules.
  - Example:
    ```typescript
    import { fetchData } from './dataIngestion';
    ```

### Export Style
- Use **named exports** rather than default exports.
  - Example:
    ```typescript
    // dataIngestion.ts
    export function fetchData() { /* ... */ }
    ```

### Commit Patterns
- Commit types are **mixed** (feature, fix, docs, etc.).
- Common prefixes: `ingestion`, `docs`
- Example commit messages:
  - `ingestion: add new data source for user profiles`
  - `docs: update README with setup instructions`

## Workflows

### Code Ingestion
**Trigger:** When adding or updating data ingestion logic  
**Command:** `/ingestion-update`

1. Create or update a camelCase-named file for the ingestion logic.
2. Use relative imports to reference dependencies.
3. Export functions or constants using named exports.
4. Write or update Jest tests in a corresponding `.spec.ts` file.
5. Commit changes with an `ingestion:` prefix.
   - Example: `ingestion: support CSV file ingestion`

### Documentation Update
**Trigger:** When updating or adding documentation  
**Command:** `/docs-update`

1. Edit or create documentation files as needed.
2. Ensure code snippets follow the repository's coding conventions.
3. Commit changes with a `docs:` prefix.
   - Example: `docs: add API usage examples`

## Testing Patterns

- **Framework:** Jest
- **Test file pattern:** Use `.spec.ts` suffix for test files.
  - Example: `dataIngestion.spec.ts`
- **Test structure:** Import the module using a relative path and test named exports.
  - Example:
    ```typescript
    import { fetchData } from './dataIngestion';

    describe('fetchData', () => {
      it('should return expected data', () => {
        expect(fetchData()).toEqual(expectedData);
      });
    });
    ```

## Commands
| Command            | Purpose                                   |
|--------------------|-------------------------------------------|
| /ingestion-update  | Add or update data ingestion logic        |
| /docs-update       | Update or add documentation               |
```
