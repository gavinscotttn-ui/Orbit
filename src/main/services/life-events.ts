import { addDays, addMonthsClamped, type CalendarDate } from '@shared/domain/time.js'
import type { OrbitDatabase } from '../db/database.js'
import type { Repository } from '../db/repository.js'
import { newId } from '@shared/domain/ids.js'

/**
 * Life-event templates.
 *
 * Moving house, having a baby, changing jobs — the sort of thing where the
 * hard part is not doing any one task but remembering the forty of them, in
 * roughly the right order, spread over three months.
 *
 * Every template is a proposal. The user sees exactly what would be created,
 * unticks anything that does not apply to them, and only then does anything get
 * written. Offsets are relative to a start date the user picks, so "cancel the
 * broadband" lands two weeks before the move rather than on some fixed date.
 */

export interface TemplateTask {
  /** Stable key so the user's selection survives editing the start date. */
  key: string
  title: string
  /** Days relative to the anchor. Negative is before. */
  offsetDays: number
  notes?: string
  priority?: number
  effort?: 'quick' | 'short' | 'deep'
  group: string
}

export interface TemplateDocument {
  key: string
  title: string
  docType: string
  group: string
  notes?: string
}

export interface TemplateBudgetLine {
  key: string
  label: string
  group: string
  note: string
}

export interface LifeEventTemplate {
  key: string
  title: string
  blurb: string
  /** What the anchor date means for this template, in plain words. */
  anchorLabel: string
  icon: string
  tasks: TemplateTask[]
  documents: TemplateDocument[]
  budgetLines: TemplateBudgetLine[]
}

const t = (key: string, title: string, offsetDays: number, group: string, extra: Partial<TemplateTask> = {}): TemplateTask => ({
  key,
  title,
  offsetDays,
  group,
  ...extra
})

