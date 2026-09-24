-- Demo data for builders-for-claude-code.
-- Harbourline Builds Ltd, a fictional Tauranga residential builder: six
-- clients, six jobs (one complete, three active, two quoted), real budget
-- lines with purchase orders and costs against them, variations, progress
-- claims, six subbies and a working schedule.
--
-- Deliberately messy, so the attention list has something to say:
--   a progress claim for $88,000 served and now 10 days past its due date
--   a $12,600 variation proposed 9 days ago and still not approved in writing
--   an electrician with expired public liability insurance on an active job
--   the framing line on the Donovan build $15,400 over budget
--   $13,800 of retention still held 75 days after handover
--   a $1.24m duplex quote sitting 21 days with no decision and no follow-up
--   an extension with no progress claim in 38 days and a site diary quiet for 18
--   a purchase order open 34 days, a roofing task 3 days late
--   a plumber's insurance expiring in 21 days
--   a $118,000 renovation with no signed contract date on record (won on a handshake)
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Clients, jobs, suppliers and events are DEMO VALUES for a fictional
-- business. No real person, company, site or contract is depicted.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Clients ------------------------------------------------------------------------

insert into clients (id, name, contact_name, email, phone, address, status) values
  (seed_uuid('client:donovan'), 'Sarah and Mike Donovan',  'Sarah Donovan', 'sarah@donovanfamily.example.nz',  '027 555 0101', '14 Levers Road, Matua, Tauranga',        'active'),
  (seed_uuid('client:bayview'), 'Bayview Property Trust',  'Grant Hoyle',   'grant@bayviewtrust.example.nz',   '021 555 0102', 'PO Box 1180, Tauranga',                  'active'),
  (seed_uuid('client:ngata'),   'Kate Ngata',              'Kate Ngata',    'kate.ngata@example.nz',           '027 555 0103', '8 Pillans Road, Otumoetai, Tauranga',    'active'),
  (seed_uuid('client:shaw'),    'Tom and Priya Shaw',      'Priya Shaw',    'priya@shawhousehold.example.nz',  '021 555 0104', '31 Oceanbeach Road, Mount Maunganui',    'active'),
  (seed_uuid('client:redwood'), 'Redwood Lane Ltd',        'Marcus Bell',   'marcus@redwoodlane.example.nz',   '021 555 0105', '2 Redwood Lane, Bethlehem, Tauranga',    'active'),
  (seed_uuid('client:marsh'),   'Angela Marsh',            'Angela Marsh',  'angela.marsh@example.nz',         '027 555 0106', '55 Grange Road, Otumoetai, Tauranga',    'active')
on conflict do nothing;

-- Jobs ---------------------------------------------------------------------------
-- JOB-102 has no contract_signed_on: won on a handshake before this system,
-- and at $118,000 that is a Building Act s362F problem the compliance check
-- surfaces. The two quotes: the Bayview duplex has gone 21 days cold.

insert into jobs (id, ref, client_id, name, site_address, job_type, status, quoted_on, contract_value, contract_signed_on, retention_pct, started_on, completed_on) values
  (seed_uuid('job:100'), 'JOB-100', seed_uuid('client:redwood'), 'Redwood Lane Townhouse',   '2 Redwood Lane, Bethlehem',            'new_build',  'complete', current_date - 300, 690000,  current_date - 290, 2,  current_date - 280, current_date - 75),
  (seed_uuid('job:101'), 'JOB-101', seed_uuid('client:donovan'), 'Donovan New Build',        '14 Levers Road, Matua',                'new_build',  'active',   current_date - 150, 845000,  current_date - 140, 0,  current_date - 120, null),
  (seed_uuid('job:102'), 'JOB-102', seed_uuid('client:ngata'),   'Ngata Kitchen Renovation', '8 Pillans Road, Otumoetai',            'renovation', 'active',   current_date - 60,  118000,  null,               0,  current_date - 40,  null),
  (seed_uuid('job:103'), 'JOB-103', seed_uuid('client:shaw'),    'Shaw Extension',           '31 Oceanbeach Road, Mount Maunganui',  'extension',  'active',   current_date - 100, 246000,  current_date - 90,  0,  current_date - 70,  null),
  (seed_uuid('job:104'), 'JOB-104', seed_uuid('client:bayview'), 'Bayview Duplex',           '118 Maranui Street, Mount Maunganui',  'new_build',  'quote',    current_date - 21,  1240000, null,               0,  null,               null),
  (seed_uuid('job:105'), 'JOB-105', seed_uuid('client:marsh'),   'Marsh Bathroom',           '55 Grange Road, Otumoetai',            'renovation', 'quote',    current_date - 5,   38500,   null,               0,  null,               null)
on conflict do nothing;

