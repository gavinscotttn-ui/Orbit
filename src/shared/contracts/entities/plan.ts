import { f, type EntityDescriptor } from '../fields.js'

export const PRIORITY_OPTIONS = [
  { value: '0', label: 'None', tone: 'neutral' as const },
  { value: '1', label: 'Low', tone: 'neutral' as const },
  { value: '2', label: 'Medium', tone: 'info' as const },
  { value: '3', label: 'High', tone: 'warn' as const },
  { value: '4', label: 'Urgent', tone: 'bad' as const }
]

export const planEntities: EntityDescriptor[] = [
  {
    type: 'task',
    table: 'tasks',
    label: 'Task',
    plural: 'Tasks',
    module: '',
    icon: 'task',
    titleField: 'title',
    dateField: 'due_date',
    searchFields: ['title', 'notes'],
    defaultOrder: "CASE status WHEN 'done' THEN 1 WHEN 'cancelled' THEN 1 ELSE 0 END ASC, COALESCE(due_date, '9999') ASC, priority DESC",
    emptyState: 'Nothing on your list. Add the thing you keep meaning to do.',
    fields: [
      f.text('title', 'Task', { required: true, span: 2, inList: true }),
      f.select('status', 'Status', [
        { value: 'todo', label: 'To do', tone: 'neutral' },
        { value: 'doing', label: 'In progress', tone: 'info' },
        { value: 'waiting', label: 'Waiting on someone', tone: 'warn' },
        { value: 'done', label: 'Done', tone: 'good' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' }
      ], { inList: true, defaultValue: 'todo' }),
      f.select('priority', 'Priority', PRIORITY_OPTIONS, { inList: true, defaultValue: 0 }),
      f.ref('project_id', 'Project', 'project', { inList: true }),
      f.date('due_date', 'Due', { group: 'When', inList: true }),
      f.time('due_time', 'Due at', { group: 'When' }),
      f.date('start_date', 'Start by', { group: 'When', help: 'When you need to begin, not when it is due.' }),
      f.number('prep_minutes', 'Preparation time (minutes)', { group: 'When', min: 0, max: 1440 }),
      f.number('travel_minutes', 'Travel time (minutes)', { group: 'When', min: 0, max: 1440 }),
      f.date('defer_until', 'Hide until', { group: 'When' }),
      f.recurrence('recurrence', 'Repeats', { group: 'When' }),
      f.number('estimate_minutes', 'Estimate (minutes)', { group: 'Effort', min: 0, max: 10000 }),
      f.select('effort', 'Effort', [
        { value: '', label: 'Not set' },
        { value: 'quick', label: 'Quick — under 10 minutes' },
        { value: 'short', label: 'Short — under an hour' },
        { value: 'deep', label: 'Deep work' }
      ], { group: 'Effort' }),
      f.select('energy', 'Energy needed', [
        { value: '', label: 'Not set' },
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' }
      ], { group: 'Effort' }),
      f.select('waiting_kind', 'Waiting for', [
        { value: '', label: 'Not waiting' },
        { value: 'reply', label: 'A reply' },
        { value: 'delivery', label: 'A delivery' },
        { value: 'refund', label: 'A refund' },
        { value: 'decision', label: 'A decision' },
        { value: 'payment', label: 'A payment' },
        { value: 'other', label: 'Something else' }
      ], { group: 'Waiting on' }),
      f.ref('waiting_person_id', 'Waiting on', 'person', { group: 'Waiting on' }),
      f.date('waiting_since', 'Waiting since', { group: 'Waiting on' }),
      f.date('waiting_expected_by', 'Expected by', { group: 'Waiting on' }),
      f.date('waiting_chased_on', 'Last chased', { group: 'Waiting on' }),
      f.ref('assignee_person_id', 'Assigned to', 'person', {
        help: 'A label so you know whose job it is. It does not give anyone access to your vault.'
      }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'project',
    table: 'projects',
    label: 'Project',
    plural: 'Projects',
    module: '',
    icon: 'project',
    titleField: 'title',
    dateField: 'target_date',
    searchFields: ['title', 'description'],
    defaultOrder: "CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'someday' THEN 2 ELSE 3 END, COALESCE(target_date, '9999') ASC",
    emptyState: 'A project is anything with more than one step. A goal is something you are working towards.',
    costRollup: [{ table: 'transactions', foreignKey: 'project_id', amountColumn: 'amount_minor', currencyColumn: 'currency', dateColumn: 'date' }],
    fields: [
      f.text('title', 'Name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', [
        { value: 'project', label: 'Project' },
        { value: 'goal', label: 'Goal' },
        { value: 'area', label: 'Ongoing area' }
      ], { inList: true, defaultValue: 'project' }),
      f.select('status', 'Status', [
        { value: 'active', label: 'Active', tone: 'good' },
        { value: 'someday', label: 'Someday', tone: 'neutral' },
        { value: 'paused', label: 'Paused', tone: 'warn' },
        { value: 'done', label: 'Done', tone: 'good' },
        { value: 'abandoned', label: 'Abandoned', tone: 'neutral' }
      ], { inList: true, defaultValue: 'active' }),
      f.date('started_on', 'Started', { group: 'Dates' }),
      f.date('target_date', 'Target', { group: 'Dates', inList: true }),
      f.money('budget_minor', 'Budget', 'currency', { group: 'Money' }),
      f.select('progress_mode', 'Progress measured by', [
        { value: 'tasks', label: 'Completed tasks' },
        { value: 'milestones', label: 'Milestones' },
        { value: 'manual', label: 'A number I set myself' }
      ], { defaultValue: 'tasks' }),
      f.number('progress_manual', 'Progress (%)', { min: 0, max: 100 }),
      f.longtext('description', 'Description')
    ]
  },
  {
    type: 'milestone',
    table: 'milestones',
    label: 'Milestone',
    plural: 'Milestones',
    module: '',
    icon: 'flag',
    titleField: 'title',
    dateField: 'target_date',
    searchFields: ['title'],
    defaultOrder: "sort_order ASC, COALESCE(target_date, '9999') ASC",
    fields: [
      f.text('title', 'Milestone', { required: true, span: 2, inList: true }),
      f.ref('project_id', 'Project', 'project', { required: true }),
      f.date('target_date', 'Target', { inList: true })
    ]
  },
  {
    type: 'event',
    table: 'events',
    label: 'Event',
    plural: 'Calendar',
    module: '',
    icon: 'calendar',
    titleField: 'title',
    dateField: 'start_date',
    searchFields: ['title', 'description', 'location'],
    defaultOrder: "start_date ASC, COALESCE(start_time, '00:00') ASC",
    emptyState: 'Appointments, all-day events, time blocks and deadlines.',
    fields: [
      f.text('title', 'Event', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', [
        'event', 'appointment', 'timeblock', 'birthday', 'anniversary', 'focus', 'travel', 'deadline'
      ], { inList: true, defaultValue: 'event' }),
      f.bool('all_day', 'All day', { inList: true }),
      f.date('start_date', 'Date', { required: true, group: 'When', inList: true }),
      f.time('start_time', 'From', { group: 'When', inList: true }),
      f.date('end_date', 'Until date', { group: 'When' }),
      f.time('end_time', 'Until', { group: 'When' }),
      f.text('timezone', 'Time zone', { group: 'When', help: 'Kept so the time stays right if you travel or the clocks change.' }),
      f.recurrence('recurrence', 'Repeats', { group: 'When' }),
      f.number('travel_minutes', 'Travel time (minutes)', { group: 'When', min: 0, max: 1440 }),
      f.number('prep_minutes', 'Preparation time (minutes)', { group: 'When', min: 0, max: 1440 }),
      f.text('location', 'Where'),
      f.bool('busy', 'Counts as busy', { defaultValue: true }),
      f.longtext('description', 'Details')
    ]
  },
  {
    type: 'reminder',
    table: 'reminders',
    label: 'Reminder',
    plural: 'Reminders',
    module: '',
    icon: 'bell',
    titleField: 'label',
    dateField: 'remind_on',
    searchFields: ['label', 'detail'],
    defaultOrder: 'remind_on ASC',
    emptyState: 'Reminders appear in Today while Orbit is running on this computer.',
    fields: [
      f.text('label', 'Remind me to', { required: true, span: 2, inList: true }),
      f.date('remind_on', 'On', { required: true, inList: true }),
      f.time('remind_time', 'At'),
      f.number('lead_days', 'Days of warning', { min: 0, max: 365 }),
      f.recurrence('recurrence', 'Repeats'),
      f.select('channel', 'How', [
        { value: 'in-app', label: 'In Orbit' },
        { value: 'os-notification', label: 'Desktop notification' }
      ], { defaultValue: 'in-app', help: 'Desktop notifications need permission on each computer.' }),
      f.select('state', 'State', ['scheduled', 'due', 'acknowledged', 'snoozed', 'cancelled'], { inList: true, defaultValue: 'scheduled' }),
      f.longtext('detail', 'Details')
    ]
  },
  {
    type: 'habit_checkin',
    table: 'habit_checkins',
    label: 'Check-in',
    plural: 'Check-ins',
    module: '',
    icon: 'check',
    titleField: 'note',
    dateField: 'on_date',
    searchFields: [],
    defaultOrder: 'on_date DESC',
    fields: [
      f.ref('habit_id', 'Habit', 'habit', { required: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.number('value', 'Times', { defaultValue: 1, min: 1, max: 50 }),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'habit',
    table: 'habits',
    label: 'Habit',
    plural: 'Habits',
    module: '',
    icon: 'repeat',
    titleField: 'title',
    searchFields: ['title', 'detail'],
    defaultOrder: 'active DESC, title COLLATE NOCASE ASC',
    emptyState: 'Small things you want to do regularly. Check them off from Today.',
    fields: [
      f.text('title', 'Habit', { required: true, span: 2, inList: true }),
      f.select('cadence', 'How often', [
        { value: 'daily', label: 'Every day' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'custom', label: 'Custom' }
      ], { inList: true, defaultValue: 'daily' }),
      f.number('target_per_period', 'Times per period', { defaultValue: 1, min: 1, max: 50 }),
      f.recurrence('recurrence', 'Custom schedule'),
      f.bool('active', 'Active', { defaultValue: true, inList: true }),
      f.longtext('detail', 'Notes')
    ]
  }
]
