#!/usr/bin/env node
// Claude Code hook: forwards the event to the UltraClaude server and prints its answer.
// Does nothing outside of an UltraClaude agent, and never blocks Claude if the server is gone.
const url = process.env.ULTRACLAUDE_HOOK_URL;
if (!url) process.exit(0);

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: input || '{}',
    signal: AbortSignal.timeout(4000),
  });
  const text = await res.text();
  if (res.ok && text) process.stdout.write(text);
} catch {
  // server not reachable: stay silent
}
process.exit(0);