-- Budget lines ---------------------------------------------------------------------------
-- The Donovan framing line is the loud one: $89,400 spent plus a $22,000 open
-- purchase order against a $96,000 budget.

insert into budget_lines (id, job_id, cost_code, name, budget) values
  (seed_uuid('bl:101-01'), seed_uuid('job:101'), '01', 'Preliminaries',    42000),
  (seed_uuid('bl:101-02'), seed_uuid('job:101'), '02', 'Foundations',      78000),
  (seed_uuid('bl:101-03'), seed_uuid('job:101'), '03', 'Framing',          96000),
  (seed_uuid('bl:101-04'), seed_uuid('job:101'), '04', 'Roofing',          54000),
  (seed_uuid('bl:101-05'), seed_uuid('job:101'), '05', 'Plumbing',         48000),
  (seed_uuid('bl:101-06'), seed_uuid('job:101'), '06', 'Electrical',       52000),
  (seed_uuid('bl:101-07'), seed_uuid('job:101'), '07', 'Interior fit-out', 121000),
  (seed_uuid('bl:101-08'), seed_uuid('job:101'), '08', 'Landscaping',      35000),
  (seed_uuid('bl:102-01'), seed_uuid('job:102'), '01', 'Demolition',       6500),
  (seed_uuid('bl:102-02'), seed_uuid('job:102'), '02', 'Joinery',          38000),
  (seed_uuid('bl:102-03'), seed_uuid('job:102'), '03', 'Plumbing',         12500),
  (seed_uuid('bl:102-04'), seed_uuid('job:102'), '04', 'Electrical',       9800),
  (seed_uuid('bl:103-01'), seed_uuid('job:103'), '01', 'Preliminaries',    9500),
  (seed_uuid('bl:103-02'), seed_uuid('job:103'), '02', 'Foundations',      28000),
  (seed_uuid('bl:103-03'), seed_uuid('job:103'), '03', 'Framing',          46000),
  (seed_uuid('bl:103-04'), seed_uuid('job:103'), '04', 'Roofing',          22000),
  (seed_uuid('bl:103-05'), seed_uuid('job:103'), '05', 'Interior fit-out', 58000)
on conflict do nothing;

-- Purchase orders ---------------------------------------------------------------------------
-- PO-301 is the aged one: open 34 days on the framing line that is already over.

insert into purchase_orders (id, ref, job_id, budget_line_id, supplier, amount, issued_on, status, billed_on) values
  (seed_uuid('po:301'), 'PO-301', seed_uuid('job:101'), seed_uuid('bl:101-03'), 'Carters Tauranga',    22000, current_date - 34, 'open',   null),
  (seed_uuid('po:302'), 'PO-302', seed_uuid('job:101'), seed_uuid('bl:101-07'), 'Kitchen Studio BOP',  18500, current_date - 6,  'open',   null),
  (seed_uuid('po:303'), 'PO-303', seed_uuid('job:101'), seed_uuid('bl:101-04'), 'Roofing Supplies BOP', 12400, current_date - 70, 'billed', current_date - 58)
on conflict do nothing;

-- Costs ---------------------------------------------------------------------------
-- Every cost on a job and a budget line. The framing line carries the damage.

insert into costs (id, job_id, budget_line_id, purchase_order_id, incurred_on, supplier, invoice_ref, amount) values
  (seed_uuid('cost:101-1'), seed_uuid('job:101'), seed_uuid('bl:101-01'), null,                 current_date - 115, 'Harbourline Builds',     'INT-0071',  18600),
  (seed_uuid('cost:101-2'), seed_uuid('job:101'), seed_uuid('bl:101-02'), null,                 current_date - 110, 'BOP Concrete',           'CN-1180',   41200),
  (seed_uuid('cost:101-3'), seed_uuid('job:101'), seed_uuid('bl:101-02'), null,                 current_date - 95,  'BOP Concrete',           'CN-1244',   35000),
  (seed_uuid('cost:101-4'), seed_uuid('job:101'), seed_uuid('bl:101-03'), null,                 current_date - 80,  'Tauranga Frame & Truss', 'FT-2210',   64400),
  (seed_uuid('cost:101-5'), seed_uuid('job:101'), seed_uuid('bl:101-03'), null,                 current_date - 45,  'Carters Tauranga',       'CA-99310',  25000),
  (seed_uuid('cost:101-6'), seed_uuid('job:101'), seed_uuid('bl:101-04'), seed_uuid('po:303'),  current_date - 58,  'Harbour City Roofing',   'HR-1188',   51800),
  (seed_uuid('cost:101-7'), seed_uuid('job:101'), seed_uuid('bl:101-05'), null,                 current_date - 55,  'Pacific Plumbing',       'PP-4471',   21500),
  (seed_uuid('cost:101-8'), seed_uuid('job:101'), seed_uuid('bl:101-06'), null,                 current_date - 50,  'Brightline Electrical',  'BE-3302',   19800),
  (seed_uuid('cost:102-1'), seed_uuid('job:102'), seed_uuid('bl:102-01'), null,                 current_date - 35,  'Bay Demolition',         'BD-808',    5900),
  (seed_uuid('cost:102-2'), seed_uuid('job:102'), seed_uuid('bl:102-02'), null,                 current_date - 25,  'Kitchen Studio BOP',     'KS-882',    19000),
  (seed_uuid('cost:102-3'), seed_uuid('job:102'), seed_uuid('bl:102-04'), null,                 current_date - 18,  'Brightline Electrical',  'BE-3319',   4200),
  (seed_uuid('cost:103-1'), seed_uuid('job:103'), seed_uuid('bl:103-02'), null,                 current_date - 50,  'BOP Concrete',           'CN-1290',   27400),
  (seed_uuid('cost:103-2'), seed_uuid('job:103'), seed_uuid('bl:103-03'), null,                 current_date - 38,  'Tauranga Frame & Truss', 'FT-2266',   31200)
