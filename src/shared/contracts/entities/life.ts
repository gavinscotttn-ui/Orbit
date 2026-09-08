import { f, type EntityDescriptor } from '../fields.js'

/**
 * The Life modules. Each descriptor names the module it belongs to, and a user
 * who has not enabled that module never sees it — the whole catalogue at once
 * would be overwhelming and most of it irrelevant to any one person.
 */
export const lifeEntities: EntityDescriptor[] = [
  // -- Vehicles and possessions ---------------------------------------------
  {
    type: 'asset',
    table: 'assets',
    label: 'Item',
    plural: 'Things',
    module: 'home',
    icon: 'box',
    titleField: 'name',
    dateField: 'warranty_ends_on',
    searchFields: ['name', 'make', 'model', 'identifier', 'location', 'notes'],
    defaultOrder: 'asset_type ASC, name COLLATE NOCASE ASC',
    emptyState: 'Cars, appliances, tools, bikes, instruments — anything that costs money to keep.',
    costRollup: [
      { table: 'maintenance_records', foreignKey: 'asset_id', amountColumn: 'cost_minor', currencyColumn: 'currency', dateColumn: 'done_on' },
      { table: 'fuel_logs', foreignKey: 'asset_id', amountColumn: 'cost_minor', currencyColumn: 'currency', dateColumn: 'on_date' },
      { table: 'transactions', foreignKey: 'asset_id', amountColumn: 'amount_minor', currencyColumn: 'currency', dateColumn: 'date' }
    ],
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.select('asset_type', 'Type', [
        'vehicle', 'appliance', 'device', 'equipment', 'furniture', 'property',
        'instrument', 'bicycle', 'tool', 'collection-item', 'other'
      ], { required: true, inList: true, defaultValue: 'other' }),
      f.text('make', 'Make', { inList: true }),
      f.text('model', 'Model', { inList: true }),
      f.text('identifier', 'Registration or serial number', { inList: true }),
      f.date('acquired_on', 'Acquired', { group: 'Ownership' }),
      f.money('purchase_price_minor', 'Paid', 'currency', { group: 'Ownership' }),
      f.money('current_value_minor', 'Worth now', 'currency', { group: 'Ownership' }),
      f.date('value_as_of', 'Valued on', { group: 'Ownership' }),
      f.date('disposed_on', 'Sold or scrapped on', { group: 'Ownership' }),
      f.date('warranty_ends_on', 'Warranty ends', { group: 'Ownership', inList: true }),
      f.ref('owner_person_id', 'Whose', 'person', { group: 'Ownership' }),
      f.ref('room_id', 'Room', 'room'),
      f.text('location', 'Where it is kept'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'maintenance_schedule',
    table: 'maintenance_schedules',
    label: 'Service schedule',
    plural: 'Servicing',
    module: 'home',
    icon: 'spanner',
    titleField: 'title',
    dateField: 'next_due_on',
    searchFields: ['title', 'notes'],
    defaultOrder: "active DESC, COALESCE(next_due_on, '9999') ASC",
    emptyState: 'MOT, boiler service, gutter clearing, alarm testing — anything that comes round again.',
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.ref('asset_id', 'For', 'asset', { required: true, inList: true }),
      f.select('kind', 'Type', ['service', 'inspection', 'replacement', 'cleaning', 'safety-check', 'test', 'other'], {
        defaultValue: 'service'
      }),
      f.recurrence('interval_rule', 'How often', { group: 'Schedule' }),
      f.number('interval_distance', 'Or every … miles/km', { group: 'Schedule', min: 0 }),
      f.select('distance_unit', 'Distance in', [
        { value: 'mi', label: 'Miles' },
        { value: 'km', label: 'Kilometres' }
      ], { group: 'Schedule', defaultValue: 'mi' }),
      f.date('last_done_on', 'Last done', { group: 'Schedule' }),
      f.number('last_done_distance', 'At this reading', { group: 'Schedule' }),
      f.date('next_due_on', 'Next due', { group: 'Schedule', inList: true }),
      f.number('next_due_distance', 'Or at this reading', { group: 'Schedule' }),
      f.number('reminder_lead_days', 'Warn me this many days ahead', { group: 'Schedule', defaultValue: 21, min: 0, max: 365 }),
      f.bool('active', 'Active', { defaultValue: true }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'maintenance_record',
    table: 'maintenance_records',
    label: 'Service record',
    plural: 'Service history',
    module: 'home',
    icon: 'history',
    titleField: 'title',
    dateField: 'done_on',
    searchFields: ['title', 'summary'],
    defaultOrder: 'done_on DESC',
    fields: [
      f.text('title', 'What was done', { required: true, span: 2, inList: true }),
      f.ref('asset_id', 'For', 'asset', { required: true, inList: true }),
      f.date('done_on', 'Date', { required: true, inList: true }),
      f.number('distance', 'Reading'),
      f.money('cost_minor', 'Cost', 'currency', { inList: true }),
      f.ref('provider_person_id', 'Who did it', 'person'),
      f.select('outcome', 'Outcome', [
        { value: '', label: 'Not recorded' },
        { value: 'pass', label: 'Pass', tone: 'good' },
        { value: 'advisory', label: 'Pass with advisories', tone: 'warn' },
        { value: 'fail', label: 'Fail', tone: 'bad' },
        { value: 'completed', label: 'Completed', tone: 'good' }
      ], { inList: true }),
      f.longtext('summary', 'Details')
    ]
  },
  {
    type: 'odometer_reading',
    table: 'odometer_readings',
    label: 'Mileage reading',
    plural: 'Mileage',
    module: 'vehicles',
    icon: 'gauge',
    titleField: 'note',
    dateField: 'on_date',
    searchFields: ['note'],
    defaultOrder: 'on_date DESC',
    fields: [
      f.ref('asset_id', 'Vehicle', 'asset', { required: true, refFilter: { asset_type: 'vehicle' }, inList: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.number('distance', 'Reading', { required: true, inList: true }),
      f.select('unit', 'Unit', [
        { value: 'mi', label: 'Miles' },
        { value: 'km', label: 'Kilometres' }
      ], { defaultValue: 'mi' }),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'fuel_log',
    table: 'fuel_logs',
    label: 'Fuel or charge',
    plural: 'Fuel and charging',
    module: 'vehicles',
    icon: 'fuel',
    titleField: 'location',
    dateField: 'on_date',
    searchFields: ['location', 'note'],
    defaultOrder: 'on_date DESC',
    emptyState: 'Every fill-up and charge, so Orbit can tell you what a mile actually costs.',
    fields: [
      f.ref('asset_id', 'Vehicle', 'asset', { required: true, refFilter: { asset_type: 'vehicle' }, inList: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.select('kind', 'Type', [
        { value: 'fuel', label: 'Fuel' },
        { value: 'charge', label: 'Charge' }
      ], { defaultValue: 'fuel', inList: true }),
      f.number('quantity', 'Amount', { step: 0.01, inList: true }),
      f.select('unit', 'Unit', [
        { value: 'litre', label: 'Litres' },
        { value: 'gallon-uk', label: 'Gallons (UK)' },
        { value: 'gallon-us', label: 'Gallons (US)' },
        { value: 'kwh', label: 'kWh' }
      ], { defaultValue: 'litre' }),
      f.money('cost_minor', 'Cost', 'currency', { required: true, inList: true }),
      f.number('odometer', 'Mileage reading'),
      f.bool('full_tank', 'Filled it up', { defaultValue: true, help: 'Consumption is only accurate between full tanks.' }),
      f.text('location', 'Where'),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'parking_record',
    table: 'parking_records',
    label: 'Parking',
    plural: 'Parking',
    module: 'vehicles',
    icon: 'parking',
    titleField: 'location',
    dateField: 'expires_at',
    searchFields: ['location', 'reference', 'note'],
    defaultOrder: "COALESCE(expires_at, '9999') ASC",
    fields: [
      f.select('kind', 'Type', [
        { value: 'where-i-parked', label: 'Where I parked' },
        { value: 'ticket', label: 'Ticket' },
        { value: 'permit', label: 'Permit' }
      ], { required: true, inList: true, defaultValue: 'where-i-parked' }),
      f.text('location', 'Where', { span: 2, inList: true }),
      f.text('level_or_bay', 'Level or bay'),
      f.ref('asset_id', 'Vehicle', 'asset', { refFilter: { asset_type: 'vehicle' } }),
      f.date('valid_from', 'From'),
      f.text('expires_at', 'Expires', { inList: true, help: 'Date and time, e.g. 2026-03-04 14:30' }),
      f.money('cost_minor', 'Cost', 'currency'),
      f.text('reference', 'Reference'),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'room',
    table: 'rooms',
    label: 'Room',
    plural: 'Rooms',
    module: 'home',
    icon: 'room',
    titleField: 'name',
    searchFields: ['name', 'notes', 'dimensions'],
    defaultOrder: 'sort_order ASC, name COLLATE NOCASE ASC',
    fields: [
      f.text('name', 'Room', { required: true, span: 2, inList: true }),
      f.text('floor', 'Floor', { inList: true }),
      f.number('area_sqm', 'Area (m²)', { step: 0.1 }),
      f.text('dimensions', 'Dimensions'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'decor_record',
    table: 'decor_records',
    label: 'Paint and finishes',
    plural: 'Decorating',
    module: 'home',
    icon: 'brush',
    titleField: 'colour_name',
    dateField: 'purchased_on',
    searchFields: ['brand', 'colour_name', 'colour_code', 'surface', 'notes'],
    defaultOrder: 'created_at DESC',
    emptyState: 'The exact colour and finish, so touching up a scuff in three years is not guesswork.',
    fields: [
      f.ref('room_id', 'Room', 'room', { inList: true }),
      f.text('surface', 'Surface', { inList: true, placeholder: 'Walls, woodwork, ceiling' }),
      f.text('brand', 'Brand', { inList: true }),
      f.text('colour_name', 'Colour', { inList: true }),
      f.text('colour_code', 'Colour code'),
      f.text('finish', 'Finish'),
      f.text('quantity', 'How much was needed'),
      f.date('purchased_on', 'Bought'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'meter',
    table: 'meters',
    label: 'Meter',
    plural: 'Meters',
    module: 'home',
    icon: 'meter',
    titleField: 'name',
    searchFields: ['name', 'serial', 'notes'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', ['electricity', 'gas', 'water', 'oil', 'heat', 'other'], { inList: true, defaultValue: 'electricity' }),
      f.text('serial', 'Serial number'),
      f.text('unit', 'Unit', { defaultValue: 'kWh' }),
      f.ref('supplier_person_id', 'Supplier', 'person', { refFilter: { kind: 'organisation' } }),
      f.ref('bill_id', 'Bill', 'bill'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'meter_reading',
    table: 'meter_readings',
    label: 'Meter reading',
    plural: 'Meter readings',
    module: 'home',
    icon: 'gauge',
    titleField: 'note',
    dateField: 'on_date',
    searchFields: ['note'],
    defaultOrder: 'on_date DESC',
    fields: [
      f.ref('meter_id', 'Meter', 'meter', { required: true, inList: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.number('reading', 'Reading', { required: true, step: 0.001, inList: true }),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'consumable',
    table: 'consumables',
    label: 'Consumable',
    plural: 'Replaceables',
    module: 'home',
    icon: 'filter',
    titleField: 'name',
    dateField: 'next_due_on',
    searchFields: ['name', 'spec', 'supplier'],
    defaultOrder: "active DESC, COALESCE(next_due_on, '9999') ASC",
    emptyState: 'Filters, batteries, bulbs, water softener salt — the things you only remember when they run out.',
    fields: [
      f.text('name', 'What', { required: true, span: 2, inList: true }),
      f.ref('asset_id', 'For', 'asset', { inList: true }),
      f.ref('room_id', 'Room', 'room'),
      f.number('interval_days', 'Replace every … days', { required: true, defaultValue: 90, min: 1, max: 3650 }),
      f.date('last_replaced_on', 'Last replaced', { inList: true }),
      f.date('next_due_on', 'Next due', { inList: true }),
      f.money('cost_minor', 'Cost', 'currency'),
      f.text('spec', 'Specification', { help: 'Model number, size, type — whatever you need when reordering.' }),
      f.text('supplier', 'Where from'),
      f.bool('active', 'Active', { defaultValue: true })
    ]
  },
  {
    type: 'lent_item',
    table: 'lent_items',
    label: 'Lent or borrowed item',
    plural: 'Lent and borrowed',
    module: 'home',
    icon: 'handshake',
    titleField: 'item_name',
    dateField: 'due_back_on',
    searchFields: ['item_name', 'note'],
    defaultOrder: "CASE WHEN returned_on IS NULL THEN 0 ELSE 1 END, COALESCE(due_back_on, '9999') ASC",
    emptyState: 'Who has your drill, and whose ladder is in your garage.',
    fields: [
      f.text('item_name', 'What', { required: true, span: 2, inList: true }),
      f.select('direction', 'Direction', [
        { value: 'lent', label: 'I lent it out' },
        { value: 'borrowed', label: 'I borrowed it' }
      ], { required: true, inList: true, defaultValue: 'lent' }),
      f.ref('person_id', 'Who', 'person', { inList: true }),
      f.date('on_date', 'On', { required: true }),
      f.date('due_back_on', 'Back by', { inList: true }),
      f.date('returned_on', 'Returned', { inList: true }),
      f.ref('asset_id', 'Which item', 'asset'),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'storage_box',
    table: 'storage_boxes',
    label: 'Storage box',
    plural: 'Storage',
    module: 'home',
    icon: 'archive',
    titleField: 'label',
    searchFields: ['label', 'location', 'contents', 'notes'],
    defaultOrder: 'label COLLATE NOCASE ASC',
    emptyState: 'Label the boxes and write down what is in them. Future you will be grateful.',
    fields: [
      f.text('label', 'Box', { required: true, span: 2, inList: true }),
      f.text('location', 'Where', { inList: true }),
      f.ref('room_id', 'Room', 'room'),
      f.longtext('contents', 'What is in it'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'declutter_item',
    table: 'declutter_items',
    label: 'Declutter item',
    plural: 'Declutter',
    module: 'home',
    icon: 'recycle',
    titleField: 'name',
    dateField: 'on_date',
    searchFields: ['name', 'destination', 'note'],
    defaultOrder: "CASE status WHEN 'gone' THEN 1 ELSE 0 END, created_at DESC",
    fields: [
      f.text('name', 'Item', { required: true, span: 2, inList: true }),
      f.select('action', 'Plan', ['donate', 'sell', 'recycle', 'bin', 'gift', 'keep'], { inList: true, defaultValue: 'donate' }),
      f.select('status', 'Status', ['planned', 'listed', 'gone', 'kept'], { inList: true, defaultValue: 'planned' }),
      f.money('estimated_minor', 'Hoped for', 'currency'),
      f.money('actual_minor', 'Actually got', 'currency', { inList: true }),
      f.date('on_date', 'Date'),
      f.text('destination', 'Where it went'),
      f.text('note', 'Note')
    ]
  },
  // -- Purchases and consumer admin ------------------------------------------
  {
    type: 'purchase',
    table: 'purchases',
    label: 'Purchase',
    plural: 'Purchases',
    module: '',
    icon: 'bag',
    titleField: 'title',
    dateField: 'purchased_on',
    searchFields: ['title', 'merchant', 'order_reference', 'notes'],
    defaultOrder: 'purchased_on DESC',
    emptyState: 'Receipts, warranties and return deadlines, all attached to the thing you actually bought.',
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.text('merchant', 'Where from', { inList: true }),
      f.date('purchased_on', 'Bought', { required: true, inList: true }),
      f.money('total_minor', 'Total', 'currency', { inList: true }),
      f.text('order_reference', 'Order number'),
      f.text('payment_method', 'Paid by'),
      f.number('warranty_months', 'Warranty (months)', { group: 'Cover', min: 0, max: 600 }),
      f.date('warranty_ends_on', 'Warranty ends', { group: 'Cover', inList: true }),
      f.number('return_window_days', 'Return window (days)', { group: 'Cover', min: 0, max: 730 }),
      f.date('return_by', 'Return by', { group: 'Cover', inList: true }),
      f.ref('asset_id', 'Added to my things as', 'asset'),
      f.bool('is_gift', 'It was a gift'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'return',
    table: 'returns',
    label: 'Return',
    plural: 'Returns and refunds',
    module: '',
    icon: 'undo',
    titleField: 'item_name',
    dateField: 'deadline_on',
    searchFields: ['item_name', 'reason', 'reference', 'notes'],
    defaultOrder: "CASE status WHEN 'refunded' THEN 1 ELSE 0 END, COALESCE(deadline_on, '9999') ASC",
    emptyState: 'Track a return all the way to the money actually landing back in your account.',
    fields: [
      f.text('item_name', 'Item', { required: true, span: 2, inList: true }),
      f.ref('purchase_id', 'Purchase', 'purchase', { inList: true }),
      f.select('status', 'Status', [
        { value: 'planned', label: 'Planning to return', tone: 'neutral' },
        { value: 'sent', label: 'Sent back', tone: 'info' },
        { value: 'received', label: 'They have it', tone: 'info' },
        { value: 'refunded', label: 'Refunded', tone: 'good' },
        { value: 'partially-refunded', label: 'Partly refunded', tone: 'warn' },
        { value: 'rejected', label: 'Refused', tone: 'bad' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' }
      ], { inList: true, defaultValue: 'planned' }),
      f.date('opened_on', 'Started', { required: true }),
      f.date('deadline_on', 'Must be back by', { inList: true }),
      f.select('method', 'How', ['post', 'courier', 'in-store', 'collection', 'other'], { defaultValue: 'post' }),
      f.date('sent_on', 'Sent on', { group: 'Progress' }),
      f.date('received_by_merchant_on', 'They received it', { group: 'Progress' }),
      f.money('refund_expected_minor', 'Refund expected', 'currency', { group: 'Refund' }),
      f.money('refund_received_minor', 'Refund received', 'currency', { group: 'Refund', inList: true }),
      f.date('refund_received_on', 'Refund arrived', {
        group: 'Refund',
        help: 'Only when the money is actually back. Sending a parcel is not a refund.'
      }),
      f.text('reference', 'Reference'),
      f.longtext('reason', 'Why'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'parcel',
    table: 'parcels',
    label: 'Parcel',
    plural: 'Parcels',
    module: '',
    icon: 'parcel',
    titleField: 'description',
    dateField: 'expected_on',
    searchFields: ['description', 'carrier', 'tracking_number', 'notes'],
    defaultOrder: "CASE status WHEN 'delivered' THEN 1 WHEN 'collected' THEN 1 ELSE 0 END, COALESCE(expected_on, '9999') ASC",
    emptyState: 'Track parcels by hand. Orbit has no carrier integration and will not pretend otherwise.',
    fields: [
      f.text('description', 'What', { required: true, span: 2, inList: true }),
      f.select('direction', 'Direction', [
        { value: 'inbound', label: 'Coming to me' },
        { value: 'outbound', label: 'Going back' }
      ], { inList: true, defaultValue: 'inbound' }),
      f.text('carrier', 'Carrier', { inList: true }),
      f.text('tracking_number', 'Tracking number'),
      f.url('tracking_url', 'Tracking link'),
      f.select('status', 'Status', [
        { value: 'expected', label: 'Expected', tone: 'neutral' },
        { value: 'in-transit', label: 'On its way', tone: 'info' },
        { value: 'out-for-delivery', label: 'Out for delivery', tone: 'info' },
        { value: 'delivered', label: 'Delivered', tone: 'good' },
        { value: 'collected', label: 'Collected', tone: 'good' },
        { value: 'lost', label: 'Lost', tone: 'bad' },
        { value: 'returned', label: 'Returned to sender', tone: 'warn' }
      ], { inList: true, defaultValue: 'expected' }),
      f.date('dispatched_on', 'Dispatched', { group: 'Dates' }),
      f.date('expected_on', 'Expected', { group: 'Dates', inList: true }),
      f.date('delivered_on', 'Delivered', { group: 'Dates' }),
      f.ref('purchase_id', 'Purchase', 'purchase'),
      f.ref('return_id', 'Return', 'return'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'quote',
    table: 'quotes',
    label: 'Quote',
    plural: 'Quotes',
    module: '',
    icon: 'compare',
    titleField: 'subject',
    dateField: 'received_on',
    searchFields: ['subject', 'provider_name', 'notes'],
    defaultOrder: 'subject COLLATE NOCASE ASC, amount_minor ASC',
    emptyState: 'Three quotes for the same job, side by side, with what each one actually included.',
    fields: [
      f.text('subject', 'For what', { required: true, span: 2, inList: true }),
      f.text('provider_name', 'From', { inList: true }),
      f.ref('provider_person_id', 'Contact', 'person'),
      f.money('amount_minor', 'Amount', 'currency', { required: true, inList: true }),
      f.date('received_on', 'Received', { required: true, inList: true }),
      f.date('valid_until', 'Valid until', { inList: true }),
      f.bool('chosen', 'Chose this one', { inList: true }),
      f.longtext('notes', 'What it includes')
    ]
  },
  // -- Health ----------------------------------------------------------------
  {
    type: 'health_record',
    table: 'health_records',
    label: 'Health record',
    plural: 'Health',
    module: 'health',
    icon: 'heart',
    titleField: 'title',
    dateField: 'on_date',
    searchFields: ['title', 'detail', 'outcome'],
    defaultOrder: 'on_date DESC',
    emptyState: 'Appointments, check-ups and notes you write yourself. Orbit does not diagnose anything.',
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.ref('person_id', 'Who', 'person', { required: true, inList: true }),
      f.select('kind', 'Type', ['appointment', 'symptom', 'test-result', 'vaccination', 'procedure', 'check-up', 'note'], {
        required: true,
        inList: true,
        defaultValue: 'appointment'
      }),
      f.select('category', 'Area', [
        { value: '', label: 'Not set' },
        { value: 'gp', label: 'GP' },
        { value: 'dental', label: 'Dental' },
        { value: 'optical', label: 'Eyes' },
        { value: 'hospital', label: 'Hospital' },
        { value: 'physio', label: 'Physio' },
        { value: 'mental-health', label: 'Mental health' },
        { value: 'other', label: 'Other' }
      ], { inList: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.time('at_time', 'Time'),
      f.text('location', 'Where'),
      f.ref('provider_person_id', 'Who with', 'person'),
      f.date('next_due_on', 'Next one due', { inList: true }),
      f.longtext('detail', 'Details'),
      f.longtext('outcome', 'Outcome')
    ]
  },
  {
    type: 'medication',
    table: 'medications',
    label: 'Medication',
    plural: 'Medication',
    module: 'health',
    icon: 'pill',
    titleField: 'name',
    dateField: 'next_refill_on',
    searchFields: ['name', 'dose', 'instructions', 'notes'],
    defaultOrder: 'active DESC, name COLLATE NOCASE ASC',
    emptyState: 'A reminder and a refill date. Orbit never changes a dose — only you do.',
    fields: [
      f.text('name', 'Medication', { required: true, span: 2, inList: true }),
      f.ref('person_id', 'Who', 'person', { required: true, inList: true }),
      f.text('dose', 'Dose', { inList: true }),
      f.text('form', 'Form'),
      f.longtext('instructions', 'Instructions'),
      f.recurrence('schedule_rule', 'When to take it', { group: 'Schedule' }),
      f.date('started_on', 'Started', { group: 'Schedule' }),
      f.date('ends_on', 'Until', { group: 'Schedule' }),
      f.number('quantity_remaining', 'Left', { group: 'Refills' }),
      f.number('quantity_per_refill', 'Per prescription', { group: 'Refills' }),
      f.date('last_refill_on', 'Last collected', { group: 'Refills' }),
      f.date('next_refill_on', 'Order more by', { group: 'Refills', inList: true }),
      f.number('refill_reminder_days', 'Warn me this many days ahead', { group: 'Refills', defaultValue: 7, min: 0, max: 90 }),
      f.text('prescriber', 'Prescribed by'),
      f.bool('active', 'Currently taking', { defaultValue: true, inList: true }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'measurement',
    table: 'measurements',
    label: 'Measurement',
    plural: 'Measurements',
    module: 'health',
    icon: 'ruler',
    titleField: 'metric',
    dateField: 'on_date',
    searchFields: ['metric', 'note'],
    defaultOrder: 'on_date DESC',
    fields: [
      f.ref('person_id', 'Who', 'person', { required: true, inList: true }),
      f.text('metric', 'What', { required: true, inList: true, placeholder: 'Weight, blood pressure, steps, sleep' }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.number('value', 'Value', { required: true, step: 0.01, inList: true }),
      f.number('value2', 'Second value', { step: 0.01, help: 'For readings with two numbers, like blood pressure.' }),
      f.text('unit', 'Unit'),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'journal_entry',
    table: 'journal_entries',
    label: 'Journal entry',
    plural: 'Journal',
    module: 'health',
    icon: 'journal',
    titleField: 'title',
    dateField: 'on_date',
    searchFields: ['title', 'body', 'gratitude'],
    defaultOrder: 'on_date DESC',
    emptyState: 'A private place for how the day went.',
    fields: [
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.text('title', 'Title', { span: 2, inList: true }),
      f.number('mood', 'Mood (1-5)', { min: 1, max: 5, inList: true }),
      f.number('energy', 'Energy (1-5)', { min: 1, max: 5 }),
      f.longtext('body', 'How was it'),
      f.longtext('gratitude', 'Anything good'),
      f.bool('private', 'Private', { defaultValue: true })
    ]
  },
  // -- Family, pets and household --------------------------------------------
  {
    type: 'pet',
    table: 'pets',
    label: 'Pet',
    plural: 'Pets',
    module: 'pets',
    icon: 'paw',
    titleField: 'name',
    dateField: 'date_of_birth',
    searchFields: ['name', 'species', 'breed', 'microchip', 'notes'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    emptyState: 'Vaccinations, vet visits, insurance and the instructions the sitter will need.',
    costRollup: [{ table: 'pet_records', foreignKey: 'pet_id', amountColumn: 'cost_minor', currencyColumn: 'currency', dateColumn: 'on_date' }],
    fields: [
      f.text('name', 'Name', { required: true, span: 2, inList: true }),
      f.text('species', 'Species', { inList: true }),
      f.text('breed', 'Breed', { inList: true }),
      f.date('date_of_birth', 'Born'),
      f.text('sex', 'Sex'),
      f.text('colour', 'Colour'),
      f.text('microchip', 'Microchip number'),
      f.ref('vet_person_id', 'Vet', 'person'),
      f.ref('insurer_person_id', 'Insurer', 'person', { refFilter: { kind: 'organisation' } }),
      f.ref('policy_id', 'Policy', 'policy'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'pet_record',
    table: 'pet_records',
    label: 'Pet record',
    plural: 'Pet records',
    module: 'pets',
    icon: 'paw',
    titleField: 'title',
    dateField: 'on_date',
    searchFields: ['title', 'detail'],
    defaultOrder: 'on_date DESC',
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.ref('pet_id', 'Pet', 'pet', { required: true, inList: true }),
      f.select('kind', 'Type', ['vaccination', 'vet-visit', 'medication', 'grooming', 'weight', 'flea-worm', 'insurance', 'note'], {
        required: true,
        inList: true,
        defaultValue: 'vet-visit'
      }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.date('next_due_on', 'Next due', { inList: true }),
      f.money('cost_minor', 'Cost', 'currency', { inList: true }),
      f.longtext('detail', 'Details')
    ]
  },
  {
    type: 'chore',
    table: 'chores',
    label: 'Chore',
    plural: 'Chores',
    module: 'family',
    icon: 'broom',
    titleField: 'title',
    searchFields: ['title', 'detail', 'area'],
    defaultOrder: 'active DESC, title COLLATE NOCASE ASC',
    emptyState: 'Who does what, how often, and what it is worth in pocket money.',
    fields: [
      f.text('title', 'Chore', { required: true, span: 2, inList: true }),
      f.ref('assignee_person_id', 'Whose job', 'person', { inList: true }),
      f.recurrence('schedule_rule', 'How often'),
      f.date('anchor_date', 'Starting'),
      f.text('area', 'Area', { inList: true }),
      f.number('points', 'Points', { min: 0 }),
      f.money('reward_minor', 'Pocket money', 'currency', { inList: true }),
      f.bool('active', 'Active', { defaultValue: true }),
      f.longtext('detail', 'Details')
    ]
  },
  {
    type: 'school_record',
    table: 'school_records',
    label: 'School record',
    plural: 'School',
    module: 'family',
    icon: 'school',
    titleField: 'title',
    dateField: 'on_date',
    searchFields: ['title', 'school', 'notes'],
    defaultOrder: "COALESCE(on_date, due_by, '9999') ASC",
    emptyState: 'Term dates, trips, permission slips and the payments that come with them.',
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.ref('person_id', 'Child', 'person', { required: true, inList: true }),
      f.select('kind', 'Type', [
        'term-date', 'inset-day', 'event', 'trip', 'club', 'permission', 'payment', 'uniform', 'report', 'parents-evening'
      ], { required: true, inList: true, defaultValue: 'event' }),
      f.date('on_date', 'Date', { inList: true }),
      f.date('ends_on', 'Until'),
      f.date('due_by', 'Reply or pay by', { inList: true }),
      f.money('amount_minor', 'Amount', 'currency', { inList: true }),
      f.bool('done', 'Dealt with', { inList: true }),
      f.text('school', 'School'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'care_routine',
    table: 'care_routines',
    label: 'Care routine',
    plural: 'Care routines',
    module: 'family',
    icon: 'care',
    titleField: 'title',
    searchFields: ['title', 'instructions'],
    defaultOrder: 'sort_order ASC, title COLLATE NOCASE ASC',
    emptyState: 'The instructions a sitter or carer would need, written down once.',
    fields: [
      f.text('title', 'Routine', { required: true, span: 2, inList: true }),
      f.select('subject_type', 'For', [
        { value: 'pet', label: 'A pet' },
        { value: 'person', label: 'A person' },
        { value: 'home', label: 'The house' }
      ], { required: true, inList: true, defaultValue: 'pet' }),
      f.time('time_of_day', 'Time', { inList: true }),
      f.recurrence('schedule_rule', 'How often'),
      f.bool('handover', 'Include in the handover sheet', { inList: true, defaultValue: true }),
      f.longtext('instructions', 'Instructions')
    ]
  },
  {
    type: 'childcare_slot',
    table: 'childcare_slots',
    label: 'Childcare',
    plural: 'Childcare',
    module: 'family',
    icon: 'child',
    titleField: 'provider',
    dateField: 'on_date',
    searchFields: ['provider', 'note'],
    defaultOrder: 'on_date ASC',
    fields: [
      f.ref('child_person_id', 'Child', 'person', { required: true, inList: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.text('starts_at', 'From', { inList: true }),
      f.text('ends_at', 'Until'),
      f.text('provider', 'Provider', { inList: true }),
      f.ref('carer_person_id', 'Carer', 'person'),
      f.money('cost_minor', 'Cost', 'currency', { inList: true }),
      f.select('status', 'Status', ['planned', 'confirmed', 'cancelled', 'completed'], { inList: true, defaultValue: 'planned' }),
      f.text('note', 'Note')
    ]
  },
  // -- Food and shopping -----------------------------------------------------
  {
    type: 'recipe',
    table: 'recipes',
    label: 'Recipe',
    plural: 'Recipes',
    module: 'food',
    icon: 'pot',
    titleField: 'title',
    searchFields: ['title', 'ingredients', 'method', 'source'],
    defaultOrder: 'favourite DESC, title COLLATE NOCASE ASC',
    emptyState: 'The meals you actually cook, with what they cost.',
    fields: [
      f.text('title', 'Recipe', { required: true, span: 2, inList: true }),
      f.text('source', 'From'),
      f.number('servings', 'Serves', { defaultValue: 2, min: 1, max: 50, inList: true }),
      f.number('prep_minutes', 'Prep (minutes)'),
      f.number('cook_minutes', 'Cook (minutes)'),
      f.money('cost_estimate_minor', 'Rough cost', 'currency', { inList: true }),
      f.bool('favourite', 'Favourite', { inList: true }),
      f.longtext('ingredients', 'Ingredients'),
      f.longtext('method', 'Method'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'pantry_item',
    table: 'pantry_items',
    label: 'Pantry item',
    plural: 'Pantry and freezer',
    module: 'food',
    icon: 'fridge',
    titleField: 'name',
    dateField: 'expires_on',
    searchFields: ['name', 'note'],
    defaultOrder: "COALESCE(expires_on, '9999') ASC",
    emptyState: 'What is in the freezer, and what is about to go off.',
    fields: [
      f.text('name', 'Item', { required: true, span: 2, inList: true }),
      f.select('location', 'Where', ['pantry', 'fridge', 'freezer', 'cupboard', 'other'], { inList: true, defaultValue: 'pantry' }),
      f.number('quantity', 'Quantity', { defaultValue: 1, step: 0.1, inList: true }),
      f.text('unit', 'Unit'),
      f.date('expires_on', 'Use by', { inList: true }),
      f.date('opened_on', 'Opened'),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'shopping_list',
    table: 'shopping_lists',
    label: 'Shopping list',
    plural: 'Shopping lists',
    module: 'food',
    icon: 'basket',
    titleField: 'name',
    searchFields: ['name'],
    defaultOrder: 'is_template ASC, name COLLATE NOCASE ASC',
    fields: [
      f.text('name', 'List', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', ['groceries', 'household', 'diy', 'gifts', 'other'], { inList: true, defaultValue: 'groceries' }),
      f.bool('is_template', 'This is a reusable template', { inList: true })
    ]
  },
  {
    type: 'shopping_item',
    table: 'shopping_items',
    label: 'Shopping item',
    plural: 'Shopping items',
    module: 'food',
    icon: 'basket',
    titleField: 'name',
    searchFields: ['name', 'note'],
    defaultOrder: 'bought ASC, sort_order ASC, name COLLATE NOCASE ASC',
    fields: [
      f.ref('list_id', 'List', 'shopping_list', { required: true }),
      f.text('name', 'Item', { required: true, span: 2, inList: true }),
      f.number('quantity', 'Quantity', { defaultValue: 1, step: 0.1, inList: true }),
      f.text('unit', 'Unit'),
      f.text('category', 'Aisle', { inList: true }),
      f.money('estimated_minor', 'Roughly', 'currency'),
      f.bool('bought', 'Got it', { inList: true }),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'dietary_preference',
    table: 'dietary_preferences',
    label: 'Dietary need',
    plural: 'Dietary needs',
    module: 'food',
    icon: 'alert',
    titleField: 'detail',
    searchFields: ['detail', 'note'],
    defaultOrder: 'kind ASC, detail COLLATE NOCASE ASC',
    emptyState: 'Allergies and preferences for everyone in the house, so nobody has to remember.',
    fields: [
      f.ref('person_id', 'Who', 'person', { required: true, inList: true }),
      f.select('kind', 'Type', [
        { value: 'allergy', label: 'Allergy', tone: 'bad' },
        { value: 'intolerance', label: 'Intolerance', tone: 'warn' },
        { value: 'dislike', label: 'Dislike', tone: 'neutral' },
        { value: 'preference', label: 'Preference', tone: 'neutral' },
        { value: 'diet', label: 'Diet', tone: 'info' }
      ], { required: true, inList: true, defaultValue: 'preference' }),
      f.text('detail', 'What', { required: true, span: 2, inList: true }),
      f.select('severity', 'Severity', [
        { value: '', label: 'Not set' },
        { value: 'mild', label: 'Mild' },
        { value: 'moderate', label: 'Moderate' },
        { value: 'severe', label: 'Severe' }
      ], { inList: true }),
      f.text('note', 'Note')
    ]
  },
  // -- Travel ----------------------------------------------------------------
  {
    type: 'trip',
    table: 'trips',
    label: 'Trip',
    plural: 'Trips',
    module: 'travel',
    icon: 'plane',
    titleField: 'title',
    dateField: 'starts_on',
    searchFields: ['title', 'destination', 'country', 'notes'],
    defaultOrder: "COALESCE(starts_on, '9999') ASC",
    emptyState: 'Bookings, budget, packing list and preparation tasks, all in one place.',
    costRollup: [{ table: 'transactions', foreignKey: 'trip_id', amountColumn: 'amount_minor', currencyColumn: 'currency', dateColumn: 'date' }],
    fields: [
      f.text('title', 'Trip', { required: true, span: 2, inList: true }),
      f.text('destination', 'Where', { inList: true }),
      f.text('country', 'Country'),
      f.date('starts_on', 'From', { inList: true }),
      f.date('ends_on', 'Until', { inList: true }),
      f.select('purpose', 'Purpose', ['leisure', 'work', 'family', 'other'], { defaultValue: 'leisure' }),
      f.select('status', 'Status', [
        { value: 'idea', label: 'Idea', tone: 'neutral' },
        { value: 'planned', label: 'Planned', tone: 'info' },
        { value: 'booked', label: 'Booked', tone: 'good' },
        { value: 'underway', label: 'Underway', tone: 'good' },
        { value: 'complete', label: 'Been and done', tone: 'neutral' },
        { value: 'cancelled', label: 'Cancelled', tone: 'neutral' }
      ], { inList: true, defaultValue: 'idea' }),
      f.money('budget_minor', 'Budget', 'currency', { inList: true }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'trip_booking',
    table: 'trip_bookings',
    label: 'Booking',
    plural: 'Bookings',
    module: 'travel',
    icon: 'ticket',
    titleField: 'title',
    dateField: 'starts_on',
    searchFields: ['title', 'reference', 'provider', 'from_place', 'to_place', 'notes'],
    defaultOrder: "COALESCE(starts_on, '9999') ASC",
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.ref('trip_id', 'Trip', 'trip', { required: true, inList: true }),
      f.select('kind', 'Type', ['flight', 'train', 'coach', 'ferry', 'hotel', 'rental', 'car-hire', 'activity', 'transfer', 'other'], {
        inList: true,
        defaultValue: 'other'
      }),
      f.text('reference', 'Booking reference', { inList: true }),
      f.text('provider', 'Provider'),
      f.date('starts_on', 'From', { group: 'When', inList: true }),
      f.time('starts_time', 'At', { group: 'When' }),
      f.date('ends_on', 'Until', { group: 'When' }),
      f.time('ends_time', 'At', { group: 'When' }),
      f.text('timezone', 'Time zone', { group: 'When' }),
      f.text('from_place', 'From'),
      f.text('to_place', 'To'),
      f.money('cost_minor', 'Cost', 'currency', { inList: true }),
      f.select('status', 'Status', ['idea', 'held', 'booked', 'cancelled', 'used', 'refunded'], { inList: true, defaultValue: 'booked' }),
      f.ref('document_id', 'Document', 'document'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'packing_item',
    table: 'packing_items',
    label: 'Packing item',
    plural: 'Packing list',
    module: 'travel',
    icon: 'suitcase',
    titleField: 'name',
    searchFields: ['name', 'category'],
    defaultOrder: 'packed ASC, category ASC, sort_order ASC',
    fields: [
      f.ref('trip_id', 'Trip', 'trip'),
      f.text('name', 'Item', { required: true, span: 2, inList: true }),
      f.text('category', 'Category', { inList: true }),
      f.number('quantity', 'How many', { defaultValue: 1, min: 1 }),
      f.ref('person_id', 'Whose', 'person', { inList: true }),
      f.bool('packed', 'Packed', { inList: true }),
      f.bool('is_template', 'Part of my reusable list')
    ]
  },
  {
    type: 'travel_credit',
    table: 'travel_credits',
    label: 'Travel credit',
    plural: 'Travel credits',
    module: 'travel',
    icon: 'voucher',
    titleField: 'provider',
    dateField: 'expires_on',
    searchFields: ['provider', 'reference', 'notes'],
    defaultOrder: "COALESCE(expires_on, '9999') ASC",
    emptyState: 'Airline and hotel credits from cancelled trips, which expire quietly if nobody watches them.',
    fields: [
      f.text('provider', 'Provider', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', ['airline', 'hotel', 'rail', 'ferry', 'other'], { inList: true, defaultValue: 'airline' }),
      f.money('amount_minor', 'Value', 'currency', { required: true, inList: true }),
      f.text('reference', 'Reference'),
      f.date('expires_on', 'Expires', { inList: true }),
      f.date('used_on', 'Used'),
      f.ref('trip_id', 'Used on trip', 'trip'),
      f.longtext('notes', 'Notes')
    ]
  },
  // -- Work and learning -----------------------------------------------------
  {
    type: 'shift',
    table: 'shifts',
    label: 'Shift',
    plural: 'Shifts',
    module: 'work',
    icon: 'clock',
    titleField: 'employer',
    dateField: 'on_date',
    searchFields: ['employer', 'note'],
    defaultOrder: 'on_date DESC',
    emptyState: 'Your rota, with overtime, so the expected pay is not a surprise.',
    fields: [
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.text('starts_time', 'From', { inList: true }),
      f.text('ends_time', 'Until', { inList: true }),
      f.number('break_minutes', 'Break (minutes)', { min: 0, max: 480 }),
      f.text('employer', 'Employer', { inList: true }),
      f.money('rate_minor', 'Hourly rate', 'currency'),
      f.bool('overtime', 'Overtime', { inList: true }),
      f.number('multiplier_bp', 'Rate multiplier (basis points)', { defaultValue: 10000, help: '15000 means time and a half.' }),
      f.select('status', 'Status', ['scheduled', 'worked', 'cancelled', 'swapped'], { inList: true, defaultValue: 'scheduled' }),
      f.ref('person_id', 'Who', 'person'),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'leave_record',
    table: 'leave_records',
    label: 'Leave',
    plural: 'Leave',
    module: 'work',
    icon: 'beach',
    titleField: 'note',
    dateField: 'starts_on',
    searchFields: ['note'],
    defaultOrder: 'starts_on DESC',
    fields: [
      f.select('kind', 'Type', ['annual', 'sick', 'unpaid', 'parental', 'compassionate', 'toil', 'study', 'other'], {
        required: true,
        inList: true,
        defaultValue: 'annual'
      }),
      f.date('starts_on', 'From', { required: true, inList: true }),
      f.date('ends_on', 'Until', { required: true, inList: true }),
      f.number('days', 'Days', { required: true, defaultValue: 1, step: 0.5, inList: true }),
      f.select('status', 'Status', ['planned', 'requested', 'approved', 'declined', 'taken', 'cancelled'], {
        inList: true,
        defaultValue: 'planned'
      }),
      f.text('leave_year', 'Leave year'),
      f.ref('person_id', 'Who', 'person'),
      f.text('note', 'Note')
    ]
  },
  {
    type: 'qualification',
    table: 'qualifications',
    label: 'Qualification',
    plural: 'Qualifications',
    module: 'work',
    icon: 'certificate',
    titleField: 'title',
    dateField: 'expires_on',
    searchFields: ['title', 'awarding_body', 'reference', 'notes'],
    defaultOrder: "COALESCE(expires_on, '9999') ASC",
    emptyState: 'Certificates, licences and memberships, with the renewal dates that catch people out.',
    fields: [
      f.text('title', 'Qualification', { required: true, span: 2, inList: true }),
      f.text('awarding_body', 'Awarded by', { inList: true }),
      f.select('kind', 'Type', ['qualification', 'membership', 'licence', 'certification', 'registration'], {
        inList: true,
        defaultValue: 'qualification'
      }),
      f.date('obtained_on', 'Obtained'),
      f.date('expires_on', 'Expires', { inList: true }),
      f.text('reference', 'Reference'),
      f.money('renewal_cost_minor', 'Renewal cost', 'currency'),
      f.number('cpd_hours_required', 'CPD hours required', { step: 0.5 }),
      f.ref('person_id', 'Who', 'person'),
      f.ref('document_id', 'Certificate', 'document'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'course',
    table: 'courses',
    label: 'Course',
    plural: 'Learning',
    module: 'work',
    icon: 'book',
    titleField: 'title',
    dateField: 'target_end_on',
    searchFields: ['title', 'provider', 'notes'],
    defaultOrder: "COALESCE(completed_on, '0000') ASC, COALESCE(target_end_on, '9999') ASC",
    fields: [
      f.text('title', 'Course', { required: true, span: 2, inList: true }),
      f.text('provider', 'Provider', { inList: true }),
      f.date('started_on', 'Started'),
      f.date('target_end_on', 'Target finish', { inList: true }),
      f.date('completed_on', 'Finished', { inList: true }),
      f.number('progress', 'Progress (%)', { min: 0, max: 100, inList: true }),
      f.money('cost_minor', 'Cost', 'currency'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'job_application',
    table: 'job_applications',
    label: 'Job application',
    plural: 'Job applications',
    module: 'work',
    icon: 'briefcase',
    titleField: 'role',
    dateField: 'next_action_on',
    searchFields: ['role', 'company', 'notes', 'next_action'],
    defaultOrder: "COALESCE(next_action_on, '9999') ASC",
    fields: [
      f.text('role', 'Role', { required: true, span: 2, inList: true }),
      f.text('company', 'Company', { inList: true }),
      f.date('applied_on', 'Applied', { inList: true }),
      f.text('source', 'Found via'),
      f.select('status', 'Status', [
        { value: 'draft', label: 'Draft', tone: 'neutral' },
        { value: 'applied', label: 'Applied', tone: 'info' },
        { value: 'screening', label: 'Screening', tone: 'info' },
        { value: 'interview', label: 'Interview', tone: 'warn' },
        { value: 'offer', label: 'Offer', tone: 'good' },
        { value: 'accepted', label: 'Accepted', tone: 'good' },
        { value: 'rejected', label: 'Rejected', tone: 'bad' },
        { value: 'withdrawn', label: 'Withdrawn', tone: 'neutral' }
      ], { inList: true, defaultValue: 'draft' }),
      f.text('next_action', 'Next step', { inList: true }),
      f.date('next_action_on', 'By', { inList: true }),
      f.money('salary_minor', 'Salary', 'currency'),
      f.ref('contact_person_id', 'Contact', 'person'),
      f.longtext('notes', 'Notes')
    ]
  },
  // -- Relationships and memories --------------------------------------------
  {
    type: 'occasion',
    table: 'occasions',
    label: 'Occasion',
    plural: 'Occasions',
    module: 'relationships',
    icon: 'cake',
    titleField: 'title',
    dateField: 'on_date',
    searchFields: ['title', 'notes'],
    defaultOrder: 'substr(on_date, 6) ASC',
    emptyState: 'Birthdays and anniversaries, with enough warning to actually do something about them.',
    fields: [
      f.text('title', 'Occasion', { required: true, span: 2, inList: true }),
      f.ref('person_id', 'Whose', 'person', { inList: true }),
      f.select('kind', 'Type', ['birthday', 'anniversary', 'remembrance', 'other'], { inList: true, defaultValue: 'birthday' }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.bool('year_known', 'The year is right', { defaultValue: true }),
      f.number('lead_days', 'Warn me this many days ahead', { defaultValue: 14, min: 0, max: 365 }),
      f.money('budget_minor', 'Gift budget', 'currency'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'gift_idea',
    table: 'gift_ideas',
    label: 'Gift idea',
    plural: 'Gift ideas',
    module: 'relationships',
    icon: 'gift',
    titleField: 'title',
    searchFields: ['title', 'notes'],
    defaultOrder: "CASE status WHEN 'given' THEN 1 ELSE 0 END, created_at DESC",
    emptyState: 'Write it down the moment they mention it, not in December.',
    fields: [
      f.text('title', 'Idea', { required: true, span: 2, inList: true }),
      f.ref('person_id', 'For', 'person', { inList: true }),
      f.ref('occasion_id', 'Occasion', 'occasion'),
      f.money('estimated_minor', 'Roughly', 'currency', { inList: true }),
      f.url('url', 'Link'),
      f.select('status', 'Status', ['idea', 'chosen', 'bought', 'wrapped', 'given', 'rejected'], { inList: true, defaultValue: 'idea' }),
      f.date('bought_on', 'Bought'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'memory',
    table: 'memories',
    label: 'Memory',
    plural: 'Memories',
    module: 'relationships',
    icon: 'photo',
    titleField: 'title',
    dateField: 'on_date',
    searchFields: ['title', 'body', 'place'],
    defaultOrder: 'on_date DESC',
    emptyState: 'The small things worth remembering.',
    fields: [
      f.text('title', 'What happened', { required: true, span: 2, inList: true }),
      f.date('on_date', 'When', { required: true, inList: true }),
      f.text('place', 'Where', { inList: true }),
      f.longtext('body', 'The story')
    ]
  },
  {
    type: 'bucket_list_item',
    table: 'bucket_list',
    label: 'Bucket list item',
    plural: 'Bucket list',
    module: 'goals',
    icon: 'mountain',
    titleField: 'title',
    searchFields: ['title', 'category', 'notes'],
    defaultOrder: "CASE status WHEN 'done' THEN 1 ELSE 0 END, target_year ASC",
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.text('category', 'Category', { inList: true }),
      f.number('target_year', 'By year', { min: 1900, max: 2200, inList: true }),
      f.select('status', 'Status', ['someday', 'planned', 'doing', 'done', 'abandoned'], { inList: true, defaultValue: 'someday' }),
      f.money('cost_estimate_minor', 'Roughly', 'currency'),
      f.date('done_on', 'Done on'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'reading_list_item',
    table: 'reading_list',
    label: 'Reading list item',
    plural: 'Reading list',
    module: 'goals',
    icon: 'book',
    titleField: 'title',
    searchFields: ['title', 'author', 'notes'],
    defaultOrder: "CASE status WHEN 'reading' THEN 0 WHEN 'want' THEN 1 ELSE 2 END, title COLLATE NOCASE ASC",
    fields: [
      f.text('title', 'Title', { required: true, span: 2, inList: true }),
      f.text('author', 'Author', { inList: true }),
      f.select('kind', 'Type', ['book', 'article', 'paper', 'course', 'podcast', 'other'], { defaultValue: 'book' }),
      f.select('status', 'Status', ['want', 'reading', 'finished', 'abandoned'], { inList: true, defaultValue: 'want' }),
      f.date('started_on', 'Started'),
      f.date('finished_on', 'Finished', { inList: true }),
      f.number('rating', 'Rating (1-5)', { min: 1, max: 5, inList: true }),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'collection',
    table: 'collections',
    label: 'Collection',
    plural: 'Collections',
    module: 'goals',
    icon: 'grid',
    titleField: 'name',
    searchFields: ['name', 'description'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    fields: [
      f.text('name', 'Collection', { required: true, span: 2, inList: true }),
      f.text('kind', 'Type', { inList: true }),
      f.longtext('description', 'Description')
    ]
  },
  {
    type: 'collection_item',
    table: 'collection_items',
    label: 'Collection item',
    plural: 'Collection items',
    module: 'goals',
    icon: 'grid',
    titleField: 'name',
    dateField: 'acquired_on',
    searchFields: ['name', 'identifier', 'notes', 'location'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    fields: [
      f.ref('collection_id', 'Collection', 'collection', { required: true, inList: true }),
      f.text('name', 'Item', { required: true, span: 2, inList: true }),
      f.text('identifier', 'Reference'),
      f.date('acquired_on', 'Acquired', { inList: true }),
      f.money('cost_minor', 'Paid', 'currency'),
      f.money('value_minor', 'Worth', 'currency', { inList: true }),
      f.text('condition', 'Condition', { inList: true }),
      f.text('location', 'Where'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'volunteer_shift',
    table: 'volunteer_shifts',
    label: 'Volunteering',
    plural: 'Volunteering',
    module: 'goals',
    icon: 'hands',
    titleField: 'title',
    dateField: 'on_date',
    searchFields: ['title', 'note'],
    defaultOrder: 'on_date DESC',
    fields: [
      f.text('title', 'What', { required: true, span: 2, inList: true }),
      f.ref('organisation_person_id', 'Organisation', 'person', { refFilter: { kind: 'organisation' }, inList: true }),
      f.date('on_date', 'Date', { required: true, inList: true }),
      f.text('starts_time', 'From'),
      f.text('ends_time', 'Until'),
      f.number('hours', 'Hours', { step: 0.25, inList: true }),
      f.select('kind', 'Type', ['shift', 'training', 'meeting', 'event'], { defaultValue: 'shift' }),
      f.money('expenses_minor', 'Expenses', 'currency'),
      f.date('reimbursed_on', 'Reimbursed'),
      f.text('note', 'Note')
    ]
  },
  // -- Digital life ----------------------------------------------------------
  {
    type: 'device',
    table: 'devices',
    label: 'Device',
    plural: 'Devices',
    module: 'digital',
    icon: 'laptop',
    titleField: 'name',
    dateField: 'next_backup_on',
    searchFields: ['name', 'make', 'model', 'serial', 'notes'],
    defaultOrder: 'name COLLATE NOCASE ASC',
    emptyState: 'What you own, when it is out of warranty, and when it was last backed up.',
    fields: [
      f.text('name', 'Device', { required: true, span: 2, inList: true }),
      f.select('kind', 'Type', ['computer', 'phone', 'tablet', 'wearable', 'console', 'nas', 'router', 'printer', 'other'], {
        inList: true,
        defaultValue: 'computer'
      }),
      f.text('make', 'Make'),
      f.text('model', 'Model', { inList: true }),
      f.text('serial', 'Serial number'),
      f.text('os_version', 'Operating system'),
      f.date('purchased_on', 'Bought'),
      f.date('warranty_ends_on', 'Warranty ends', { inList: true }),
      f.number('backup_frequency_days', 'Back up every … days', { group: 'Backups', min: 1, max: 365 }),
      f.date('last_backup_on', 'Last backed up', { group: 'Backups', inList: true }),
      f.date('next_backup_on', 'Next due', { group: 'Backups' }),
      f.ref('owner_person_id', 'Whose', 'person'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'domain',
    table: 'domains',
    label: 'Domain',
    plural: 'Domains',
    module: 'digital',
    icon: 'globe',
    titleField: 'name',
    dateField: 'expires_on',
    searchFields: ['name', 'registrar', 'notes'],
    defaultOrder: "COALESCE(expires_on, '9999') ASC",
    fields: [
      f.text('name', 'Domain', { required: true, span: 2, inList: true }),
      f.text('registrar', 'Registrar', { inList: true }),
      f.date('registered_on', 'Registered'),
      f.date('expires_on', 'Expires', { inList: true }),
      f.bool('auto_renew', 'Renews automatically', { defaultValue: true, inList: true }),
      f.money('cost_minor', 'Cost', 'currency'),
      f.longtext('notes', 'Notes')
    ]
  },
  {
    type: 'digital_account',
    table: 'digital_accounts',
    label: 'Online account',
    plural: 'Online accounts',
    module: 'digital',
    icon: 'key',
    titleField: 'service',
    searchFields: ['service', 'category', 'notes', 'username_hint'],
    defaultOrder: "CASE importance WHEN 'critical' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, service COLLATE NOCASE ASC",
    emptyState:
      'An inventory of where your accounts are — never what the passwords are. Keep those in a proper password manager.',
    fields: [
      f.text('service', 'Service', { required: true, span: 2, inList: true }),
      f.url('url', 'Address'),
      f.text('username_hint', 'Username hint', { help: 'Enough to recognise which account. Not the password.' }),
      f.text('category', 'Category', { inList: true }),
      f.select('importance', 'Importance', [
        { value: 'critical', label: 'Critical', tone: 'bad' },
        { value: 'normal', label: 'Normal', tone: 'neutral' },
        { value: 'low', label: 'Low', tone: 'neutral' }
      ], { inList: true, defaultValue: 'normal' }),
      f.bool('has_2fa', 'Two-factor is on', { inList: true }),
      f.text('twofa_method', 'Second factor'),
      f.text('password_manager', 'Password kept in', { help: 'Which password manager holds the real credentials.' }),
      f.longtext('recovery_notes', 'How to get back in', {
        help: 'Recovery steps, not recovery codes. Codes belong in your password manager.'
      }),
      f.longtext('notes', 'Notes')
    ]
  }
]
