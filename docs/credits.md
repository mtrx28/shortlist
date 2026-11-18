# Credits

Third-party tools and libraries used to build this project. Versions are the ones in `package-lock.json`.

## Scaffolding and generators

| What                         | How I used it                                                                                                                                                                                                                     | Licence |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| create-next-app (Next.js 15) | Generated the starting project (app folder, tsconfig, eslint and postcss config). I removed the sample page and logos.                                                                                                            | MIT     |
| shadcn/ui CLI (`shadcn`)     | Generated `components.json`, `components/ui/button.tsx`, `lib/utils.ts` and the theme variables in `app/globals.css`. I changed the primary colour and fixed the font variable. More components are added the same way as needed. | MIT     |

## Runtime libraries

| Library                            | Used for                                                                        | Licence    |
| ---------------------------------- | ------------------------------------------------------------------------------- | ---------- |
| Next.js, React, React DOM          | App framework and UI                                                            | MIT        |
| Tailwind CSS, @tailwindcss/postcss | Styling                                                                         | MIT        |
| tw-animate-css                     | Animation utilities that shadcn/ui components expect                            | MIT        |
| @base-ui/react                     | Unstyled accessible primitives that shadcn/ui components are built on           | MIT        |
| class-variance-authority           | Button style variants                                                           | Apache-2.0 |
| cn                                 | Merges Tailwind class names (the shadcn helper)                                 | MIT        |
| lucide-react                       | Icons                                                                           | ISC        |
| @supabase/supabase-js (2.119)      | Supabase client (database, auth, service-role jobs)                             | MIT        |
| @supabase/ssr (0.12)               | Keeps the Supabase session in cookies for server-rendered pages                 | MIT        |
| zod (4.6)                          | Validating every form and server action input                                   | MIT        |
| browser-image-compression (2.0)    | Shrinking and re-encoding photos in the browser before upload (drops EXIF data) | MIT        |

## Development tools

| Tool                                                                 | Used for                                                                                      | Licence    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| TypeScript                                                           | Type checking                                                                                 | Apache-2.0 |
| ESLint, eslint-config-next, @eslint/eslintrc, eslint-config-prettier | Linting                                                                                       | MIT        |
| Prettier, prettier-plugin-tailwindcss                                | Code formatting                                                                               | MIT        |
| Vitest                                                               | Unit tests                                                                                    | MIT        |
| @electric-sql/pglite (0.5)                                           | In-process Postgres so the row level security tests run with no Docker or Supabase account    | Apache-2.0 |
| tsx (4.23)                                                           | Runs the TypeScript seed script (`npm run seed`)                                              | MIT        |
| @playwright/test (1.65)                                              | Browser tests in a real Chromium (`npm run test:e2e`); only the Chromium browser is installed | Apache-2.0 |
| @axe-core/playwright (4.14) and axe-core                             | Automatic accessibility checks inside the browser tests                                       | MPL-2.0    |
| @types/node, @types/react, @types/react-dom                          | Type definitions                                                                              | MIT        |

## Demo data

The demo members are invented: names, jobs, prompt answers and chats were written for this project and are not real people. The avatar pictures are generated by my own small script (`scripts/seed/avatar.ts`, a gradient with a head-and-shoulders shape, written with Node's built-in zlib). They use no third-party artwork, so there is no extra licence to credit.

## Icons and images

The app icons in `public/` (`icon.svg`, the PNG icons for the web app manifest and the Apple touch icon) are drawn by my own script, `scripts/make-icons.ts` (three rounded bars on a teal square, written with Node's built-in zlib; no image library, no outside artwork). The social preview image (`app/opengraph-image.tsx`) is drawn with `next/og`, which ships inside Next.js (it bundles Satori and resvg under their own open source licences; I did not add them myself) and contains no outside pictures or font files. The smoke script (`scripts/smoke.ts`) uses the Playwright package already listed above for its optional login check.

## Fonts

Geist and Geist Mono, loaded through `next/font/google` (SIL Open Font Licence 1.1).

## Services

GitHub Actions (CI, the weekly drop schedule and the keep-alive ping; the workflows use only `actions/checkout`, `actions/setup-node` and `curl`). The shortlist rules, the note and contact-detail checks (`lib/shortlist/`, `lib/validators/contact-info.ts`) and the chat-opening database function are my own code with no extra libraries. The matching engine, its seeded random number generator (a standard mulberry32 with an FNV-1a hash, a few lines written out in `lib/matching/random.ts`) and the scoring are my own code with no extra libraries. The conversation rules (`lib/conversation/`), the reply-rate maths, the message rate limit (a count over the messages table) and the chat screens are my own code; the live updates use the Supabase Realtime feature of the Supabase client I already use, with no extra library. Supabase (database, auth, storage and realtime, free plan) and Vercel (hosting, Hobby plan) are the hosted services the deployment uses; see `docs/deploy.md`.

Payments (`lib/payments/`, `config/plans.ts`, `lib/plus.ts`) are my own code with no extra library. Razorpay is called through its public REST API with `fetch` (the Orders API), and Razorpay's own checkout script (`checkout.razorpay.com/v1/checkout.js`) is loaded in the browser only when a member starts a payment. I did not add the `razorpay` npm package. Signatures use Node's built-in `crypto` (HMAC-SHA256 and a constant-time compare). Razorpay is a third-party service used in test mode only; its terms and test card numbers are on razorpay.com/docs and are not copied into this repository.

The Supabase command line tool and the Supabase container images (Postgres, GoTrue, PostgREST, Realtime, Storage, Mailpit) are used only to run a local copy of the backend for the integration and browser tests. They are fetched when `npm run stack:up` runs and are not part of the shipped app (the CLI is Apache-2.0; the services have their own open source licences).

Licences were taken from each package's published metadata; I have not audited transitive dependencies one by one.
