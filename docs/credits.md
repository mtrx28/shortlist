# Credits

Third-party tools and libraries used to build this project. Versions are the ones in `package-lock.json`.

## Scaffolding and generators

| What                         | How I used it                                                                                                                                                                                                                     | Licence |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| create-next-app (Next.js 15) | Generated the starting project (app folder, tsconfig, eslint and postcss config). I removed the sample page and logos.                                                                                                            | MIT     |
| shadcn/ui CLI (`shadcn`)     | Generated `components.json`, `components/ui/button.tsx`, `lib/utils.ts` and the theme variables in `app/globals.css`. I changed the primary colour and fixed the font variable. More components are added the same way as needed. | MIT     |

## Runtime libraries

| Library                            | Used for                                                              | Licence    |
| ---------------------------------- | --------------------------------------------------------------------- | ---------- |
| Next.js, React, React DOM          | App framework and UI                                                  | MIT        |
| Tailwind CSS, @tailwindcss/postcss | Styling                                                               | MIT        |
| tw-animate-css                     | Animation utilities that shadcn/ui components expect                  | MIT        |
| @base-ui/react                     | Unstyled accessible primitives that shadcn/ui components are built on | MIT        |
| class-variance-authority           | Button style variants                                                 | Apache-2.0 |
| cn                                 | Merges Tailwind class names (the shadcn helper)                       | MIT        |
| lucide-react                       | Icons                                                                 | ISC        |
| @supabase/supabase-js (2.119)      | Supabase client (database, auth, service-role jobs)                   | MIT        |
| @supabase/ssr (0.12)               | Keeps the Supabase session in cookies for server-rendered pages       | MIT        |
| zod (4.6)                          | Validating every form and server action input                         | MIT        |

## Development tools

| Tool                                                                 | Used for                                                                                   | Licence    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------- |
| TypeScript                                                           | Type checking                                                                              | Apache-2.0 |
| ESLint, eslint-config-next, @eslint/eslintrc, eslint-config-prettier | Linting                                                                                    | MIT        |
| Prettier, prettier-plugin-tailwindcss                                | Code formatting                                                                            | MIT        |
| Vitest                                                               | Unit tests                                                                                 | MIT        |
| @electric-sql/pglite (0.5)                                           | In-process Postgres so the row level security tests run with no Docker or Supabase account | Apache-2.0 |
| @types/node, @types/react, @types/react-dom                          | Type definitions                                                                           | MIT        |

## Fonts

Geist and Geist Mono, loaded through `next/font/google` (SIL Open Font Licence 1.1).

## Services

GitHub Actions (CI). Supabase, Vercel and Razorpay will be added here when they are actually wired in.

Licences were taken from each package's published metadata; I have not audited transitive dependencies one by one.
