#!/usr/bin/env node
/**
 * Launch a Cursor cloud agent for a triaged product ticket.
 *
 * On `ready-for-agent`: create one work-item in GridGame-mono (back-linked),
 * then launch Cursor against that mono repo. Agents may change web, API, and iOS.
 * They merge their own PR into `dev` after CI is green.
 */
import { Agent, CursorAgentError } from '@cursor/sdk';

const MONO_URL = 'https://github.com/andyofengland/GridGame-mono';
const MONO_REPO = 'andyofengland/GridGame-mono';

const OWNER_REPO = process.env.GITHUB_REPOSITORY || 'andyofengland/GridGame-Web-issues';
const TOKEN = process.env.GITHUB_TOKEN;
const CODE_REPOS_TOKEN = process.env.CODE_REPOS_TOKEN;
const API_KEY = process.env.CURSOR_API_KEY;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_TITLE = process.env.ISSUE_TITLE || '';
const ISSUE_BODY = process.env.ISSUE_BODY || '';
const ISSUE_URL = process.env.ISSUE_URL || '';
const LABELS = (process.env.ISSUE_LABELS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function hasLabel(name) {
  return LABELS.includes(name.toLowerCase());
}

function trackerBlock() {
  return [
    `Product: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}`,
    `Tracker: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}`,
  ].join('\n');
}

async function github(token, method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gridlocked-cursor-launcher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`GitHub ${method} ${path} failed: ${response.status} ${data.message || ''}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function comment(body) {
  return github(TOKEN, 'POST', `/repos/${OWNER_REPO}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function addLabels(labels) {
  return github(TOKEN, 'POST', `/repos/${OWNER_REPO}/issues/${ISSUE_NUMBER}/labels`, { labels });
}

function workItemBody() {
  return [
    trackerBlock(),
    '',
    '## Product ticket',
    ISSUE_TITLE,
    '',
    ISSUE_BODY || '(no body)',
    '',
    `Public issue: ${ISSUE_URL}`,
  ].join('\n');
}

async function findWorkItem() {
  const query = `repo:${MONO_REPO} is:issue in:body "Tracker: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}"`;
  const found = await github(CODE_REPOS_TOKEN, 'GET', `/search/issues?q=${encodeURIComponent(query)}`);
  return (found.items || [])[0] || null;
}

async function ensureWorkItem(workItemLabel = 'ready-for-agent') {
  if (!CODE_REPOS_TOKEN) {
    throw new Error('repository secret CODE_REPOS_TOKEN is missing');
  }
  const existing = await findWorkItem();
  if (existing) {
    return { url: existing.html_url, number: existing.number, body: existing.body || '', created: false };
  }
  const created = await github(CODE_REPOS_TOKEN, 'POST', `/repos/${MONO_REPO}/issues`, {
    title: ISSUE_TITLE,
    body: workItemBody(),
    labels: [workItemLabel],
  });
  return { url: created.html_url, number: created.number, body: workItemBody(), created: true };
}

function buildPrompt(workItem) {
  return [
    'Implement this Gridlocked product ticket in the GridGame-mono repository.',
    '',
    `Mono work-item (your scope): ${workItem.url}`,
    workItem.body || '',
    '',
    `Public product ticket: ${ISSUE_URL}`,
    `Title: ${ISSUE_TITLE}`,
    '',
    'Requirements:',
    '- Branch from `dev` and open the pull request against `dev`, never `main`.',
    '- After required CI checks on the PR are green, **merge your own PR into `dev`** (agent merge). Do not open or merge a PR to `main`.',
    '- The repo auto-deletes the feature branch on merge into `dev`. Never delete `dev` or `main`.',
    '- If you close a PR as superseded or abandon it without merging, delete the remote feature branch.',
    `- Put this exact reference in the PR title or body: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}`,
    '- Follow AGENTS.md and docs/DEV_PROMOTION.md in the repo.',
    '- You may change apps/web, apps/api, and apps/ios as needed for this ticket.',
    '- Prefer landing API contract changes before or with client changes in the same PR when both must move.',
    '- Run the relevant app test/lint/build commands and fix failures you cause.',
    '- Keep the diff minimal. Do not commit secrets.',
  ].join('\n');
}

async function launch(workItem) {
  const result = await Agent.prompt(buildPrompt(workItem), {
    apiKey: API_KEY,
    model: { id: 'composer-2.5' },
    cloud: {
      repos: [{ url: MONO_URL, startingRef: 'dev' }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
  });

  const prUrl = result.git?.branches?.[0]?.prUrl || result.git?.branches?.[0]?.pr_url || '';
  const branch = result.git?.branches?.[0]?.branch || '';
  const runId = result.id || '';
  return { status: result.status, prUrl, branch, runId };
}

async function main() {
  if (!ISSUE_NUMBER) throw new Error('ISSUE_NUMBER is required');
  if (!TOKEN) throw new Error('GITHUB_TOKEN is required');

  if (hasLabel('ready-for-human') && !hasLabel('ready-for-agent')) {
    await comment(
      'Ticket is `ready-for-human`. Creating a mono work-item only; no Cursor agent will be launched.',
    );
    try {
      const workItem = await ensureWorkItem('ready-for-human');
      await comment(
        `Mono work-item: ${workItem.url}${workItem.created ? '' : ' (already existed)'}. A person should implement it.`,
      );
    } catch (err) {
      await addLabels(['agent:blocked']);
      await comment(`Could not create the mono work-item: ${err.message || err}`);
      process.exitCode = 1;
    }
    return;
  }

  let workItem;
  try {
    workItem = await ensureWorkItem();
    await comment(
      `Opened mono work-item ${workItem.url}${workItem.created ? '' : ' (already existed)'}. Launching Cursor against GridGame-mono.`,
    );
  } catch (err) {
    await addLabels(['agent:blocked']);
    await comment(`Could not create the mono work-item: ${err.message || err}`);
    process.exitCode = 1;
    return;
  }

  if (!API_KEY) {
    await addLabels(['agent:blocked']);
    await comment(
      'Cannot launch Cursor: repository secret `CURSOR_API_KEY` is missing. Add it under Settings → Secrets on this issues repo.',
    );
    process.exitCode = 1;
    return;
  }

  try {
    const launched = await launch(workItem);
    const lines = [
      'Cursor cloud agent launch (GridGame-mono):',
      `- status \`${launched.status}\`` +
        (launched.prUrl ? ` PR ${launched.prUrl}` : '') +
        (launched.branch ? ` branch \`${launched.branch}\`` : '') +
        (launched.runId ? ` run \`${launched.runId}\`` : ''),
    ];
    if (launched.status === 'error') {
      await addLabels(['agent:blocked']);
      process.exitCode = 1;
    } else {
      await addLabels(['in-dev']);
    }
    await comment(lines.join('\n'));
  } catch (err) {
    await addLabels(['agent:blocked']);
    const message = err instanceof CursorAgentError ? err.message : err.message || String(err);
    await comment(`Cursor launch failed: ${message}`);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await addLabels(['agent:blocked']);
    await comment(`Cursor launcher crashed: \`${err.message || err}\``);
  } catch (commentErr) {
    console.error(commentErr);
  }
  process.exit(1);
});
