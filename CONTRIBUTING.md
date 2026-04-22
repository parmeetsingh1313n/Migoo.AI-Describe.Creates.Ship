# Contributing to Migoo

Thank you for your interest in contributing to Migoo! This document outlines the guidelines and processes for contributing.

## 🚀 Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/Migoo.git`
3. **Install** dependencies: `npm install --legacy-peer-deps`
4. **Create a branch**: `git checkout -b feature/your-feature-name`

## 📋 Development Guidelines

### Code Standards

- **TypeScript** — All code must be written in TypeScript with proper types
- **Zod Validation** — All API inputs must be validated using Zod schemas in `lib/validations.ts`
- **Error Handling** — Use `apiSuccess()` and `apiError()` helpers from `lib/api-helpers.ts`
- **JSDoc** — Add JSDoc comments to all exported functions and modules
- **Security** — Never expose secrets; always use `lib/env.ts` for environment access

### File Naming

- React components: `PascalCase.tsx`
- Utility files: `kebab-case.ts`
- Test files: `*.test.ts` in `__tests__/` directory
- API routes: `route.ts` inside `app/api/[endpoint]/`

### Branch Naming

- Features: `feature/description`
- Bug fixes: `fix/description`
- Improvements: `improve/description`

## 🧪 Testing

Run tests before submitting a PR:

```bash
# Run all tests
npm test

# Run in watch mode during development
npm run test:watch
```

### Writing Tests

- Place tests in `__tests__/` mirroring the source structure
- Test all validation schemas for valid and invalid inputs
- Test edge cases (empty strings, XSS payloads, boundary values)

## 📤 Pull Request Process

1. **Ensure tests pass**: `npm test`
2. **Ensure build succeeds**: `npm run build`
3. **Update documentation** if your change affects the API or setup
4. **Write a clear PR description** explaining what and why
5. **Request review** from a team member

### PR Checklist

- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No console.log in production code (use proper logging)
- [ ] Zod validation added for new API endpoints
- [ ] Security headers applied via `apiSuccess()`/`apiError()`

## 🏗️ Architecture Rules

1. **API Routes** must use Zod validation + typed responses
2. **Database queries** must use Drizzle ORM (no raw SQL)
3. **Auth checks** required on all non-public endpoints
4. **Environment variables** must be defined in `lib/env.ts`
5. **Background jobs** must use Inngest for long-running tasks

## 📬 Questions?

Open an issue on GitHub for questions or suggestions.
