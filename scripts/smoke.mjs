#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'builders-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Local date, the same way the CLI computes "today". Never UTC: New Zealand is
// twelve hours ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the business ---------------------------------------------------------

  const clients = run('clients', ['builders.mjs', 'clients']);
  assert(clients.length === 6, `six clients (${clients.length})`);
  const donovanRow = clients.find((c) => c.name === 'Sarah and Mike Donovan');
  assert(n(donovanRow.owing) === 88000, `the Donovans owe the overdue claim (${donovanRow.owing})`);

  const client = run('client card', ['builders.mjs', 'client', 'Donovan']);
  assert(client.client.contact_name === 'Sarah Donovan', 'resolved by partial name');
  assert(client.jobs.length === 1 && client.jobs[0].ref === 'JOB-101', 'with their job');

  const noSuch = run('an unknown client exits 1', ['builders.mjs', 'client', 'nobody at all'], { json: false, expectFail: true });
  assert(/No client matches/.test(noSuch.stderr), 'and says so plainly');

  const ambiguous = run('an ambiguous name exits 1 and lists candidates', ['builders.mjs', 'client', 'a'], { json: false, expectFail: true });
  assert(/matches \d+ client records/.test(ambiguous.stderr), 'with the candidates listed');

  // ---- jobs and the pipeline --------------------------------------------------

  const jobs = run('active jobs', ['builders.mjs', 'jobs']);
  assert(jobs.length === 3, `three active (${jobs.length})`);
  const all = run('jobs --all', ['builders.mjs', 'jobs', '--all']);
  assert(all.length === 6, `six on the record (${all.length})`);

  const job101 = run('a job by bare number', ['builders.mjs', 'job', '101']);
  assert(job101.job.ref === 'JOB-101', 'JOB-101 resolves from "101"');
  assert(n(job101.job.revised_contract) === 863400, `contract plus approved variations (${job101.job.revised_contract})`);
  assert(n(job101.job.claimed) === 333050 && n(job101.job.outstanding) === 88000, 'the claims position is right');
  assert(n(job101.job.costs_actual) === 277300 && n(job101.job.committed) === 40500, 'costs and committed are right');
  assert(n(job101.job.forecast_margin) === 545600, `forecast margin (${job101.job.forecast_margin})`);
  assert(job101.budget.length === 8, 'eight budget lines');
  assert(job101.crew.length === 3 && job101.tasks.length === 3, 'crew and schedule on the card');

  const pipeline = run('the pipeline', ['builders.mjs', 'pipeline']);
  assert(pipeline.length === 2, `two quotes out (${pipeline.length})`);
  assert(pipeline[0].ref === 'JOB-104' && n(pipeline[0].days_since_quoted) === 21, 'the cold duplex quote sorts first');

  // ---- the budget --------------------------------------------------------------

  const budget = run('budget vs actual', ['builders.mjs', 'budget', 'JOB-101']);
  const framing = budget.find((b) => b.line === 'Framing');
  assert(framing.state === 'OVER' && n(framing.remaining) === -15400, `the framing line is 15,400 over (${framing.remaining})`);
  assert(budget.find((b) => b.line === 'Roofing').state === 'near', 'roofing is near its budget');

  const costs = run('costs by job', ['builders.mjs', 'costs', '--job=JOB-101']);
  assert(costs.length === 8, `eight costs on JOB-101 (${costs.length})`);

  const orders = run('open purchase orders', ['builders.mjs', 'orders']);
  assert(orders.length === 2, `two open (${orders.length})`);
  const po301 = orders.find((o) => o.ref === 'PO-301');
  assert(n(po301.days_open) === 34, 'PO-301 has floated 34 days');

  // ---- variations and claims ----------------------------------------------------

  const variations = run('proposed variations', ['builders.mjs', 'variations']);
  assert(variations.length === 1 && variations[0].ref === 'VAR-204' && n(variations[0].days_waiting) === 9,
    'VAR-204 has waited nine days for a written yes');
  const allVars = run('variations --all', ['builders.mjs', 'variations', '--all']);
  assert(allVars.length === 3, 'three on the record');

  const claims = run('unpaid claims', ['builders.mjs', 'claims']);
  assert(claims.length === 1 && claims[0].ref === 'PC-405', 'one unpaid claim');
  assert(claims[0].state === 'OVERDUE' && n(claims[0].days_overdue) === 10, 'ten days past due');
  const allClaims = run('claims --all', ['builders.mjs', 'claims', '--all']);
  assert(allClaims.length === 7, `seven claims on the record (${allClaims.length})`);

  // ---- subbies and the schedule ---------------------------------------------------

  const subbies = run('subbies', ['builders.mjs', 'subbies']);
  assert(subbies.length === 6, 'six subbies');
  assert(subbies[0].name === 'Brightline Electrical' && subbies[0].insurance === 'EXPIRED', 'the expired insurance sorts first');
  assert(subbies.some((s) => s.insurance === 'expiring'), 'and the expiring one is flagged');

  const subbie = run('subbie card', ['builders.mjs', 'subbie', 'Brightline']);
  assert(subbie.assignments.length === 1 && subbie.assignments[0].job_ref === 'JOB-102', 'on the Ngata job');
  assert(subbie.billed.length === 2, 'billed on two jobs');

  const schedule = run('the schedule', ['builders.mjs', 'schedule']);
  assert(schedule.length === 4, `four tasks in the window (${schedule.length})`);
  assert(schedule[0].state === 'LATE' && n(schedule[0].days_late) === 3, 'the late roof sorts first');

  // ---- profit, attention, compliance -----------------------------------------------

  const profit = run('margin by job', ['builders.mjs', 'profit']);
  assert(profit.length === 4, 'three active jobs and one complete');
  assert(profit[0].ref === 'JOB-101', 'the thinnest margin sorts first');

  const attention = run('attention', ['builders.mjs', 'attention']);
  assert(attention.length >= 11, `the attention list is loud (${attention.length})`);
  assert(attention[0].reason === 'claim_overdue', 'the overdue claim outranks everything');
  for (const reason of ['claim_overdue', 'variation_unapproved', 'insurance_expired', 'budget_over', 'retention_due', 'quote_stale', 'claim_gap', 'po_aged', 'task_late', 'job_quiet', 'insurance_expiring']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }

  const compliance = run('compliance', ['builders.mjs', 'compliance']);
  assert(compliance.length === 9, 'nine rules in the book');
  const failed = compliance.filter((r) => r.breaches.length);
  assert(failed.map((r) => r.key).sort().join(',') === 'budget_watch,claims_chased,insurance_current,lbp_restricted,retentions,variations_written,written_contract',
    `the seeded breaches are exactly the story (${failed.map((r) => r.key).join(',')})`);
  assert(!failed.some((r) => r.key === 'claims_within_contract'), 'no claim passes the ceiling: the gate makes that hard to break');

  const oneRule = run('one compliance rule', ['builders.mjs', 'compliance', 'written_contract']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1, 'the handshake renovation is the one breach');

  run('stats', ['builders.mjs', 'stats']);

  // ---- the s362F gate, end to end ------------------------------------------------

  const newJob = run('quote a new job', ['builders.mjs', 'job', 'add', 'Fenwick Sleepout',
    '--client=Angela Marsh', '--value=64000', '--type=other', '--site=7 Fenwick Place, Bellevue']);
  assert(/^JOB-\d+$/.test(newJob.ref) && newJob.status === 'quote', `the ref is minted (${newJob.ref})`);
  const jref = newJob.ref;

  const winRefused = run('winning $30k+ work with no signed contract is refused', ['builders.mjs', 'job', 'win', jref], { json: false, expectFail: true });
  assert(/362F/.test(winRefused.stderr) && /no force flag/.test(winRefused.stderr), 'and the refusal cites the Act');

  const won = run('with the signed date it becomes active', ['builders.mjs', 'job', 'win', jref, `--signed=${todayIso}`]);
  assert(won.status === 'active', 'active from today');

  run('build the budget', ['builders.mjs', 'budget', 'add', jref, '--code=01', '--name=Build', '--budget=52000']);

  // ---- the claim ceiling gate ---------------------------------------------------

  const overClaim = run('a claim past the contract is refused', ['builders.mjs', 'claim', jref, '--amount=70000'], { json: false, expectFail: true });
  assert(/ceiling/.test(overClaim.stderr) && /no force flag/.test(overClaim.stderr), 'the ceiling holds');

  const newVar = run('propose the variation instead', ['builders.mjs', 'variation', 'add', jref,
    '--description=Add a bathroom to the sleepout', '--price=18000', '--cost=13500']);
  assert(newVar.status === 'proposed', 'proposed, not yet claimable');
  const vref = newVar.ref;

  const stillRefused = run('a proposed variation does not raise the ceiling', ['builders.mjs', 'claim', jref, '--amount=70000'], { json: false, expectFail: true });
  assert(/unapproved/.test(stillRefused.stderr), 'and the refusal points at it');

  const approveNoBy = run('approving without naming who said yes is refused', ['builders.mjs', 'variation', 'approve', vref], { json: false, expectFail: true });
  assert(/--by/.test(approveNoBy.stderr), 'the written yes gets a name');

  run('approve it in writing', ['builders.mjs', 'variation', 'approve', vref, '--by=Angela Marsh (email)']);

  const claim = run('now the claim fits under contract + approved variation', ['builders.mjs', 'claim', jref, '--amount=70000', '--terms=20']);
  assert(/^PC-\d+$/.test(claim.ref) && claim.status === 'served', `served (${claim.ref})`);
  assert(String(claim.due_on).slice(0, 10) === addDays(todayIso, 20), 'due 20 days out by default');

  const ceilingAgain = run('the next claim still respects the new ceiling', ['builders.mjs', 'claim', jref, '--amount=15000'], { json: false, expectFail: true });
  assert(/ceiling/.test(ceilingAgain.stderr), '70,000 + 15,000 would pass 82,000');

  const paid = run('the money lands', ['builders.mjs', 'paid', claim.ref]);
  assert(paid.status === 'paid' && n(paid.amount_paid) === 70000, 'paid in full');

  const paidTwice = run('paying a paid claim is refused', ['builders.mjs', 'paid', claim.ref], { json: false, expectFail: true });
  assert(/was paid/.test(paidTwice.stderr), 'no double entries');

  // ---- costs and purchase orders ---------------------------------------------------

  const costOnQuote = run('a cost on an unwon quote is refused', ['builders.mjs', 'cost', 'JOB-104', '--line=01', '--amount=500'], { json: false, expectFail: true });
  assert(/not won/.test(costOnQuote.stderr), 'costs land on won jobs');

  run('a cost lands on the line', ['builders.mjs', 'cost', jref, '--line=Build', '--amount=30000', '--supplier=Placemakers', '--invoice=PM-1101']);
  const overCost = run('the line going over is loud', ['builders.mjs', 'cost', jref, '--line=Build', '--amount=25000', '--supplier=ITM'], { json: false });
  assert(/OVER by/.test(overCost.stdout), 'and says by how much');

  const po = run('po create commits money', ['builders.mjs', 'po', 'create', jref, '--line=Build', '--supplier=ITM Tauranga', '--amount=4000']);
  assert(/^PO-\d+$/.test(po.ref), `the ref is minted (${po.ref})`);
  run('po bill turns it into a cost', ['builders.mjs', 'po', 'bill', po.ref, '--invoice=ITM-8871']);
  const budgetAfter = run('the line carries all of it', ['builders.mjs', 'budget', jref]);
  assert(n(budgetAfter[0].actual) === 59000 && n(budgetAfter[0].committed) === 0, `59,000 actual, nothing committed (${budgetAfter[0].actual})`);

  // ---- the insurance and LBP gates ---------------------------------------------------

  const uninsured = run('an expired subbie cannot be assigned', ['builders.mjs', 'assign', 'Brightline', `--job=${jref}`, '--scope=Power to the sleepout'], { json: false, expectFail: true });
  assert(/expired/.test(uninsured.stderr) && /no force flag/.test(uninsured.stderr), 'and the refusal explains the risk');

  run('the renewal certificate lands', ['builders.mjs', 'insurance', 'Brightline Electrical', `--expires=${addDays(todayIso, 365)}`]);
  run('now they can be assigned', ['builders.mjs', 'assign', 'Brightline Electrical', `--job=${jref}`, '--scope=Power to the sleepout', '--price=3800']);

  const noLbp = run('restricted work without an LBP is refused', ['builders.mjs', 'assign', 'Tauranga Frame & Truss', `--job=${jref}`, '--scope=Structural framing', '--restricted'], { json: false, expectFail: true });
  assert(/Licensed Building Practitioner/.test(noLbp.stderr), 'and the refusal cites the Act');

  run('record the LBP number', ['builders.mjs', 'lbp', 'Tauranga Frame & Truss', '--number=BP 130001']);
  const rbw = run('now the restricted assignment lands', ['builders.mjs', 'assign', 'Tauranga Frame & Truss', `--job=${jref}`, '--scope=Structural framing', '--restricted']);
  assert(rbw.restricted_work === true, 'flagged as restricted building work');

  // ---- the schedule and the completion gate ---------------------------------------

  run('task add', ['builders.mjs', 'task', 'add', jref, 'Frame and close in', `--starts=${todayIso}`, `--ends=${addDays(todayIso, 5)}`, '--subbie=Tauranga Frame & Truss']);
  run('task done', ['builders.mjs', 'task', 'done', jref, 'Frame and close in']);

  const looseEnds = run('completing a job with loose ends is refused', ['builders.mjs', 'job', 'complete', 'JOB-101'], { json: false, expectFail: true });
  assert(/PC-405/.test(looseEnds.stderr) && /VAR-204/.test(looseEnds.stderr) && /PO-301/.test(looseEnds.stderr),
    'and it names every one of them');

  const done = run('the sleepout completes clean', ['builders.mjs', 'job', 'complete', jref]);
  assert(done.status === 'complete', 'handover');

  // ---- the diary --------------------------------------------------------------------

  run('log against a job', ['builders.mjs', 'log', 'JOB-101', 'Council inspector booked for Thursday. Linings hold until then.']);
  run('log against a claim', ['builders.mjs', 'log', 'PC-405', 'Second call to Sarah: payment promised Friday. Next step is the formal reminder letter.']);
  run('log against a subbie', ['builders.mjs', 'log', 'Pacific Plumbing', 'Liam confirmed the renewal is with the broker, certificate due this week.']);

  // ---- import ------------------------------------------------------------------

  const clientsCsv = path.join(dataDir, 'clients.csv');
  const jobsCsv = path.join(dataDir, 'jobs.csv');
  const costsCsv = path.join(dataDir, 'costs.csv');
  writeFileSync(clientsCsv, [
    'Name,Contact,Email,Phone',
    '"Karaka Ridge Developments","Sue Parker",sue@karakaridge.example.nz,021 555 0301',
    '"Angela Marsh","Angela Marsh",angela.marsh@example.nz,027 555 0106',
  ].join('\n'));
  writeFileSync(jobsCsv, [
    'Job,Client,Site,Type,Status,Contract Value,Quote Date,Start Date,ID',
    '"Karaka Ridge Showhome","Karaka Ridge Developments","1 Karaka Ridge Drive","New Build",In Progress,450000,' + addDays(todayIso, -200) + ',' + addDays(todayIso, -150) + ',BX-J-901',
    '"Karaka Ridge Lot 4","Karaka Ridge Developments","4 Karaka Ridge Drive","New Build",Pending,485000,' + addDays(todayIso, -10) + ',,BX-J-902',
  ].join('\n'));
  writeFileSync(costsCsv, [
    'Job,Category,Supplier,Invoice,Amount,Date,ID',
    '"Karaka Ridge Showhome",Framing,"Tauranga Frame & Truss",FT-2300,58000,' + addDays(todayIso, -100) + ',BX-C-801',
    '"Karaka Ridge Showhome",Roofing,"Harbour City Roofing",HR-1200,31000,' + addDays(todayIso, -60) + ',BX-C-802',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['builders.mjs', 'import', 'buildxact', `--clients=${clientsCsv}`, `--jobs=${jobsCsv}`, `--costs=${costsCsv}`, '--dry-run']);
  assert(n(dry.clients) === 1 && n(dry.clients_updated) === 1, 'the dry run counts what it would do');
  assert(n(dry.unsigned_30k) === 1, 'and flags the active import with no contract signed date');

  const imported = run('import for real', ['builders.mjs', 'import', 'buildxact', `--clients=${clientsCsv}`, `--jobs=${jobsCsv}`, `--costs=${costsCsv}`]);
  assert(n(imported.clients) === 1 && n(imported.jobs) === 2 && n(imported.costs) === 2, 'and the real run does it');
  assert(n(imported.unbudgeted_lines) === 2, 'the costs came across, the estimates did not: two lines with no budget');

  const karaka = run('the imported job reads back', ['builders.mjs', 'job', 'Karaka Ridge Showhome']);
  assert(karaka.job.status === 'active' && n(karaka.job.costs_actual) === 89000, 'active with its costs');
  assert(karaka.job.contract_signed_on === null, 'and the import is the first audit: no signed contract date');

  const contractRule = run('compliance now names the imported job too', ['builders.mjs', 'compliance', 'written_contract']);
  assert(contractRule[0].breaches.length === 2, `two handshake jobs on the record (${contractRule[0].breaches.length})`);

  const missingFile = run('a missing import file fails loudly', ['builders.mjs', 'import', 'csv', `--clients=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No clients file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export --------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['builders.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.jobs.length === n(dump.counts.jobs), 'the counts match the file');

  // ---- the branded HTML -----------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]builders-board\.html/.test(views.stdout) && /views[\\/]money\.html/.test(views.stdout), 'both views rendered');
  const boardHtml = readFileSync(path.join(root, 'views', 'builders-board.html'), 'utf8');
  assert(boardHtml.includes('Needs a decision') && boardHtml.includes('pipeline'), 'the board has its sections');
  const moneyHtml = readFileSync(path.join(root, 'views', 'money.html'), 'utf8');
  assert(moneyHtml.includes('Margin by job') && moneyHtml.includes('Progress claims'), 'the money page has its sections');

  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/progress-claim/.test(docsOut.stdout), 'the progress claims rendered');
  assert(/variation-letter/.test(docsOut.stdout), 'the variation letters rendered');
  assert(/job-cost-report/.test(docsOut.stdout), 'the job cost reports rendered');

  // ---- the human readable side ------------------------------------------------------

  run('clients (text)', ['builders.mjs', 'clients'], { json: false });
  run('client (text)', ['builders.mjs', 'client', 'Ngata'], { json: false });
  run('jobs (text)', ['builders.mjs', 'jobs', '--all'], { json: false });
  run('job (text)', ['builders.mjs', 'job', 'JOB-101'], { json: false });
  run('pipeline (text)', ['builders.mjs', 'pipeline'], { json: false });
  run('budget (text)', ['builders.mjs', 'budget', 'JOB-101'], { json: false });
  run('costs (text)', ['builders.mjs', 'costs'], { json: false });
  run('orders (text)', ['builders.mjs', 'orders', '--all'], { json: false });
  run('variations (text)', ['builders.mjs', 'variations', '--all'], { json: false });
  run('claims (text)', ['builders.mjs', 'claims', '--all'], { json: false });
  run('subbies (text)', ['builders.mjs', 'subbies'], { json: false });
  run('subbie (text)', ['builders.mjs', 'subbie', 'Harbour City'], { json: false });
  run('schedule (text)', ['builders.mjs', 'schedule', '--all'], { json: false });
  run('profit (text)', ['builders.mjs', 'profit'], { json: false });
  run('attention (text)', ['builders.mjs', 'attention'], { json: false });
  run('compliance (text)', ['builders.mjs', 'compliance'], { json: false });
  run('stats (text)', ['builders.mjs', 'stats'], { json: false });
  run('help', ['builders.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['builders.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