export const LIFE_EVENT_TEMPLATES: LifeEventTemplate[] = [
  {
    key: 'moving-house',
    title: 'Moving house',
    blurb: 'The eight weeks before and the two weeks after, with every account that needs telling.',
    anchorLabel: 'Moving day',
    icon: 'home',
    tasks: [
      t('mh-survey', 'Book a survey', -56, 'Before'),
      t('mh-solicitor', 'Instruct a solicitor or conveyancer', -56, 'Before'),
      t('mh-removals', 'Get three removal quotes', -42, 'Before', { notes: 'Add each one as a quote so you can compare what is included.' }),
      t('mh-declutter', 'Declutter before you pay to move it', -35, 'Before', { effort: 'deep' }),
      t('mh-book-removals', 'Book the removal firm', -28, 'Before', { priority: 3 }),
      t('mh-schools', 'Tell the school and arrange transfers', -28, 'Before'),
      t('mh-broadband', 'Arrange broadband at the new address', -21, 'Utilities', { notes: 'Installation slots go quickly.', priority: 3 }),
      t('mh-post', 'Set up mail redirection', -21, 'Admin', { effort: 'quick' }),
      t('mh-insurance', 'Arrange buildings and contents insurance from the completion date', -21, 'Admin', { priority: 4 }),
      t('mh-councilTax', 'Tell the council you are moving', -14, 'Utilities'),
      t('mh-utilities', 'Give notice to gas, electricity and water', -14, 'Utilities'),
      t('mh-packing', 'Start packing room by room, labelling boxes', -14, 'Before', { effort: 'deep' }),
      t('mh-bank', 'Update your address with the bank and cards', -7, 'Admin'),
      t('mh-dvla', 'Update the address on your driving licence and vehicle records', -7, 'Admin'),
      t('mh-gp', 'Register with a new GP and dentist', -7, 'Admin'),
      t('mh-meterOld', 'Photograph the meter readings at the old place', 0, 'Moving day', { priority: 4, effort: 'quick' }),
      t('mh-keys', 'Collect the keys', 0, 'Moving day', { priority: 4 }),
      t('mh-meterNew', 'Photograph the meter readings at the new place', 0, 'Moving day', { priority: 4, effort: 'quick' }),
      t('mh-locks', 'Change the locks', 1, 'After', { priority: 3 }),
      t('mh-alarms', 'Test the smoke and carbon monoxide alarms', 1, 'After', { effort: 'quick' }),
      t('mh-boiler', 'Find the stopcock, fuse box and boiler manual', 2, 'After'),
      t('mh-deposit', 'Chase the deposit or final bills from the old address', 14, 'After')
    ],
    documents: [
      { key: 'mh-doc-contract', title: 'Contract and completion statement', docType: 'contract', group: 'Legal' },
      { key: 'mh-doc-survey', title: 'Survey report', docType: 'certificate', group: 'Legal' },
      { key: 'mh-doc-epc', title: 'Energy performance certificate', docType: 'certificate', group: 'Property' },
      { key: 'mh-doc-inventory', title: 'Inventory or schedule of condition', docType: 'other', group: 'Property' }
    ],
    budgetLines: [
      { key: 'mh-b-removals', label: 'Removals', group: 'Moving', note: 'Quotes vary enormously; get three.' },
      { key: 'mh-b-legal', label: 'Legal fees and searches', group: 'Moving', note: '' },
      { key: 'mh-b-deposit', label: 'Deposit or stamp duty', group: 'Moving', note: '' },
      { key: 'mh-b-setup', label: 'Setting up the new place', group: 'Moving', note: 'Curtains, white goods and the things nobody budgets for.' }
    ]
  },
  {
    key: 'having-a-baby',
    title: 'Having a baby',
    blurb: 'From the first scan to registering the birth, with the leave and money admin nobody warns you about.',
    anchorLabel: 'Due date',
    icon: 'baby',
    tasks: [
      t('hb-midwife', 'Book the first midwife appointment', -230, 'Pregnancy', { priority: 3 }),
      t('hb-employer', 'Tell your employer and confirm maternity or paternity leave', -180, 'Work', { priority: 3 }),
      t('hb-mat1', 'Get the MATB1 certificate from the midwife', -150, 'Work'),
      t('hb-benefits', 'Check what you are entitled to', -140, 'Money'),
      t('hb-budget', 'Work out the income change during leave', -140, 'Money', { effort: 'deep' }),
      t('hb-classes', 'Book antenatal classes', -120, 'Pregnancy'),
      t('hb-childcare', 'Join childcare waiting lists', -120, 'Practical', { notes: 'Good nurseries fill up a year ahead.' }),
      t('hb-carseat', 'Buy and fit a car seat', -60, 'Practical', { priority: 3 }),
      t('hb-bag', 'Pack the hospital bag', -35, 'Practical'),
      t('hb-plan', 'Write the birth plan', -30, 'Pregnancy'),
      t('hb-freezer', 'Batch cook and fill the freezer', -21, 'Practical'),
      t('hb-register', 'Register the birth', 28, 'Admin', { priority: 4, notes: 'There is a legal deadline for this.' }),
      t('hb-childBenefit', 'Claim child benefit', 30, 'Money', { priority: 3 }),
      t('hb-jabs', 'Book the first vaccinations', 56, 'Health'),
      t('hb-will', 'Update your will and any life cover', 90, 'Admin')
    ],
    documents: [
      { key: 'hb-doc-matb1', title: 'MATB1 certificate', docType: 'medical', group: 'Health' },
      { key: 'hb-doc-notes', title: 'Maternity notes', docType: 'medical', group: 'Health' },
      { key: 'hb-doc-birth', title: 'Birth certificate', docType: 'birth-certificate', group: 'Identity' },
      { key: 'hb-doc-redbook', title: 'Personal child health record', docType: 'medical', group: 'Health' }
    ],
    budgetLines: [
      { key: 'hb-b-kit', label: 'Pram, cot and car seat', group: 'Baby', note: '' },
      { key: 'hb-b-income', label: 'Income drop during leave', group: 'Baby', note: 'The one that actually matters.' },
      { key: 'hb-b-childcare', label: 'Childcare from return to work', group: 'Baby', note: '' }
    ]
  },
  {
    key: 'changing-jobs',
    title: 'Changing jobs',
    blurb: 'Leaving well, starting well, and not losing a pension along the way.',
    anchorLabel: 'First day in the new job',
    icon: 'briefcase',
    tasks: [
      t('cj-resign', 'Hand in your notice in writing', -28, 'Leaving', { priority: 4 }),
      t('cj-handover', 'Write a handover document', -21, 'Leaving', { effort: 'deep' }),
      t('cj-holiday', 'Check your untaken holiday and whether it is paid', -21, 'Money'),
      t('cj-pension', 'Get your old pension details before you lose access', -14, 'Money', { priority: 3, notes: 'Far harder to obtain once your email is closed.' }),
      t('cj-references', 'Confirm references and keep contact details', -14, 'Leaving'),
      t('cj-payslips', 'Download your last payslips and P60s', -7, 'Money', { priority: 3 }),
      t('cj-return', 'Return the laptop, pass and anything else', -1, 'Leaving'),
      t('cj-p45', 'Chase the P45', 7, 'Money'),
      t('cj-payroll', 'Check the first payslip is right', 35, 'Money', { priority: 3, notes: 'Emergency tax codes are common on a first payslip.' }),
      t('cj-benefits', 'Enrol in the new pension and any benefits', 14, 'New job'),
      t('cj-probation', 'Diarise the end of probation', 180, 'New job')
    ],
    documents: [
      { key: 'cj-doc-offer', title: 'Offer letter and contract', docType: 'contract', group: 'New job' },
      { key: 'cj-doc-p45', title: 'P45 from the old employer', docType: 'tax', group: 'Money' },
      { key: 'cj-doc-pension', title: 'Old pension statement', docType: 'statement', group: 'Money' }
    ],
    budgetLines: [
      { key: 'cj-b-gap', label: 'Gap between final and first pay', group: 'Work', note: 'Often five or six weeks.' },
      { key: 'cj-b-commute', label: 'New commuting cost', group: 'Work', note: '' }
    ]
  },
  {
    key: 'buying-a-vehicle',
    title: 'Buying a vehicle',
    blurb: 'Checks before you hand over money, and the paperwork afterwards.',
    anchorLabel: 'Collection day',
    icon: 'car',
    tasks: [
      t('bv-budget', 'Set a total budget including running costs', -30, 'Before', { effort: 'deep' }),
      t('bv-history', 'Run a history check', -14, 'Before', { priority: 4 }),
      t('bv-service', 'Check the service history and any outstanding recalls', -14, 'Before', { priority: 3 }),
      t('bv-inspection', 'Arrange an independent inspection', -10, 'Before'),
      t('bv-insurance', 'Arrange insurance from the collection date', -3, 'Admin', { priority: 4, notes: 'You cannot legally drive it away without this.' }),
      t('bv-tax', 'Tax the vehicle', 0, 'Admin', { priority: 4 }),
      t('bv-collect', 'Collect and check everything matches the advert', 0, 'Collection'),
      t('bv-keeper', 'Confirm the change of keeper has gone through', 7, 'Admin'),
      t('bv-service-book', 'Set up the servicing schedule in Orbit', 7, 'Admin'),
      t('bv-breakdown', 'Sort breakdown cover', 14, 'Admin')
    ],
    documents: [
      { key: 'bv-doc-v5', title: 'Registration document', docType: 'vehicle', group: 'Vehicle' },
      { key: 'bv-doc-receipt', title: 'Purchase receipt', docType: 'receipt', group: 'Vehicle' },
      { key: 'bv-doc-mot', title: 'Latest roadworthiness certificate', docType: 'vehicle', group: 'Vehicle' },
      { key: 'bv-doc-service', title: 'Service history', docType: 'vehicle', group: 'Vehicle' }
    ],
    budgetLines: [
      { key: 'bv-b-price', label: 'Purchase price', group: 'Vehicle', note: '' },
      { key: 'bv-b-insurance', label: 'Insurance', group: 'Vehicle', note: '' },
      { key: 'bv-b-running', label: 'Fuel, tax and servicing', group: 'Vehicle', note: 'The part people forget.' }
    ]
  },
  {
    key: 'getting-married',
    title: 'Getting married',
    blurb: 'The legal bits, the money bits, and the name-change admin afterwards.',
    anchorLabel: 'The wedding day',
    icon: 'rings',
    tasks: [
      t('gm-notice', 'Give notice at the register office', -120, 'Legal', { priority: 4 }),
      t('gm-venue', 'Confirm the venue and celebrant', -300, 'Planning'),
      t('gm-budget', 'Agree a budget and who is paying for what', -300, 'Money', { effort: 'deep' }),
      t('gm-insurance', 'Consider wedding insurance', -270, 'Money'),
      t('gm-guests', 'Finalise the guest list and send invitations', -150, 'Planning'),
      t('gm-rings', 'Order the rings', -90, 'Planning'),
      t('gm-final', 'Confirm final numbers with the caterer', -14, 'Planning', { priority: 3 }),
      t('gm-certificate', 'Collect the marriage certificate', 7, 'Legal', { priority: 3 }),
      t('gm-names', 'Change the name on passport, licence and bank', 21, 'Admin', { notes: 'Passport first — others often want to see it.' }),
      t('gm-will', 'Update wills and any beneficiary nominations', 60, 'Admin', { notes: 'Marriage can revoke an existing will.' })
    ],
    documents: [
      { key: 'gm-doc-cert', title: 'Marriage certificate', docType: 'marriage-certificate', group: 'Legal' },
      { key: 'gm-doc-venue', title: 'Venue contract', docType: 'contract', group: 'Planning' },
      { key: 'gm-doc-insurance', title: 'Wedding insurance policy', docType: 'policy', group: 'Money' }
    ],
    budgetLines: [
      { key: 'gm-b-venue', label: 'Venue and catering', group: 'Wedding', note: '' },
      { key: 'gm-b-outfits', label: 'Outfits', group: 'Wedding', note: '' },
      { key: 'gm-b-photo', label: 'Photography', group: 'Wedding', note: '' },
      { key: 'gm-b-honeymoon', label: 'Honeymoon', group: 'Wedding', note: '' }
    ]
  },
  {
    key: 'starting-education',
    title: 'Starting a course',
    blurb: 'Funding, kit, and keeping on top of it once term starts.',
    anchorLabel: 'First day of term',
    icon: 'book',
    tasks: [
      t('se-funding', 'Apply for funding or a loan', -150, 'Money', { priority: 4 }),
      t('se-accommodation', 'Sort accommodation', -120, 'Practical'),
      t('se-budget', 'Build a termly budget', -60, 'Money', { effort: 'deep' }),
      t('se-kit', 'Buy the kit and reading list', -21, 'Practical'),
      t('se-register', 'Register and enrol', -7, 'Admin', { priority: 3 }),
      t('se-timetable', 'Put the timetable and deadlines in the calendar', 3, 'Admin'),
      t('se-support', 'Find out what support is available', 14, 'Practical')
    ],
    documents: [
      { key: 'se-doc-offer', title: 'Offer letter', docType: 'education', group: 'Course' },
      { key: 'se-doc-funding', title: 'Funding confirmation', docType: 'education', group: 'Money' },
      { key: 'se-doc-timetable', title: 'Timetable', docType: 'education', group: 'Course' }
    ],
    budgetLines: [
      { key: 'se-b-fees', label: 'Fees', group: 'Education', note: '' },
      { key: 'se-b-living', label: 'Living costs per term', group: 'Education', note: '' },
      { key: 'se-b-books', label: 'Books and equipment', group: 'Education', note: '' }
    ]
  },
  {
    key: 'retiring',
    title: 'Retiring',
    blurb: 'Pensions, tax and the year before, in the right order.',
    anchorLabel: 'Your last working day',
    icon: 'sunset',
    tasks: [
      t('rt-forecast', 'Get a state pension forecast', -365, 'Money', { priority: 3 }),
      t('rt-trace', 'Trace every old workplace pension', -365, 'Money', { effort: 'deep', notes: 'People typically have more than they remember.' }),
      t('rt-advice', 'Take regulated financial advice', -300, 'Money', { notes: 'Orbit records what you decide. It does not advise.' }),
      t('rt-budget', 'Build a realistic retirement budget', -270, 'Money', { effort: 'deep' }),
      t('rt-options', 'Decide how to take each pension', -180, 'Money'),
      t('rt-notice', 'Give notice to your employer', -90, 'Work', { priority: 3 }),
      t('rt-tax', 'Check the tax position of the first year', -60, 'Money'),
      t('rt-benefits', 'Check any benefits and concessions', -30, 'Admin'),
      t('rt-p45', 'File the final payslip and P45', 14, 'Admin'),
      t('rt-review', 'Review the budget against reality', 180, 'Money')
    ],
    documents: [
      { key: 'rt-doc-forecast', title: 'State pension forecast', docType: 'statement', group: 'Pensions' },
      { key: 'rt-doc-statements', title: 'Workplace pension statements', docType: 'statement', group: 'Pensions' },
      { key: 'rt-doc-advice', title: 'Financial advice report', docType: 'other', group: 'Pensions' }
    ],
    budgetLines: [
      { key: 'rt-b-income', label: 'Expected income', group: 'Retirement', note: '' },
      { key: 'rt-b-spend', label: 'Essential spending', group: 'Retirement', note: '' },
      { key: 'rt-b-oneoff', label: 'One-off costs in year one', group: 'Retirement', note: '' }
    ]
  }
]

