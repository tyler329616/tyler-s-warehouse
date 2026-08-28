#!/usr/bin/env bun
/**
 * Sandbox eval runner with 3-phase pipeline: Build → Verify → Deploy.
 *
 * Phase 1 (BUILD):  Claude Code builds the app in a fresh sandbox.
 * Phase 2 (VERIFY): A follow-up Claude Code session uses agent-browser to
 *                    walk through user stories, fixing issues until all pass.
 * Phase 3 (DEPLOY): A third Claude Code session links to vercel-labs, runs
 *                    `vercel deploy`, and fixes build errors (up to 3 retries).
 *                    Deployed apps have deployment protection enabled by default.
 *
 * Skills are tracked across all 3 phases — each phase may trigger additional
 * skill injections as new files/patterns are created.
 *
 * Usage:
 *   bun run .claude/skills/benchmark-sandbox/run-eval.ts [options]
 *   --concurrency N     Max parallel sandboxes (default 5, max 10)
 *   --timeout MS        Per-phase timeout in ms (default 1800000 = 30 min)
 *   --keep-alive        Keep sandboxes running after eval
 *   --keep-hours N      Hours to keep alive (default 8)
 *   --skip-verify       Skip the agent-browser verification phase
 *   --skip-deploy       Skip the Vercel deploy phase
 *   --scenarios a,b,c   Only run specific scenarios by slug
 *   --scenarios-file f  Load scenarios from a JSON file
 */
