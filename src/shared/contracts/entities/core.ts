import { f, type EntityDescriptor } from '../fields.js'

const RELATIONSHIPS = [
  'partner', 'spouse', 'child', 'parent', 'sibling', 'grandparent', 'grandchild',
  'friend', 'neighbour', 'colleague', 'tradesperson', 'professional', 'supplier',
  'landlord', 'carer', 'other'
]

export const coreEntities: EntityDescriptor[] = [
  {
    type: 'person',
    table: 'people',
    label: 'Person',
    plural: 'People',
    module: '',
    icon: 'person',
    titleField: 'display_name',
    dateField: 'birthday',
    searchFields: ['display_name', 'full_name', 'email', 'phone', 'address', 'notes', 'relationship'],
    defaultOrder: 'display_name COLLATE NOCASE ASC',
    emptyState: 'People and organisations you deal with — family, friends, your plumber, your insurer.',
    fields: [
      f.text('display_name', 'Name', { required: true, inList: true, span: 2 }),
      f.select('kind', 'Type', [
        { value: 'person', label: 'Person' },
        { value: 'organisation', label: 'Organisation' }
      ], { inList: true, defaultValue: 'person' }),
      f.text('relationship', 'Relationship', { inList: true }),
      f.text('full_name', 'Full name'),
      f.text('email', 'Email', { type: 'email' }),
      f.text('phone', 'Phone', { type: 'phone' }),
      f.longtext('address', 'Address'),
      f.url('website', 'Website'),
      f.bool('household_member', 'Lives in this household', { help: 'Household members appear in chores, meals and shared costs.' }),
      f.date('birthday', 'Birthday', { group: 'Dates' }),
      f.bool('birthday_year_known', 'Year of birth is known', { group: 'Dates', defaultValue: true }),
      f.number('catch_up_days', 'Remind me to get in touch every … days', { group: 'Dates', min: 1, max: 3650 }),
      f.date('last_contact_on', 'Last in touch', { group: 'Dates' }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'note',
    table: 'notes',
    label: 'Note',
    plural: 'Notes',
    module: '',
    icon: 'note',
    titleField: 'title',
    dateField: 'updated_at',
    searchFields: ['title', 'body'],
    defaultOrder: 'pinned DESC, updated_at DESC',
    emptyState: 'Jot anything down. Notes can stand alone or hang off any record.',
    fields: [
      f.text('title', 'Title', { span: 2, inList: true }),
      f.longtext('body', 'Note'),
      f.bool('pinned', 'Pin to Today', { inList: true })
    ]
  },
  {
    type: 'document',
    table: 'documents',
    label: 'Document',
    plural: 'Documents',
    module: '',
    icon: 'document',
    titleField: 'title',
    dateField: 'expires_on',
    searchFields: ['title', 'reference', 'notes', 'doc_type'],
    defaultOrder: "COALESCE(expires_on, '9999') ASC, title COLLATE NOCASE ASC",
    emptyState: 'Passports, policies, certificates, manuals, statements — anything worth keeping and finding again.',
    fields: [
      f.text('title', 'Title', { required: true, span: 2, inList: true }),
      f.select('doc_type', 'Type', [
        'passport', 'driving-licence', 'birth-certificate', 'marriage-certificate', 'policy',
        'certificate', 'statement', 'receipt', 'warranty', 'contract', 'manual', 'payslip',
        'tax', 'medical', 'education', 'identity', 'vehicle', 'property', 'will', 'other'
      ], { inList: true, defaultValue: 'other' }),
      f.text('reference', 'Reference number'),
      f.ref('person_id', 'Belongs to', 'person'),
      f.ref('issuer_person_id', 'Issued by', 'person'),
      f.date('issued_on', 'Issued', { group: 'Dates' }),
      f.date('expires_on', 'Expires', { group: 'Dates', inList: true }),
      f.number('renewal_reminder_days', 'Remind me this many days before it expires', { group: 'Dates', defaultValue: 60, min: 0, max: 730 }),
      f.bool('emergency_pack', 'Include in the emergency pack', { group: 'Dates', help: 'The handful of documents you would need in a hurry.' }),
      f.bool('sensitive', 'Extra sensitive', { help: 'Hidden from list previews and never included in an export unless you say so.' }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'policy',
    table: 'policies',
    label: 'Insurance policy',
    plural: 'Insurance',
    module: '',
    icon: 'shield',
    titleField: 'name',
    dateField: 'ends_on',
    searchFields: ['name', 'policy_number', 'cover_summary', 'notes'],
    defaultOrder: "COALESCE(ends_on, '9999') ASC",
    emptyState: 'Home, car, travel, pet, gadget — every policy with its dates, excess and paperwork.',
    costRollup: [{ table: 'claims', foreignKey: 'policy_id', amountColumn: 'amount_settled_minor', currencyColumn: 'currency', dateColumn: 'opened_on' }],
    fields: [
      f.text('name', 'Policy name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', [
        'home-buildings', 'home-contents', 'motor', 'travel', 'pet', 'health', 'dental',
        'life', 'income-protection', 'gadget', 'breakdown', 'warranty', 'other'
      ], { inList: true, defaultValue: 'other' }),
      f.ref('provider_person_id', 'Insurer', 'person', { refFilter: { kind: 'organisation' }, inList: true }),
      f.text('policy_number', 'Policy number'),
      f.date('starts_on', 'Starts', { group: 'Dates' }),
      f.date('ends_on', 'Ends', { group: 'Dates', inList: true }),
      f.bool('auto_renews', 'Renews automatically', { group: 'Dates', defaultValue: true }),
      f.number('notice_days', 'Notice period (days)', { group: 'Dates', min: 0, max: 365 }),
      f.money('premium_minor', 'Premium', 'currency', { group: 'Money', inList: true }),
      f.select('premium_period', 'Paid', ['monthly', 'quarterly', 'annual', 'one-off'], { group: 'Money', defaultValue: 'annual' }),
      f.money('excess_minor', 'Excess', 'currency', { group: 'Money' }),
      f.money('cover_limit_minor', 'Cover limit', 'currency', { group: 'Money' }),
      f.ref('bill_id', 'Paid via', 'bill', { group: 'Money' }),
      f.ref('document_id', 'Policy document', 'document'),
      f.longtext('cover_summary', 'What it covers', { help: 'In your own words. Orbit does not read your policy and decide what you are covered for.' }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'claim',
    table: 'claims',
    label: 'Insurance claim',
    plural: 'Claims',
    module: '',
    icon: 'claim',
    titleField: 'title',
    dateField: 'opened_on',
    searchFields: ['title', 'reference', 'notes'],
    defaultOrder: 'opened_on DESC',
    fields: [
      f.text('title', 'What happened', { required: true, span: 2, inList: true }),
      f.ref('policy_id', 'Policy', 'policy', { inList: true }),
      f.text('reference', 'Claim reference'),
      f.select('status', 'Status', [
        { value: 'open', label: 'Open', tone: 'info' },
        { value: 'submitted', label: 'Submitted', tone: 'info' },
        { value: 'assessing', label: 'Being assessed', tone: 'warn' },
        { value: 'settled', label: 'Settled', tone: 'good' },
        { value: 'rejected', label: 'Rejected', tone: 'bad' },
        { value: 'withdrawn', label: 'Withdrawn', tone: 'neutral' }
      ], { inList: true, defaultValue: 'open' }),
      f.date('opened_on', 'Opened', { required: true, group: 'Dates', inList: true }),
      f.date('closed_on', 'Closed', { group: 'Dates' }),
      f.money('amount_claimed_minor', 'Amount claimed', 'currency', { group: 'Money' }),
      f.money('amount_settled_minor', 'Amount settled', 'currency', { group: 'Money', inList: true }),
      f.money('excess_paid_minor', 'Excess paid', 'currency', { group: 'Money' }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'correspondence',
    table: 'correspondence',
    label: 'Correspondence',
    plural: 'Correspondence',
    module: '',
    icon: 'mail',
    titleField: 'subject',
    dateField: 'on_date',
    searchFields: ['subject', 'summary', 'reference'],
    defaultOrder: 'on_date DESC',
    emptyState: 'Log a complaint, a chase-up or a reply, with the date they promised to come back to you.',
    fields: [
      f.text('subject', 'Subject', { required: true, span: 2, inList: true }),
      f.select('direction', 'Direction', [
        { value: 'sent', label: 'I sent it' },
        { value: 'received', label: 'They sent it' }
      ], { required: true, inList: true, defaultValue: 'sent' }),
      f.ref('person_id', 'Who with', 'person', { inList: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.select('channel', 'How', ['email', 'letter', 'phone', 'chat', 'in-person', 'portal', 'social'], { defaultValue: 'email' }),
      f.text('reference', 'Their reference'),
      f.date('response_due_by', 'They said they would reply by', { group: 'Chasing', inList: true }),
      f.date('escalation_date', 'Escalate on', { group: 'Chasing' }),
      f.date('resolved_on', 'Resolved', { group: 'Chasing' }),
      f.longtext('summary', 'What was said')
    ]
  },
  {
    type: 'tracker',
    table: 'trackers',
    label: 'Tracker',
    plural: 'Trackers',
    module: '',
    icon: 'tracker',
    titleField: 'name',
    searchFields: ['name', 'description'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    emptyState: 'Build your own tracker for anything Orbit does not already cover.',
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.longtext('description', 'What is it for'),
      f.text('entry_label', 'Each entry is called', { defaultValue: 'Entry' }),
      f.text('icon', 'Icon'),
      f.bool('active', 'Active', { defaultValue: true, inList: true })
    ]
  }
]