on conflict do nothing;

-- Variations ---------------------------------------------------------------------------
-- VAR-204 is the loud one: proposed 9 days ago, the deck is being talked
-- about on site, and nobody has approved it in writing.

insert into variations (id, ref, job_id, description, price, cost_estimate, proposed_on, status, decided_on, approved_by) values
  (seed_uuid('var:201'), 'VAR-201', seed_uuid('job:101'), 'Ensuite layout change and tile upgrade',   18400, 12900, current_date - 35, 'approved', current_date - 30, 'Sarah Donovan (email)'),
  (seed_uuid('var:202'), 'VAR-202', seed_uuid('job:101'), 'Skylight over the stair void',             6200,  4800,  current_date - 28, 'declined', current_date - 26, null),
  (seed_uuid('var:204'), 'VAR-204', seed_uuid('job:101'), 'Extend rear deck and add louvre roof',     12600, 9100,  current_date - 9,  'proposed', null,              null)
on conflict do nothing;

-- Progress claims ---------------------------------------------------------------------------
-- PC-405 is the loud one: $88,000 served and 10 days past its due date.
-- JOB-100's two claims each held back 2% retention; the job handed over 75
-- days ago and the $13,800 is still sitting there.

insert into progress_claims (id, ref, job_id, claimed_on, amount, retention_held, due_on, status, paid_on, amount_paid) values
  (seed_uuid('pc:401'), 'PC-401', seed_uuid('job:100'), current_date - 250, 345000, 6900, current_date - 235, 'paid',   current_date - 233, 338100),
  (seed_uuid('pc:402'), 'PC-402', seed_uuid('job:100'), current_date - 110, 345000, 6900, current_date - 95,  'paid',   current_date - 92,  338100),
  (seed_uuid('pc:403'), 'PC-403', seed_uuid('job:101'), current_date - 100, 126750, 0,    current_date - 83,  'paid',   current_date - 81,  126750),
  (seed_uuid('pc:404'), 'PC-404', seed_uuid('job:101'), current_date - 65,  118300, 0,    current_date - 48,  'paid',   current_date - 46,  118300),
  (seed_uuid('pc:405'), 'PC-405', seed_uuid('job:101'), current_date - 24,  88000,  0,    current_date - 10,  'served', null,               0),
  (seed_uuid('pc:406'), 'PC-406', seed_uuid('job:102'), current_date - 20,  47200,  0,    current_date - 6,   'paid',   current_date - 4,   47200),
  (seed_uuid('pc:407'), 'PC-407', seed_uuid('job:103'), current_date - 38,  61500,  0,    current_date - 24,  'paid',   current_date - 21,  61500)
on conflict do nothing;

-- Subbies ---------------------------------------------------------------------------
-- Brightline's public liability expired 15 days ago and they are mid-rewire
-- on the Ngata job. Pacific Plumbing's expires in 21 days.

insert into subbies (id, name, trade, contact_name, email, phone, liability_expires_on, lbp_number, status) values
  (seed_uuid('sub:brightline'), 'Brightline Electrical',    'electrical', 'Dean Carey',   'dean@brightline.example.nz',    '027 555 0201', current_date - 15,  null,        'active'),
  (seed_uuid('sub:framets'),    'Tauranga Frame & Truss',   'framing',    'Rob Tainui',   'rob@framets.example.nz',        '021 555 0202', current_date + 200, null,        'active'),
  (seed_uuid('sub:pacific'),    'Pacific Plumbing',         'plumbing',   'Liam Foster',  'liam@pacificplumb.example.nz',  '027 555 0203', current_date + 21,  null,        'active'),
  (seed_uuid('sub:harbour'),    'Harbour City Roofing',     'roofing',    'Mere Kingi',   'mere@harbourroof.example.nz',   '021 555 0204', current_date + 160, 'BP 118824', 'active'),
  (seed_uuid('sub:southern'),   'Southern Cross Drainage',  'drainage',   'Pete Aldous',  'pete@sxdrainage.example.nz',    '027 555 0205', current_date + 300, null,        'active'),
  (seed_uuid('sub:mount'),      'Mount Painters',           'painting',   'Ana Solomona', 'ana@mountpainters.example.nz',  '021 555 0206', current_date + 90,  null,        'active')
