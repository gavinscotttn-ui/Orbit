import { f, type EntityDescriptor } from '../fields.js'

export const moneyEntities: EntityDescriptor[] = [
  {
    type: 'account',
    table: 'accounts',
    label: 'Account',
    plural: 'Accounts',
    module: '',
    icon: 'account',
    titleField: 'name',
    searchFields: ['name', 'institution', 'notes'],
    defaultOrder: 'sort_order ASC, name COLLATE NOCASE ASC',
    emptyState: 'Add the accounts you actually use. Orbit never connects to a bank — you tell it what is there.',
    costRollup: [{ table: 'transactions', foreignKey: 'account_id', amountColumn: 'amount_minor', currencyColumn: 'currency', dateColumn: 'date' }],
    fields: [
      f.text('name', 'Account name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', [
        'current', 'savings', 'credit-card', 'loan', 'mortgage', 'cash', 'investment', 'pension', 'other'
      ], { inList: true, defaultValue: 'current' }),
      f.text('institution', 'Bank or provider', { inList: true }),
      f.text('currency', 'Currency', { required: true, defaultValue: 'GBP' }),
      f.money('opening_balance_minor', 'Opening balance', 'currency', { group: 'Balance' }),
      f.date('opening_balance_date', 'As at', { group: 'Balance' }),
      f.money('credit_limit_minor', 'Credit limit', 'currency', { group: 'Balance' }),
      f.number('interest_rate_bp', 'Interest rate (basis points)', { group: 'Balance', help: '1999 means 19.99%.' }),
      f.bool('include_in_net_worth', 'Include in net worth', { defaultValue: true }),
      f.ref('owner_person_id', 'Whose account', 'person'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'category',
    table: 'categories',
    label: 'Category',
    plural: 'Categories',
    module: '',
    icon: 'tag',
    titleField: 'name',
    searchFields: ['name'],
    defaultOrder: 'kind ASC, sort_order ASC, name COLLATE NOCASE ASC',
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Kind', ['income', 'expense', 'transfer'], { inList: true, defaultValue: 'expense' }),
      f.ref('parent_id', 'Inside', 'category'),
      f.text('colour', 'Colour')
    ]
  },
  {
    type: 'transaction',
    table: 'transactions',
    label: 'Transaction',
    plural: 'Transactions',
    module: '',
    icon: 'transaction',
    titleField: 'description',
    dateField: 'date',
    searchFields: ['description', 'payee', 'notes'],
    defaultOrder: 'date DESC, created_at DESC',
    emptyState: 'Every payment in and out. Add them by hand or import a statement.',
    fields: [
      f.text('description', 'Description', { required: true, span: 2, inList: true }),
      f.ref('account_id', 'Account', 'account', { required: true, inList: true }),
      f.date('date', 'Date', { required: true, inList: true }),
      f.money('amount_minor', 'Amount', 'currency', { required: true, inList: true, help: 'Money out is negative.' }),
      f.select('kind', 'Kind', [
        { value: 'expense', label: 'Money out', tone: 'bad' },
        { value: 'income', label: 'Money in', tone: 'good' },
        { value: 'transfer', label: 'Transfer', tone: 'neutral' }
      ], { required: true, inList: true, defaultValue: 'expense' }),
      f.select('status', 'Status', [
        { value: 'actual', label: 'Actual', tone: 'good' },
        { value: 'planned', label: 'Planned', tone: 'info' },
        { value: 'forecast', label: 'Forecast', tone: 'neutral' }
      ], { inList: true, defaultValue: 'actual', help: 'Planned and forecast amounts are never counted as real money.' }),
      f.ref('category_id', 'Category', 'category', { inList: true }),
      f.text('payee', 'Payee'),
      f.bool('cleared', 'Cleared'),
      f.ref('person_id', 'Person', 'person', { group: 'Connections' }),
      f.ref('project_id', 'Project', 'project', { group: 'Connections' }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'budget',
    table: 'budgets',
    label: 'Budget',
    plural: 'Budgets',
    module: '',
    icon: 'budget',
    titleField: 'name',
    searchFields: ['name'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    emptyState: 'Give the categories that matter a comfortable limit. Not every category needs one.',
    fields: [
      f.text('name', 'Name', { span: 2, inList: true }),
      f.ref('category_id', 'Category', 'category', { required: true, inList: true }),
      f.money('limit_minor', 'Limit', 'currency', { required: true, inList: true }),
      f.select('period', 'Per', ['weekly', 'monthly', 'annual'], { inList: true, defaultValue: 'monthly' }),
      f.bool('rollover', 'Carry unspent amounts forward'),
      f.date('starts_on', 'From', { group: 'Dates' }),
      f.date('ends_on', 'Until', { group: 'Dates' })
    ]
  },
  {
    type: 'bill',
    table: 'bills',
    label: 'Bill',
    plural: 'Bills and subscriptions',
    module: '',
    icon: 'bill',
    titleField: 'name',
    dateField: 'renewal_date',
    searchFields: ['name', 'notes', 'cancellation_reference'],
    defaultOrder: "CASE status WHEN 'active' THEN 0 ELSE 1 END, name COLLATE NOCASE ASC",
    emptyState: 'Bills, subscriptions, memberships and contracts — with their renewal and notice dates.',
    costRollup: [{ table: 'transactions', foreignKey: 'bill_id', amountColumn: 'amount_minor', currencyColumn: 'currency', dateColumn: 'date' }],
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', ['bill', 'subscription', 'contract', 'membership', 'insurance', 'loan', 'other'], {
        inList: true,
        defaultValue: 'bill'
      }),
      f.money('amount_minor', 'Amount', 'currency', { inList: true }),
      f.bool('amount_varies', 'Amount varies'),
      f.date('anchor_date', 'First due', { required: true, group: 'When' }),
      f.number('due_day', 'Day of the month', { group: 'When', min: 1, max: 31 }),
      f.recurrence('cadence', 'Repeats', { group: 'When' }),
      f.select('status', 'Status', [
        { value: 'active', label: 'Active', tone: 'good' },
        { value: 'paused', label: 'Paused', tone: 'warn' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' },
        { value: 'ended', label: 'Ended', tone: 'neutral' }
      ], { inList: true, defaultValue: 'active' }),
      f.ref('provider_person_id', 'Provider', 'person', { refFilter: { kind: 'organisation' }, inList: true }),
      f.ref('account_id', 'Paid from', 'account'),
      f.ref('category_id', 'Category', 'category'),
      f.text('payment_method', 'How it is paid'),
      f.date('trial_ends_on', 'Free trial ends', { group: 'Contract', inList: true, help: 'Orbit will remind you before you start paying.' }),
      f.date('contract_ends_on', 'Contract ends', { group: 'Contract' }),
      f.number('notice_period_days', 'Notice period (days)', { group: 'Contract', min: 0, max: 365 }),
      f.date('renewal_date', 'Renews', { group: 'Contract', inList: true }),
      f.bool('auto_renews', 'Renews automatically', { group: 'Contract', defaultValue: true }),
      f.number('reminder_lead_days', 'Warn me this many days ahead', { group: 'Contract', defaultValue: 7, min: 0, max: 365 }),
      f.date('cancelled_on', 'Cancelled on', { group: 'Cancellation' }),
      f.text('cancellation_reference', 'Cancellation reference', { group: 'Cancellation' }),
      f.number('usage_target_per_month', 'Times a month I expect to use it', {
        group: 'Value',
        min: 0,
        help: 'Used to show what each visit actually costs.'
      }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'money_agreement',
    table: 'money_agreements',
    label: 'Money agreement',
    plural: 'Lent and borrowed',
    module: '',
    icon: 'handshake',
    titleField: 'reason',
    dateField: 'due_date',
    searchFields: ['reason', 'notes'],
    defaultOrder: "CASE status WHEN 'open' THEN 0 ELSE 1 END, COALESCE(due_date, '9999') ASC",
    emptyState: 'Money you have lent to people, and money you owe them.',
    fields: [
      f.text('reason', 'What it was for', { span: 2, inList: true }),
      f.select('direction', 'Direction', [
        { value: 'lent', label: 'I lent it', tone: 'good' },
        { value: 'borrowed', label: 'I borrowed it', tone: 'warn' }
      ], { required: true, inList: true, defaultValue: 'lent' }),
      f.ref('person_id', 'Person', 'person', { required: true, inList: true }),
      f.money('amount_minor', 'Amount', 'currency', { required: true, inList: true }),
      f.date('started_on', 'On', { required: true, inList: true }),
      f.date('due_date', 'Due back', { inList: true }),
      f.select('status', 'Status', [
        { value: 'open', label: 'Outstanding', tone: 'warn' },
        { value: 'settled', label: 'Settled', tone: 'good' },
        { value: 'written-off', label: 'Written off', tone: 'neutral' }
      ], { inList: true, defaultValue: 'open' }),
      f.date('settled_on', 'Settled on'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'payroll_profile',
    table: 'payroll_profiles',
    label: 'Pay',
    plural: 'Pay and tax',
    module: '',
    icon: 'payslip',
    titleField: 'name',
    dateField: 'payday',
    searchFields: ['name', 'employer'],
    defaultOrder: 'active DESC, name COLLATE NOCASE ASC',
    emptyState:
      'Enter your salary and tax details and Orbit will estimate each payday. It is an estimate — your payslip is the authority.',
    fields: [
      f.text('name', 'Job name', { required: true, span: 2, inList: true, defaultValue: 'Main job' }),
      f.text('employer', 'Employer', { inList: true }),
      f.money('salary_minor', 'Annual salary', 'currency', { required: true, inList: true }),
      f.money('bonus_minor', 'Annual bonus', 'currency'),
      f.text('currency', 'Currency', { required: true, defaultValue: 'GBP' }),
      f.select('frequency', 'Paid', ['weekly', 'fortnightly', '4weekly', 'monthly', 'annual'], {
        inList: true,
        defaultValue: 'monthly'
      }),
      f.date('payday', 'Next payday', { required: true, inList: true }),
      f.select('region', 'Tax region', [
        { value: 'rUK', label: 'England, Wales or Northern Ireland' },
        { value: 'scotland', label: 'Scotland' }
      ], { group: 'Tax', defaultValue: 'rUK' }),
      f.text('tax_code', 'Tax code', { group: 'Tax', defaultValue: '1257L' }),
      f.select('ni_category', 'National Insurance category', ['A', 'B', 'C', 'J'], { group: 'Tax', defaultValue: 'A' }),
      f.text('tax_year', 'Tax year', { group: 'Tax', defaultValue: '2025-26' }),
      f.number('pension_rate_bp', 'Pension contribution (basis points)', {
        group: 'Pension',
        min: 0,
        max: 10000,
        help: '500 means 5%.'
      }),
      f.select('pension_type', 'Pension arrangement', [
        { value: 'none', label: 'None' },
        { value: 'relief-at-source', label: 'Relief at source' },
        { value: 'net-pay', label: 'Net pay arrangement' },
        { value: 'salary-sacrifice', label: 'Salary sacrifice' }
      ], { group: 'Pension', defaultValue: 'none' }),
      f.select('student_plan', 'Student loan', ['none', 'plan1', 'plan2', 'plan4', 'plan5'], {
        group: 'Deductions',
        defaultValue: 'none'
      }),
      f.bool('postgraduate', 'Postgraduate loan', { group: 'Deductions' }),
      f.bool('irregular', 'My income is irregular', {
        help: 'Orbit will show a range rather than a single figure.'
      }),
      f.bool('active', 'Current job', { defaultValue: true, inList: true })
    ]
  },
  {
    type: 'savings_goal',
    table: 'savings_goals',
    label: 'Savings goal',
    plural: 'Savings and pots',
    module: '',
    icon: 'piggy',
    titleField: 'name',
    dateField: 'target_date',
    searchFields: ['name', 'notes'],
    defaultOrder: "COALESCE(target_date, '9999') ASC, name COLLATE NOCASE ASC",
    emptyState: 'Pots, goals and sinking funds for the big annual bills that always arrive at a bad moment.',
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', [
        { value: 'goal', label: 'Savings goal' },
        { value: 'pot', label: 'Pot' },
        { value: 'sinking-fund', label: 'Sinking fund for an annual cost' },
        { value: 'emergency', label: 'Emergency fund' }
      ], { inList: true, defaultValue: 'goal' }),
      f.money('target_minor', 'Target', 'currency', { inList: true }),
      f.date('target_date', 'By', { inList: true }),
      f.money('annual_expense_minor', 'Annual cost it covers', 'currency', { group: 'Sinking fund' }),
      f.ref('bill_id', 'For this bill', 'bill', { group: 'Sinking fund' }),
      f.money('contribution_minor', 'Contribution', 'currency', { group: 'Contributions' }),
      f.select('contribution_period', 'Every', ['weekly', 'fortnightly', '4weekly', 'monthly', 'annual'], {
        group: 'Contributions',
        defaultValue: 'monthly'
      }),
      f.ref('account_id', 'Held in', 'account'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'holding',
    table: 'holdings',
    label: 'Investment or pension',
    plural: 'Investments and pensions',
    module: '',
    icon: 'chart',
    titleField: 'name',
    dateField: 'as_of_date',
    searchFields: ['name', 'provider', 'notes'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    emptyState: 'Balances you enter yourself. Orbit does not connect to a provider and does not value anything for you.',
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', ['pension', 'isa', 'gia', 'crypto', 'property', 'premium-bonds', 'other'], {
        inList: true,
        defaultValue: 'other'
      }),
      f.text('provider', 'Provider', { inList: true }),
      f.money('value_minor', 'Value', 'currency', { required: true, inList: true }),
      f.date('as_of_date', 'As at', { required: true, inList: true, help: 'A balance without a date is worthless.' }),
      f.money('contribution_minor', 'Contribution', 'currency', { group: 'Contributions' }),
      f.select('contribution_period', 'Every', ['weekly', 'fortnightly', '4weekly', 'monthly', 'annual', 'none'], {
        group: 'Contributions',
        defaultValue: 'monthly'
      }),
      f.number('employer_match_bp', 'Employer match (basis points)', { group: 'Contributions' }),
      f.ref('account_id', 'Linked account', 'account'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'expense_claim',
    table: 'expense_claims',
    label: 'Money owed to me',
    plural: 'Owed to me',
    module: '',
    icon: 'receipt',
    titleField: 'title',
    dateField: 'expected_by',
    searchFields: ['title', 'reference', 'notes'],
    defaultOrder: "CASE status WHEN 'received' THEN 1 ELSE 0 END, COALESCE(expected_by, '9999') ASC",
    emptyState: 'Work expenses, reimbursements, refunds and shared costs you are still waiting on.',
    fields: [
      f.text('title', 'What for', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', [
        { value: 'work-expense', label: 'Work expense' },
        { value: 'reimbursement', label: 'Reimbursement' },
        { value: 'refund', label: 'Refund' },
        { value: 'shared-cost', label: 'Shared cost' },
        { value: 'donation', label: 'Charitable donation' }
      ], { inList: true, defaultValue: 'reimbursement' }),
      f.money('amount_minor', 'Amount', 'currency', { required: true, inList: true }),
      f.ref('person_id', 'From', 'person', { inList: true }),
      f.select('status', 'Status', [
        { value: 'draft', label: 'Not submitted', tone: 'neutral' },
        { value: 'submitted', label: 'Submitted', tone: 'info' },
        { value: 'chased', label: 'Chased', tone: 'warn' },
        { value: 'partial', label: 'Partly paid', tone: 'warn' },
        { value: 'received', label: 'Received', tone: 'good' },
        { value: 'rejected', label: 'Rejected', tone: 'bad' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' }
      ], { inList: true, defaultValue: 'draft' }),
      f.date('incurred_on', 'Spent on', { group: 'Dates' }),
      f.date('submitted_on', 'Submitted', { group: 'Dates' }),
      f.date('expected_by', 'Expected by', { group: 'Dates', inList: true }),
      f.date('received_on', 'Received on', { group: 'Dates', help: 'Only fill this in when the money has actually arrived.' }),
      f.money('received_minor', 'Amount received', 'currency', { group: 'Dates' }),
      f.text('reference', 'Reference'),
      f.bool('gift_aid', 'Gift Aid claimed', { group: 'Tax' }),
      f.text('tax_year', 'Tax year', { group: 'Tax' }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'wishlist_item',
    table: 'wishlist_items',
    label: 'Wish list item',
    plural: 'Wish list',
    module: '',
    icon: 'star',
    titleField: 'title',
    dateField: 'cooling_off_until',
    searchFields: ['title', 'merchant', 'notes'],
    defaultOrder: 'priority DESC, created_at DESC',
    emptyState: 'Things you want. Add a cooling-off date and Orbit will ask again later, when the urge has passed.',
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.money('target_minor', 'Price', 'currency', { inList: true }),
      f.text('merchant', 'Where from', { inList: true }),
      f.url('url', 'Link'),
      f.date('cooling_off_until', 'Ask me again on', { inList: true }),
      f.select('decision', 'Decision', [
        { value: '', label: 'Undecided' },
        { value: 'bought', label: 'Bought it', tone: 'good' },
        { value: 'skipped', label: 'Decided against', tone: 'neutral' },
        { value: 'deferred', label: 'Put off', tone: 'neutral' }
      ], { inList: true }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'voucher',
    table: 'vouchers',
    label: 'Voucher',
    plural: 'Gift cards and vouchers',
    module: '',
    icon: 'gift-card',
    titleField: 'label',
    dateField: 'expires_on',
    searchFields: ['label', 'issuer', 'notes'],
    defaultOrder: "COALESCE(expires_on, '9999') ASC",
    emptyState: 'Gift cards, vouchers and loyalty points, so none of them quietly expire.',
    fields: [
      f.text('label', 'What', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', ['gift-card', 'voucher', 'loyalty-points', 'store-credit', 'coupon'], {
        inList: true,
        defaultValue: 'gift-card'
      }),
      f.text('issuer', 'Issued by', { inList: true }),
      f.money('balance_minor', 'Balance', 'currency', { inList: true }),
      f.number('points', 'Points'),
      f.date('expires_on', 'Expires', { inList: true }),
      f.date('used_on', 'Used on'),
      f.text('code_hint', 'Last few characters of the code', {
        help: 'A hint to recognise it by. Keep the full code in your password manager, not here.'
      }),
      f.longtext('notes', 'Notes')
    ]
  }
]