export function templateFor(key: string): LifeEventTemplate | undefined {
  return LIFE_EVENT_TEMPLATES.find((t) => t.key === key)
}

export interface LifeEventPreview {
  key: string
  title: string
  anchorLabel: string
  startDate: CalendarDate
  tasks: { key: string; title: string; date: CalendarDate; group: string; notes: string; priority: number }[]
  documents: { key: string; title: string; docType: string; group: string }[]
  budgetLines: { key: string; label: string; group: string; note: string }[]
  /** Plain summary the confirmation dialog shows before anything is written. */
  summary: string
}

export function previewLifeEventTemplate(
  key: string,
  startDate: CalendarDate,
  title?: string
): LifeEventPreview {
  const template = templateFor(key)
  if (!template) throw new Error('That template is not one Orbit knows about.')
  const tasks = template.tasks
    .map((task) => ({
      key: task.key,
      title: task.title,
      date: addDays(startDate, task.offsetDays),
      group: task.group,
      notes: task.notes ?? '',
      priority: task.priority ?? 0
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    key: template.key,
    title: title || template.title,
    anchorLabel: template.anchorLabel,
    startDate,
    tasks,
    documents: template.documents.map((d) => ({ key: d.key, title: d.title, docType: d.docType, group: d.group })),
    budgetLines: template.budgetLines,
    summary: `${tasks.length} tasks between ${tasks[0]?.date ?? startDate} and ${tasks[tasks.length - 1]?.date ?? startDate}, ${template.documents.length} document slots and ${template.budgetLines.length} budget lines.`
  }
}

export interface LifeEventResult {
  projectId: string
  planId: string
  tasksCreated: number
  documentsCreated: number
  skipped: number
}

/**
 * Write out a template.
 *
 * Everything created is linked to one project and recorded in the plan's
 * `created_refs`, so the user can see exactly what appeared and remove it in
 * one go if they change their mind.
 */
export function applyLifeEventTemplate(
  repository: Repository,
  db: OrbitDatabase,
  key: string,
  startDate: CalendarDate,
  title?: string,
  include?: string[]
): LifeEventResult {
  const template = templateFor(key)
  if (!template) throw new Error('That template is not one Orbit knows about.')
  const selected = include ? new Set(include) : null
  const wanted = (itemKey: string): boolean => (selected ? selected.has(itemKey) : true)

  const project = repository.create(
    'project',
    {
      title: title || template.title,
      kind: 'project',
      status: 'active',
      description: template.blurb,
      started_on: startDate,
      target_date: addMonthsClamped(startDate, 6, undefined),
      module: ''
    },
    { summary: `Created from the "${template.title}" template` }
  )
  if (!project.ok) throw new Error(project.errors[0]?.message ?? 'The project could not be created.')

  const createdRefs: { type: string; id: string }[] = []
  let tasksCreated = 0
  let documentsCreated = 0
  let skipped = 0

  for (const task of template.tasks) {
    if (!wanted(task.key)) {
      skipped += 1
      continue
    }
    const result = repository.create(
      'task',
      {
        title: task.title,
        notes: task.notes ?? '',
        status: 'todo',
        priority: task.priority ?? 0,
        due_date: addDays(startDate, task.offsetDays),
        project_id: project.id,
        effort: task.effort ?? '',
        module: ''
      },
      { silent: true, summary: 'From a life-event template' }
    )
    if (result.ok) {
      tasksCreated += 1
      createdRefs.push({ type: 'task', id: result.id })
    }
  }

  for (const document of template.documents) {
    if (!wanted(document.key)) {
      skipped += 1
      continue
    }
    const result = repository.create(
      'document',
      {
        title: document.title,
        doc_type: document.docType,
        notes: document.notes ?? 'Created by a life-event template — attach the real document when you have it.'
      },
      { silent: true, summary: 'From a life-event template' }
    )
    if (result.ok) {
      documentsCreated += 1
      createdRefs.push({ type: 'document', id: result.id })
      repository.link('project', project.id, 'document', result.id, 'includes')
    }
  }

  const planId = newId('lep')
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO life_event_plans (id, template_key, title, started_on, target_date, status, project_id, created_refs, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [
      planId,
      template.key,
      title || template.title,
      startDate,
      addMonthsClamped(startDate, 6, undefined),
      project.id,
      JSON.stringify(createdRefs),
      template.budgetLines.map((b) => `${b.label}: ${b.note}`).join('\n'),
      now,
      now
    ]
  )

  return { projectId: project.id, planId, tasksCreated, documentsCreated, skipped }
}
