/**
 * Runs once when a new Next.js server instance starts (App Router
 * `instrumentation.ts` convention). Fail-fast env validation: crash the boot
 * with one readable error instead of serving cryptic 500s on the first
 * request. No secrets are logged — only counts and paths.
 *
 * `instrumentation.ts` is bundled for BOTH the Node.js and Edge runtimes, and
 * this module pulls in `lib/env`, which uses `fs` (Node-only). A static import
 * breaks the Edge build with "A Node.js module is loaded ('fs')". The dynamic
 * `import()` inside the `nodejs` branch keeps the fs dependency out of the Edge
 * chunk — see "instrumentation.node.ts switcher" in the Next.js OpenTelemetry
 * guide, which documents this exact split.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  await import('./instrumentation.node');
}
