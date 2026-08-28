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

import { Sandbox } from "@vercel/sandbox";
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const SANDBOX_HOME = "/home/vercel-sandbox";
const SANDBOX_PLUGIN_DIR = `${SANDBOX_HOME}/vercel-plugin`;
const LOCAL_PLUGIN_DIR = join(homedir(), "dev", "vercel-plugin");
const UPLOAD_DIRS = ["hooks", "skills", "generated"];
const RESULTS_DIR = join(homedir(), "dev", "vercel-plugin-testing", "sandbox-results");

const args = process.argv.slice(2);
const getArg = (name: string, fallback: number) =>
  args.includes(`--${name}`) ? parseInt(args[args.indexOf(`--${name}`) + 1], 10) : fallback;
const CONCURRENCY = Math.min(Math.max(getArg("concurrency", 5), 1), 10);
const TIMEOUT_MS = getArg("timeout", 1_800_000);
let runId = "";
const KEEP_ALIVE = args.includes("--keep-alive");
const KEEP_ALIVE_HOURS = getArg("keep-hours", 8);
const SKIP_VERIFY = args.includes("--skip-verify");
const SKIP_DEPLOY = args.includes("--skip-deploy");
const BUILD_STATUS_INTERVAL_MS = 10_000;
const BUILD_WAIT_POLL_MS = 10_000;
const BUILD_STALE_THRESHOLD_MS = 120_000;
const SCENARIO_FILTER = args.includes("--scenarios")
  ? args[args.indexOf("--scenarios") + 1]?.split(",").map(s => s.trim()) ?? []
  : [];
const SCENARIOS_FILE = args.includes("--scenarios-file")
  ? args[args.indexOf("--scenarios-file") + 1]
  : undefined;

interface Scenario {
  slug: string;
  prompt: string;
  expectedSkills: string[];
  userStories: [string, string, string];
}

const SCENARIOS: Scenario[] = [
  {
    slug: "ai-writing-assistant",
    prompt: `Build a Next.js AI writing assistant app.`,
    expectedSkills: ["ai-sdk", "swr", "shadcn", "routing-middleware", "geist", "nextjs"],
    userStories: [
      "As a user, I can see a text area where I can paste or type content to be processed by AI",
      "As a user, I can select a mode (rewrite, expand, or summarize) and click a button to get an AI response",
      "As a user, I can see the AI-generated response appear with streaming text output",
    ],
  },
];

function resolveApiKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  console.error("Missing ANTHROPIC_API_KEY"); process.exit(1);
}

function resolveVercelToken(): string | undefined {
  try {
    return JSON.parse(require("fs").readFileSync(join(homedir(), ".local/share/com.vercel.cli/auth.json"), "utf-8")).token;
  } catch { return undefined; }
}
