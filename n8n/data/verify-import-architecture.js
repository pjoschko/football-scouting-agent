'use strict';

const fs = require('node:fs');
const path = require('node:path');

const n8nDir = path.resolve(__dirname, '..');
const readWorkflow = (name) => JSON.parse(fs.readFileSync(path.join(n8nDir, name), 'utf8'));

const expected = {
  'analytics-team-performance-subworkflow.json': 'e7a415a1-6e8b-4f26-a724-3f728588c6b3',
  'analytics-team-matches-subworkflow.json': '68f47ebf-1e64-41a1-af75-b2afae2c0fbc',
  'analytics-player-ranking-subworkflow.json': '5e50b3ea-5e60-436f-b8bd-77957b54355a',
  'analytics-player-profile-subworkflow.json': 'd6f31473-12f9-40a2-b935-ca998397142e',
};

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const [file, workflowId] of Object.entries(expected)) {
  const wf = readWorkflow(file);
  const serialized = JSON.stringify(wf);
  assert(wf.id === workflowId, `${file}: stable workflow ID changed`);
  assert(serialized.includes('football_scouting_raw'), `${file}: does not read football_scouting_raw`);
  assert(serialized.includes('n8n-nodes-base.dataTable'), `${file}: no Data Table node found`);
  assert(!serialized.includes('const MATCHES_CSV'), `${file}: embedded MATCHES_CSV returned`);
  assert(!serialized.includes('const PLAYERS_CSV'), `${file}: embedded PLAYERS_CSV returned`);
  assert(!serialized.includes('J. Reimann'), `${file}: old five-club player fixture returned`);
  assert(!serialized.includes('2026-08-30,Union Berlin'), `${file}: old five-club match fixture returned`);
}

const importer = readWorkflow('import-scouting-data.json');
const importerText = JSON.stringify(importer);
const trigger = importer.nodes.find((node) => node.type === 'n8n-nodes-base.formTrigger');
const fields = trigger?.parameters?.formFields?.values || [];
assert(fields.some((f) => f.fieldName === 'matchesFile' && f.fieldType === 'file'), 'import workflow: matchesFile upload missing');
assert(fields.some((f) => f.fieldName === 'playersFile' && f.fieldType === 'file'), 'import workflow: playersFile upload missing');
assert(importerText.includes('football_scouting_raw'), 'import workflow: target Data Table missing');
assert(importerText.includes('306 Spiele'), 'import workflow: full match-data cardinality guard missing');
assert(importerText.includes('18 Bundesliga-Vereine'), 'import workflow: 18-club coverage guard missing');
assert(importerText.includes('~2.433 Spieler'), 'import workflow: full player-data cardinality guard missing');

for (const retired of ['matches.csv', 'players.csv', 'build_subworkflows.js', 'simulate_main_workflow.js']) {
  assert(!fs.existsSync(path.join(__dirname, retired)), `retired sample artifact still exists: ${retired}`);
}

if (failures.length) {
  console.error(`Architecture verification failed (${failures.length}):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('OK: analytics uses persistent original-data import; embedded sample CSVs are absent.');
