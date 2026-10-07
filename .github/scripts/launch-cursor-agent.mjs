#!/usr/bin/env node
/**
 * Launch Cursor cloud agents for a public GridGame-Web-issues ticket.
 * Keys off labels, not GitHub issue-form YAML (in-game feedback bypasses forms).
 */
import { Agent, CursorAgentError } from '@cursor/sdk';

const REPOS = {
  frontend: 'https://github.com/andyofengland/GridGame-Web-frontend',
  backend: 'https://github.com/andyofengland/GridGame-Web-backend',
};

const OWNER_REPO = process.env.GITHUB_REPOSITORY || 'andyofengland/GridGame-Web-issues';
const TOKEN = process.env.GITHUB_TOKEN;
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

async function github(method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'gridlocked-cursor-launcher',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${path} failed: ${response.status} ${data.message || ''}`);
  }
  return data;
}

async function comment(body) {
  return github('POST', `/repos/${OWNER_REPO}/issues/${ISSUE_NUMBER}/comments`, { body });
}

async function addLabels(labels) {
  return github('POST', `/repos/${OWNER_REPO}/issues/${ISSUE_NUMBER}/labels`, { labels });
}

function buildPrompt(area, extra) {
  return [
    `Implement this Gridlocked ticket in the ${area} repository.`,
    '',
    `Public issue: ${ISSUE_URL}`,
    `Title: ${ISSUE_TITLE}`,
    '',
    ISSUE_BODY || '(no body)',
    '',
    extra || '',
    '',
    'Requirements:',
    '- Branch from `dev` and open the pull request against `dev`, never `main`.',
    `- Put this exact reference in the PR title or body so labels sync: andyofengland/GridGame-Web-issues#${ISSUE_NUMBER}`,
    '- Follow AGENTS.md in the repo.',
    '- Run the repo test/lint/build commands and fix failures you cause.',
    '- Keep the diff minimal. Do not commit secrets.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

async function launch(area) {
  const url = REPOS[area];
  const extra =
    area === 'frontend' && hasLabel('cross-repo')
      ? 'This is a cross-repo ticket. Match the backend API already proposed or merged on backend `dev`. If the contract is missing, stop and say so in the PR.'
      : area === 'backend' && hasLabel('cross-repo')
        ? 'This is a cross-repo ticket. Land the API contract (routes + tests) so a frontend agent can follow.'
        : '';

  const result = await Agent.prompt(buildPrompt(area, extra), {
    apiKey: API_KEY,
    model: { id: 'composer-2.5' },
    cloud: {
      repos: [{ url, startingRef: 'dev' }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
  });

  const prUrl = result.git?.branches?.[0]?.prUrl || result.git?.branches?.[0]?.pr_url || '';
  const branch = result.git?.branches?.[0]?.branch || '';
  const agentId = result.agentId || result.agent_id || '';
  const runId = result.id || '';
  return { area, status: result.status, prUrl, branch, agentId, runId };
}

async function main() {
  if (!ISSUE_NUMBER) {
    throw new Error('ISSUE_NUMBER is required');
  }
  if (!TOKEN) {
    throw new Error('GITHUB_TOKEN is required');
  }

  const wantsFrontend = hasLabel('area:frontend');
  const wantsBackend = hasLabel('area:backend');
  const wantsIos = hasLabel('area:ios');
  const crossRepo = hasLabel('cross-repo');
  const readyFrontend = hasLabel('ready-for-frontend');

  if (!wantsFrontend && !wantsBackend && !wantsIos) {
    await addLabels(['agent:blocked']);
    await comment(
      'Cannot launch an agent: add `area:frontend`, `area:backend`, and/or `area:ios` before `ready-for-dev`. (In-game tickets do not set area labels automatically.)',
    );
    return;
  }

  if (wantsIos && !wantsFrontend && !wantsBackend) {
    await comment(
      '`area:ios` is human-gated. Cursor will not run on GridGame-Web-iOS until macOS CI exists. Implement in Xcode locally; see that repo’s `AGENTS.md`.',
    );
    return;
  }

  if (wantsIos) {
    await comment(
      '`area:ios` is ignored by the launcher (human-gated). Frontend/backend agents may still run for the other area labels.',
    );
  }

  const targets = [];
  const trigger = (process.env.TRIGGER_LABEL || '').toLowerCase();
  const launchBackend = wantsBackend && trigger !== 'ready-for-frontend';
  if (launchBackend) targets.push('backend');
  if (wantsFrontend) {
    if (crossRepo && !readyFrontend && trigger !== 'ready-for-frontend') {
      await comment(
        'Cross-repo ticket: launching **backend** only. After the backend PR exists, add label `ready-for-frontend` to start the frontend agent.',
      );
    } else if (wantsFrontend && (!crossRepo || readyFrontend || trigger === 'ready-for-frontend')) {
      targets.push('frontend');
    }
  }

  if (targets.length === 0) {
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

  const lines = ['Cursor cloud agent launch:'];
  let failed = false;
  for (const area of targets) {
    try {
      const launched = await launch(area);
      lines.push(
        `- **${area}**: status \`${launched.status}\`` +
          (launched.prUrl ? ` PR ${launched.prUrl}` : '') +
          (launched.branch ? ` branch \`${launched.branch}\`` : '') +
          (launched.runId ? ` run \`${launched.runId}\`` : ''),
      );
      if (launched.status === 'error') failed = true;
    } catch (err) {
      failed = true;
      const message = err instanceof CursorAgentError ? err.message : err.message || String(err);
      lines.push(`- **${area}**: failed — ${message}`);
    }
  }

  if (failed) {
    await addLabels(['agent:blocked']);
  } else {
    await addLabels(['in-dev']);
  }
  await comment(lines.join('\n'));
  if (failed) process.exitCode = 1;
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