on conflict do nothing;

-- Job assignments ---------------------------------------------------------------------------
-- The Shaw structural framing is restricted building work and Frame & Truss
-- have no LBP number on record: the compliance check names it.

insert into job_subbies (id, job_id, subbie_id, scope, agreed_price, restricted_work, assigned_on) values
  (seed_uuid('js:101-pacific'), seed_uuid('job:101'), seed_uuid('sub:pacific'),    'Plumbing first and second fix', 48000, false, current_date - 60),
  (seed_uuid('js:101-harbour'), seed_uuid('job:101'), seed_uuid('sub:harbour'),    'Roof cladding',                 54000, true,  current_date - 65),
  (seed_uuid('js:101-mount'),   seed_uuid('job:101'), seed_uuid('sub:mount'),      'Interior painting',             28000, false, current_date - 20),
  (seed_uuid('js:102-bright'),  seed_uuid('job:102'), seed_uuid('sub:brightline'), 'Kitchen rewire',                9800,  false, current_date - 30),
  (seed_uuid('js:103-framets'), seed_uuid('job:103'), seed_uuid('sub:framets'),    'Structural framing',            46000, true,  current_date - 55)
on conflict do nothing;

-- Tasks ---------------------------------------------------------------------------
-- The Donovan roof cladding should have finished three days ago.

insert into tasks (id, job_id, name, trade, subbie_id, starts_on, ends_on, status, done_on) values
  (seed_uuid('task:pour'),     seed_uuid('job:101'), 'Foundations pour',          'concrete', null,                       current_date - 110, current_date - 105, 'done',    current_date - 105),
  (seed_uuid('task:roof'),     seed_uuid('job:101'), 'Roof cladding complete',    'roofing',  seed_uuid('sub:harbour'),   current_date - 12,  current_date - 3,   'planned', null),
  (seed_uuid('task:linings'),  seed_uuid('job:101'), 'Interior linings',          'interior', null,                       current_date - 1,   current_date + 10,  'planned', null),
  (seed_uuid('task:joinery'),  seed_uuid('job:102'), 'Joinery install',           'joinery',  null,                       current_date + 2,   current_date + 6,   'planned', null),
  (seed_uuid('task:preline'),  seed_uuid('job:103'), 'Pre-line inspection',       'framing',  seed_uuid('sub:framets'),   current_date + 4,   current_date + 4,   'planned', null)
on conflict do nothing;

-- The site diary ---------------------------------------------------------------------------
-- JOB-103's last entry is 18 days old: quiet enough to surface by itself.

insert into notes (id, job_id, noted_on, note) values
  (seed_uuid('note:101-1'), seed_uuid('job:101'), current_date - 9, 'Donovans asked on site about extending the rear deck with a louvre roof. Priced as VAR-204 and sent same day. No deck work until it is approved in writing.'),
  (seed_uuid('note:101-2'), seed_uuid('job:101'), current_date - 5, 'Rang Sarah about PC-405: accounts person on leave, promised payment by Friday. Diarised to chase Monday if it does not land.'),
  (seed_uuid('note:101-3'), seed_uuid('job:101'), current_date - 2, 'Wind delay on the roof: Harbour City back Monday to finish the cladding. Linings crew told to start on the garage end.'),
  (seed_uuid('note:102-1'), seed_uuid('job:102'), current_date - 3, 'Joinery measured and confirmed for install next week. Kate picking handles this weekend.'),
  (seed_uuid('note:103-1'), seed_uuid('job:103'), current_date - 18, 'Frame stood and straightened. Pre-line inspection to be booked once the roof is on.'),
  (seed_uuid('note:104-1'), seed_uuid('job:104'), current_date - 21, 'Duplex quote emailed to Grant with the fixed-price schedule and a 30-day validity.')
on conflict do nothing;

insert into notes (id, subbie_id, noted_on, note) values
  (seed_uuid('note:bright-1'), seed_uuid('sub:brightline'), current_date - 12, 'Asked Dean for the renewed public liability certificate. Broker is "onto it". Nothing received yet.')
on conflict do nothing;
