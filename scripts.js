const g = document.getElementById.bind(document)
const q = document.querySelectorAll.bind(document)

const setMode = mode => {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', mode)
  localStorage.theme = mode
}
setMode(localStorage.theme || 'system')
document.addEventListener('click', e => {
  if (!e.target.closest('#mode')) return
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
  setMode(isDark ? 'light' : 'dark')
})
document.addEventListener('click', e => {
  if (!e.target.closest('#prod-toggle')) return
  const on = document.body.classList.toggle('production')
  g('top').classList.toggle('glass', on)
  g('top-prod').hidden = !on
})
const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props)
  for (const c of [].concat(children)) c != null && node.appendChild(c.nodeType ? c : document.createTextNode(c))
  return node
}
const palette = ['#0bc', '#f59e0b', '#ef4444', '#8b5cf6', '#22c55e', '#ec4899']

let data, fixtures, types, curveById, grid, trimGrid, plGrid, cfGrid, stGrid, view = 'pumps', open = null, vizRedraw = null
let draft = null, currentPump = null, originalSnapshot = ''

const theme = () =>
  agGrid.themeQuartz.withParams({
    backgroundColor: 'var(--color-lightest)',
    borderColor: 'var(--color-light)',
    foregroundColor: 'var(--color-darkest)',
    headerBackgroundColor: 'var(--color-lighter)',
    headerTextColor: 'var(--color-darker)',
    rowBorder: { color: 'var(--color-light)', style: 'solid', width: 1 },
    rowHoverColor: 'var(--color-lighter)',
  })

const gridDefaults = () => ({
  cellSelection: true,
  defaultColDef: { editable: true, filter: 'agTextColumnFilter', resizable: false, sortable: true },
  onCellValueChanged: () => persist(),
  popupParent: document.body,
  rowSelection: { checkboxes: true, headerCheckbox: true, mode: 'multiRow' },
  selectionColumnDef: { pinned: 'left', suppressSizeToFit: true },
  theme: theme(),
  undoRedoCellEditing: true,
  undoRedoCellEditingLimit: 50,
})

agGrid.ModuleRegistry.registerModules([agGrid.AllCommunityModule, agGrid.AllEnterpriseModule])

const STORAGE_KEY = 'flowiq'


const idCell = p => {
  const a = el('a', { className: 'button button-link detail-link', href: '#' }, p.value)
  a.onclick = e => { e.preventDefault(); openItem(view === 'pumps' ? 'pump' : 'curve', p.data.id) }
  return a
}

const rangeCell = p => `${p.data.range.min}–${p.data.range.max}`

const bepOf = points => points?.reduce((max, x) => (x.efficiency ?? -Infinity) > (max.efficiency ?? -Infinity) ? x : max, points[0])

const deleteColumn = getSource => ({
  cellClass: 'delete-cell',
  cellRenderer: p => {
    const btn = el('button', { className: 'button button-icon compact', type: 'button' })
    btn.appendChild(el('i', { className: 'fa-regular fa-trash' }))
    btn.onclick = e => {
      e.stopPropagation()
      if (!confirm('Delete this item? This cannot be undone.')) return
      const source = getSource()
      const idx = source.indexOf(p.data)
      if (idx >= 0) source.splice(idx, 1)
      p.api.applyTransaction({ remove: [p.data] })
      persist()
    }
    return btn
  },
  editable: false,
  filter: false,
  headerName: '',
  maxWidth: 56,
  minWidth: 56,
  pinned: 'right',
  resizable: false,
  sortable: false,
  suppressSizeToFit: true,
})

const applyFilter = (colId, value) => {
  if (!grid || value == null || value === '') return
  const next = { ...(grid.getFilterModel() ?? {}) }
  next[colId] = { filter: String(value), filterType: 'text', type: 'equals' }
  grid.setFilterModel(next)
  grid.setGridOption('defaultColDef', { ...gridDefaults().defaultColDef, floatingFilter: true })
  g('filter-btn').classList.add('active')
}

const filterLink = (colId, build) => p => {
  if (p.value == null || p.value === '') return ''
  const a = el('a', { className: 'button button-link', href: '#' })
  build(a, p)
  a.onclick = e => { e.preventDefault(); e.stopPropagation(); applyFilter(colId, p.value) }
  return a
}

const textBuilder = (a, p) => a.appendChild(document.createTextNode(p.value))
const lookupBuilder = list => (a, p) => a.appendChild(document.createTextNode(nameOf(list, p.value)))
const statusBuilder = (a, p) => {
  a.appendChild(el('span', { className: `dot status-${p.value}` }))
  a.appendChild(document.createTextNode(nameOf(fixtures.statuses, p.value)))
}

const productLineCell = filterLink('productLine', (a, p) => lookupBuilder(fixtures.productLines)(a, p))
const familyCell = filterLink('family', (a, p) => lookupBuilder(fixtures.curveFamilies)(a, p))
const typeCell = filterLink('type', (a, p) => lookupBuilder(fixtures.pumpTypes)(a, p))
const statusCell = filterLink('status', statusBuilder)

const pumpIdCell = p => {
  const a = el('a', { className: 'button button-link detail-link', href: '#' }, p.value || '—')
  a.onclick = e => { e.preventDefault(); openItem('pump', p.data.id) }
  return a
}

const curveLinkCell = p => {
  const a = el('a', { className: 'button button-link', href: '#' }, p.value)
  a.onclick = e => { e.preventDefault(); e.stopPropagation(); openItem('curve', p.value) }
  return a
}

const pumpsCols = [
  { cellRenderer: productLineCell, field: 'productLine', headerName: 'Product line' },
  { cellRenderer: typeCell, field: 'type', headerName: 'Type' },
  { cellRenderer: pumpIdCell, field: 'id', headerName: 'Model' },
  { headerName: 'RPM range', valueGetter: p => `${p.data.rpmRange.min}–${p.data.rpmRange.max}` },
  { cellRenderer: curveLinkCell, field: 'curveId', headerName: 'Curve' },
  { cellRenderer: statusCell, field: 'status', headerName: 'Status' },
  deleteColumn(() => fixtures.pumps.items),
]

const curvesCols = [
  { cellRenderer: familyCell, field: 'family', headerName: 'Family' },
  { cellRenderer: idCell, field: 'id', headerName: 'ID' },
  { field: 'rpm', headerName: 'RPM', type: 'numericColumn' },
  { headerName: 'Trims', type: 'numericColumn', valueGetter: p => p.data.trims.length },
  { headerName: 'Range', valueGetter: rangeCell },
  { cellRenderer: statusCell, field: 'status', headerName: 'Status' },
  deleteColumn(() => fixtures.curves),
]

const ACRONYMS = { bep: 'BEP', hvac: 'HVAC', id: 'ID', npshr: 'NPSHr', rpm: 'RPM', vfd: 'VFD' }
const humanize = s => {
  const base = (s.startsWith('meta.') ? s.slice(5) : s).split('.').map(seg => seg.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a} ${b.toLowerCase()}`)).join(' ')
  return base.replace(/\b[a-z]+\b/gi, w => ACRONYMS[w.toLowerCase()] ?? w).replace(/^./, c => c.toUpperCase())
}

const typeToCol = (field, typeVal, hide = false) => {
  if (Array.isArray(typeVal)) {
    const isEnum = typeVal.every(v => typeof v === 'string' && !v.startsWith('<'))
    return isEnum ? [{ field, headerName: humanize(field), hide }] : []
  }
  if (typeof typeVal === 'string') {
    if (typeVal.startsWith('<') && typeVal.endsWith('>')) {
      const refName = typeVal.slice(1, -1)
      const refType = types?.[refName]
      if (refType && typeof refType === 'object') return typeToCol(field, refType, hide)
      return [{ field, headerName: humanize(field), hide }]
    }
    const base = { field, headerName: humanize(field), hide }
    if (typeVal === 'number') return [{ ...base, type: 'numericColumn' }]
    return [base]
  }
  if (typeof typeVal === 'object' && typeVal !== null) {
    const childHide = typeVal.hide === true || hide
    if ('type' in typeVal) return typeToCol(field, typeVal.type, childHide)
    const { hide: _h, order: _o, ...rest } = typeVal
    return Object.entries(rest).flatMap(([k, v]) => typeToCol(`${field}.${k}`, v, childHide))
  }
  return []
}

const autoCols = (typeName, explicit) => {
  const type = types?.[typeName]
  if (!type) return []
  const taken = new Set(explicit.map(c => c.field).filter(Boolean))
  const orderOf = v => (typeof v === 'object' && v !== null && typeof v.order === 'number') ? v.order : Infinity
  return Object.entries(type)
    .filter(([k]) => !taken.has(k))
    .sort(([ka, va], [kb, vb]) => (orderOf(va) - orderOf(vb)) || ka.localeCompare(kb))
    .flatMap(([k, v]) => typeToCol(k, v))
}

const withAutoCols = (typeName, cols) => {
  const del = cols[cols.length - 1]
  const rest = cols.slice(0, -1)
  return [...rest, ...autoCols(typeName, rest), del]
}

const render = () => {
  g('page').classList.toggle('more', view === 'more')
  if (view === 'more') return renderMore()
  g('preset').textContent = view === 'pumps' ? 'All pumps' : 'All curves'
  g('new-btn').textContent = view === 'pumps' ? '+ New pump' : '+ New curve'
  const rows = view === 'pumps' ? fixtures.pumps.items : fixtures.curves
  const columnDefs = withAutoCols(view === 'pumps' ? 'pump' : 'curve', view === 'pumps' ? pumpsCols : curvesCols)
  if (grid) grid.destroy()
  grid = agGrid.createGrid(g('grid'), {
    ...gridDefaults(),
    autoSizeStrategy: { type: 'fitCellContents', scaleUpToFitGridWidth: true },
    columnDefs,
    rowData: rows,
  })
}

const buildSubGrid = (el, cols, rows) => agGrid.createGrid(el, {
  ...gridDefaults(),
  autoSizeStrategy: { type: 'fitCellContents', scaleUpToFitGridWidth: true },
  columnDefs: cols,
  domLayout: 'autoHeight',
  rowData: rows,
})

const plCols = [
  { field: 'id', headerName: 'ID' },
  { field: 'name', headerName: 'Product line' },
  { field: 'description', headerName: 'Description' },
  { headerName: 'Pumps', type: 'numericColumn', valueGetter: p => fixtures.pumps.items.filter(x => x.productLine === p.data.id).length },
  { headerName: 'Validation', valueGetter: p => fixtures.pumps.items.filter(x => x.productLine === p.data.id && x.status === 'Draft').length },
  { headerName: 'Staging', valueGetter: () => 0 },
  { headerName: 'Live', valueGetter: p => fixtures.pumps.items.filter(x => x.productLine === p.data.id && x.status === 'Published').length },
  deleteColumn(() => fixtures.productLines),
]
const cfCols = [
  { field: 'id', headerName: 'ID' },
  { field: 'name', headerName: 'Curve family' },
  { field: 'description', headerName: 'Description' },
  { headerName: 'Curves', type: 'numericColumn', valueGetter: p => fixtures.curves.filter(c => c.family === p.data.id).length },
  deleteColumn(() => fixtures.curveFamilies),
]
const stCols = [
  { field: 'id', headerName: 'ID' },
  { field: 'name', headerName: 'Name' },
  { field: 'description', headerName: 'Description' },
  { headerName: 'Pumps', type: 'numericColumn', valueGetter: p => fixtures.pumps.items.filter(x => x.status === p.data.id).length },
  { headerName: 'Curves', type: 'numericColumn', valueGetter: p => fixtures.curves.filter(c => c.status === p.data.id).length },
  deleteColumn(() => fixtures.statuses),
]

const seedTaxonomy = () => {
  fixtures.productLines ??= []
  fixtures.curveFamilies ??= []
  fixtures.statuses ??= []
  for (const p of fixtures.pumps.items)
    if (p.productLine && !fixtures.productLines.some(pl => pl.id === p.productLine))
      fixtures.productLines.push({ description: '', id: p.productLine, name: p.productLine })
  for (const c of fixtures.curves)
    if (c.family && !fixtures.curveFamilies.some(cf => cf.id === c.family))
      fixtures.curveFamilies.push({ description: '', id: c.family, name: c.family })
}

const renderMore = () => {
  seedTaxonomy()
  for (const grid of [plGrid, cfGrid, stGrid]) grid?.destroy()
  plGrid = buildSubGrid(g('product-lines-grid'), withAutoCols('productLine', plCols), fixtures.productLines)
  cfGrid = buildSubGrid(g('curve-families-grid'), withAutoCols('curveFamily', cfCols), fixtures.curveFamilies)
  stGrid = buildSubGrid(g('statuses-grid'), withAutoCols('status', stCols), fixtures.statuses)
}

const openItem = (type, id) => {
  open = { id, type }
  const body = g('drawer-body')
  body.replaceChildren()
  body.oninput = body.onchange = null
  if (type === 'pump') {
    const p = fixtures.pumps.items.find(x => x.id === id)
    currentPump = p
    draft = JSON.parse(JSON.stringify(p))
    originalSnapshot = JSON.stringify(p)
    const c = curveById[p.curveId]
    g('drawer-title').textContent = p.id
    for (const node of pumpSections(draft, c)) body.appendChild(node)
    checkDirty()
    let lastAutoId = p.id
    const idInput = body.querySelector('[data-field="id"]')
    const viewCurveBtn = body.querySelector('[data-action="view-curve"]')
    body.oninput = body.onchange = () => {
      const computed = `${draft.productLine || ''}-${draft.sizeName || ''}`.toLowerCase()
      if (!draft.id || draft.id === lastAutoId) {
        draft.id = computed
        if (idInput.value !== computed) idInput.value = computed
      }
      lastAutoId = computed
      g('drawer-title').textContent = draft.id
      viewCurveBtn.disabled = !draft.curveId
    }
  } else {
    const c = fixtures.curves.find(x => x.id === id)
    g('drawer-title').textContent = c.id
    for (const node of curveSections(c)) body.appendChild(node)
    body.oninput = body.onchange = () => g('drawer-title').textContent = c.id
  }
  g('drawer').classList.add('open')
  g('drawer').classList.toggle('pump', type === 'pump')
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0)
}

const closeOnOutside = e => {
  if (!e.target.closest('#drawer, [class*="ag-"]')) closeDrawer()
}

const closeDrawer = () => {
  open = null
  g('drawer').classList.remove('open')
  document.removeEventListener('click', closeOnOutside)
}

const kvTable = rows => {
  const wrap = el('div', { className: 'kv' })
  for (const [k, v] of rows) {
    wrap.appendChild(el('label', {}, k))
    wrap.appendChild(typeof v === 'string' ? el('span', {}, v) : v)
  }
  return wrap
}

const clone = id => g(id).content.firstElementChild.cloneNode(true)
const slot = (root, name) => root.querySelector(`[data-slot="${name}"]`)

const section = (title, children) => {
  const sec = clone('section-template')
  slot(sec, 'title').textContent = title
  sec.dataset.section = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const content = slot(sec, 'content')
  for (const c of [].concat(children)) content.appendChild(c)
  sec.querySelector('.nav-section-header').onclick = () => sec.classList.toggle('collapsed')
  return sec
}

const statusInline = s => {
  const span = el('span')
  span.appendChild(el('span', { className: `dot status-${String(s).toLowerCase()}` }))
  span.appendChild(document.createTextNode(s))
  return span
}

const openLink = (label, onClick) => {
  const a = el('a', { className: 'button button-link', href: '#' }, label)
  a.onclick = e => { e.preventDefault(); e.stopPropagation(); onClick() }
  return a
}

const trimBadges = c => {
  const wrap = el('span', { className: 'row tight' })
  for (const t of c.trims) wrap.appendChild(el('span', { className: 'badge' }, String(t.diameter)))
  return wrap
}

const bind = (node, write, event = 'oninput') => {
  node[event] = () => { write(); checkDirty(); persist() }
  return node
}

const textIn = (obj, key, type = 'text') => {
  const input = el('input', { placeholder: type === 'number' ? 'Enter a number' : 'Enter text', type, value: obj[key] ?? '' })
  input.dataset.field = key
  return bind(input, () => { obj[key] = type === 'number' ? Number(input.value) : input.value })
}

const textAreaIn = (obj, key) => {
  const ta = el('textarea', { placeholder: 'Enter text', rows: 2, value: obj[key] ?? '' })
  ta.dataset.field = key
  return bind(ta, () => { obj[key] = ta.value })
}

const rangeIn = r => {
  const make = k => {
    const input = el('input', { inputMode: 'numeric', placeholder: k, size: 5, type: 'text', value: r[k] ?? '' })
    input.dataset.field = k
    return bind(input, () => { r[k] = Number(input.value) })
  }
  return el('span', { className: 'row' }, [make('min'), el('span', { className: 'muted' }, 'to'), make('max')])
}

const nameOf = (list, id) => list?.find(x => x.id === id)?.name ?? id

const REF_FIXTURE = { curveFamilyId: 'curveFamilies', fitStatusId: 'fitStatuses', productLineId: 'productLines', pumpTypeId: 'pumpTypes', statusId: 'statuses', strategyId: 'strategies' }

const drawerRow = (key, typeVal, obj) => {
  const label = humanize(key)
  if (typeof typeVal === 'object' && typeVal !== null) {
    if ('type' in typeVal) return drawerRow(key, typeVal.type, obj)
    if ('min' in typeVal && 'max' in typeVal) {
      if (!obj[key]) obj[key] = { max: 0, min: 0 }
      return [label, rangeIn(obj[key])]
    }
    return null
  }
  if (Array.isArray(typeVal) && typeVal.every(v => typeof v === 'string' && !v.startsWith('<'))) return [label, selectIn(obj, key, typeVal)]
  if (typeof typeVal === 'string') {
    if (typeVal.startsWith('<') && typeVal.endsWith('>')) {
      const ref = typeVal.slice(1, -1)
      if (types?.[ref]) return null
      const fixtureKey = REF_FIXTURE[ref]
      if (fixtureKey && fixtures[fixtureKey]) return [label, selectIn(obj, key, fixtures[fixtureKey])]
      return [label, textIn(obj, key)]
    }
    if (key === 'description') return [label, textAreaIn(obj, key)]
    return [label, textIn(obj, key, typeVal === 'number' ? 'number' : 'text')]
  }
  return null
}

const drawerRows = (typeName, obj) => Object.entries(types?.[typeName] ?? {})
  .filter(([k]) => k !== 'meta')
  .map(([k, v]) => drawerRow(k, v, obj))
  .filter(Boolean)

const selectIn = (obj, key, options) => {
  const sel = el('select')
  sel.dataset.field = key
  const cur = obj[key]
  const pairs = options.map(o => typeof o === 'string' ? { id: o, name: o } : { id: o.id ?? o.name, name: o.name ?? o.id })
  if (cur && !pairs.some(p => p.id === cur)) pairs.unshift({ id: cur, name: cur })
  if (!cur) sel.appendChild(el('option', { textContent: '— select —', value: '' }))
  for (const { id, name } of pairs) {
    const o = el('option', { textContent: name, value: id })
    if (cur === id) o.selected = true
    sel.appendChild(o)
  }
  return bind(sel, () => { obj[key] = sel.value }, 'onchange')
}

const checkDirty = () => {
  const btn = g('save-pump')
  if (btn) btn.disabled = JSON.stringify(draft) === originalSnapshot
}

const savePump = () => {
  if (!currentPump || !draft) return
  for (const k of Object.keys(draft))
    currentPump[k] = typeof draft[k] === 'object' && draft[k] !== null ? JSON.parse(JSON.stringify(draft[k])) : draft[k]
  originalSnapshot = JSON.stringify(currentPump)
  grid?.applyTransaction({ update: [currentPump] })
  persist()
  closeDrawer()
}

const saveFooter = () => {
  const wrap = clone('pump-footer-template')
  const viewBtn = wrap.querySelector('[data-action="view-curve"]')
  viewBtn.disabled = !draft?.curveId
  viewBtn.onclick = e => { e.stopPropagation(); if (draft?.curveId) openItem('curve', draft.curveId) }
  wrap.querySelector('[data-action="save"]').onclick = savePump
  return wrap
}

const pumpSections = (p, c) => [
  section('Details', kvTable([
    ['ID', textIn(p, 'id')],
    ['Product line', selectIn(p, 'productLine', fixtures.productLines)],
    ['Type', selectIn(p, 'type', fixtures.pumpTypes)],
    ['Size name', textIn(p, 'sizeName')],
    ['Curve', selectIn(p, 'curveId', fixtures.curves)],
    ['Description', textAreaIn(p, 'description')],
    ['RPM range', rangeIn(p.rpmRange)],
    ['VFD limit', textIn(p, 'vfdLimit', 'number')],
    ['Stages', rangeIn(p.stages)],
    ['Shaft power', textIn(p, 'shaftPower', 'number')],
    ['Solids limit', textIn(p, 'solidsLimit', 'number')],
    ['Cutwater diameter', textIn(p, 'cutwaterDiameter', 'number')],
    ['Suction nozzle', textIn(p, 'suctionNozzle')],
    ['Discharge nozzle', textIn(p, 'dischargeNozzle')],
    ['Status', selectIn(p, 'status', fixtures.statuses)],
  ])),
  saveFooter(),
]

const sharingBanner = c => {
  const pumps = fixtures.pumps.items.filter(p => p.curveId === c.id)
  const banner = clone('sharing-banner-template')
  slot(banner, 'headline').textContent = pumps.length ? `Used by ${pumps.length} pump size${pumps.length === 1 ? '' : 's'}` : 'Not used by any pump sizes'
  const desc = slot(banner, 'description')
  const links = slot(banner, 'links')
  if (pumps.length) {
    desc.textContent = 'Changes to this curve affect every pump size below.'
    for (const p of pumps) links.appendChild(openLink(p.id, () => openItem('pump', p.id)))
  } else {
    desc.remove()
    links.remove()
  }
  return banner
}

const curveSections = c => [
  sharingBanner(c),
  section('Details', kvTable([
    ['Curve ID', textIn(c, 'id')],
    ['Family', selectIn(c, 'family', fixtures.curveFamilies)],
    ['Description', textAreaIn(c, 'description')],
    ['Speed (RPM)', textIn(c, 'rpm', 'number')],
    ['Speed range', textIn(c, 'speedRange')],
    ['Motor', textIn(c, 'motor')],
    ['Impeller', textIn(c, 'impeller')],
    ['Status', selectIn(c, 'status', fixtures.statuses)],
    ['Service factor', textIn(c, 'serviceFactor', 'number')],
    ['Strategy', selectIn(c, 'strategy', fixtures.strategies)],
    ['Fit status', selectIn(c, 'fitStatus', fixtures.fitStatuses)],
  ])),
  el('hr'),
  vizSection(c),
  el('hr'),
  trimDataSection(c),
  el('hr'),
  motorImpellerSection(c),
]

const vizSection = c => {
  const visible = new Set(c.trims.map(t => t.id))
  const holder = el('div')
  const legend = el('div', { className: 'legend' })
  const redraw = () => {
    for (const t of c.trims) if (!visible.has(t.id)) visible.add(t.id)
    for (const id of [...visible]) if (!c.trims.some(t => t.id === id)) visible.delete(id)
    holder.replaceChildren(buildViz(c, visible))
    legend.replaceChildren()
    c.trims.forEach((t, i) => {
      const btn = clone('legend-item-template')
      btn.classList.add(`palette-${i % palette.length}`)
      btn.setAttribute('aria-pressed', visible.has(t.id) ? 'true' : 'false')
      slot(btn, 'label').textContent = `${t.diameter} mm`
      btn.onclick = () => {
        visible.has(t.id) ? visible.delete(t.id) : visible.add(t.id)
        redraw()
      }
      legend.appendChild(btn)
    })
  }
  vizRedraw = redraw
  redraw()
  return section('Visualization', [holder, legend])
}

const parsePercent = p => {
  const n = Number(String(p.newValue).replace('%', '').trim())
  return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : p.oldValue
}

const trimCols = [
  { field: 'flow', headerName: 'Flow (m³/h)', type: 'numericColumn' },
  { field: 'head', headerName: 'Head (m)', type: 'numericColumn' },
  { field: 'efficiency', headerName: 'Efficiency', type: 'numericColumn', valueFormatter: p => `${(p.value * 100).toFixed(0)}%`, valueParser: parsePercent },
  { field: 'npshr', headerName: 'NPSHr (m)', type: 'numericColumn' },
  { field: 'power', headerName: 'Power (kW)', type: 'numericColumn' },
]

const sectionMenu = handlers => {
  const node = g('section-menu-template').content.firstElementChild.cloneNode(true)
  const btn = node.querySelector('.button-icon')
  const menu = node.querySelector('.menu')
  btn.onclick = e => { e.stopPropagation(); menu.classList.toggle('open') }
  for (const [key, fn] of Object.entries(handlers)) {
    if (!fn) continue
    const action = key.replace(/^on/, '').toLowerCase()
    const mi = node.querySelector(`[data-action="${action}"]`)
    if (mi) mi.onclick = fn
  }
  return node
}

const gridMenu = getGrid => sectionMenu({
  onColumns: () => getGrid()?.showColumnChooser(),
  onExport: () => getGrid()?.exportDataAsCsv(),
  onRedo: () => getGrid()?.redoCellEditing(),
  onUndo: () => getGrid()?.undoCellEditing(),
})

const trimDataSection = c => {
  let selectedId = c.trims[0]?.id
  trimGrid = null
  const sec = el('div', { className: 'nav-section' })
  sec.dataset.section = 'performance-data'
  const header = el('div', { className: 'nav-section-header' })
  header.appendChild(el('h4', {}, 'Performance data'))
  header.appendChild(el('i', { className: 'fa-regular fa-chevron-right' }))
  header.appendChild(el('div', { className: 'fill' }))
  header.appendChild(gridMenu(() => trimGrid))
  const newTrimBtn = el('button', { className: 'button primary', type: 'button' }, '+ New trim')
  header.appendChild(newTrimBtn)
  header.onclick = e => { if (!e.target.closest('.menu-wrap, button')) sec.classList.toggle('collapsed') }
  const content = el('div', { className: 'nav-section-content' })
  const wrap = el('div', { className: 'trim-layout' })
  const list = el('div', { className: 'trim-list' })
  const panel = el('div', { className: 'trim-grid' })
  const updateSelection = () => {
    list.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === selectedId ? 'true' : 'false'))
    const trim = c.trims.find(t => t.id === selectedId)
    if (trim && trimGrid) trimGrid.setGridOption('rowData', trim.points)
  }
  const rebuildList = () => {
    c.trims.sort((a, b) => a.diameter - b.diameter)
    list.replaceChildren()
    for (const t of c.trims) {
      const btn = el('button', { className: 'trim-list-item', type: 'button' })
      btn.dataset.id = t.id
      btn.textContent = `${t.diameter} mm`
      btn.onclick = () => { selectedId = t.id; updateSelection() }
      list.appendChild(btn)
    }
  }
  rebuildList()
  const nextFreeDiameter = () => {
    const { increment, max, min } = c.range
    const used = new Set(c.trims.map(t => t.diameter))
    for (let d = min; d <= max; d += increment) if (!used.has(d)) return d
    return null
  }
  const syncNewTrim = () => { newTrimBtn.disabled = nextFreeDiameter() == null }
  syncNewTrim()
  newTrimBtn.onclick = e => {
    e.stopPropagation()
    const diameter = nextFreeDiameter()
    if (diameter == null) return
    const newTrim = buildTrim(c.id, diameter)
    c.trims.push(newTrim)
    selectedId = newTrim.id
    persist()
    rebuildList()
    vizRedraw?.()
    syncNewTrim()
    updateSelection()
  }
  wrap.appendChild(list)
  wrap.appendChild(panel)
  content.appendChild(wrap)
  setTimeout(() => {
    trimGrid = agGrid.createGrid(panel, {
      ...gridDefaults(),
      autoSizeStrategy: { type: 'fitGridWidth' },
      cellSelection: { handle: { mode: 'fill' } },
      columnDefs: [
        ...trimCols.map(col => col.field === 'efficiency' ? {
          ...col,
          cellRenderer: p => {
            const points = c.trims.find(t => t.id === selectedId)?.points ?? []
            const text = typeof p.value === 'number' ? `${(p.value * 100).toFixed(0)}%` : ''
            const isBep = p.data === bepOf(points) && points.some(x => typeof x.efficiency === 'number')
            return isBep ? `★ ${text}` : text
          },
        } : col),
        deleteColumn(() => c.trims.find(t => t.id === selectedId)?.points ?? []),
      ],
      domLayout: 'autoHeight',
      onGridSizeChanged: p => p.api.sizeColumnsToFit(),
      rowData: c.trims.find(t => t.id === selectedId)?.points ?? [],
    })
    updateSelection()
  }, 0)
  sec.appendChild(header)
  sec.appendChild(content)
  return sec
}

const motorImpellerSection = c => {
  const grid = el('div', { className: 'range-grid' })
  const summary = el('div', { className: 'summary' })
  const recompute = () => {
    const variants = Math.max(0, Math.floor((c.range.max - c.range.min) / c.range.increment) + 1)
    summary.replaceChildren()
    summary.appendChild(document.createTextNode('Will generate '))
    summary.appendChild(el('strong', {}, String(variants)))
    summary.appendChild(document.createTextNode(` variants from ${c.range.min}mm to ${c.range.max}mm in steps of ${c.range.increment}mm.`))
  }
  for (const k of ['min', 'max', 'increment']) {
    const input = textIn(c.range, k, 'number')
    input.addEventListener('input', recompute)
    const f = el('div', { className: 'field' })
    f.appendChild(el('label', {}, k[0].toUpperCase() + k.slice(1)))
    f.appendChild(input)
    grid.appendChild(f)
  }
  recompute()
  return section('Motor & impeller', [grid, summary])
}

const buildViz = (c, visible) => {
  const w = 800, h = 260, pad = { b: 28, l: 36, r: 12, t: 24 }
  const all = c.trims.flatMap(t => t.points)
  const xMax = Math.max(...all.map(p => p.flow))
  const yMin = Math.min(...all.map(p => p.head))
  const yMax = Math.max(...all.map(p => p.head))
  const xs = v => pad.l + ((w - pad.l - pad.r) * v) / xMax
  const ys = v => h - pad.b - ((h - pad.t - pad.b) * (v - yMin)) / (yMax - yMin)
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('class', 'viz')
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + ((h - pad.t - pad.b) * i) / 4
    const line = document.createElementNS(ns, 'line')
    line.setAttribute('class', 'viz-grid')
    line.setAttribute('x1', pad.l)
    line.setAttribute('x2', w - pad.r)
    line.setAttribute('y1', y)
    line.setAttribute('y2', y)
    svg.appendChild(line)
    const t = document.createElementNS(ns, 'text')
    t.setAttribute('class', 'viz-axis')
    t.setAttribute('x', 4)
    t.setAttribute('y', y + 4)
    t.textContent = (yMin + ((yMax - yMin) * (4 - i)) / 4).toFixed(0)
    svg.appendChild(t)
  }
  c.trims.forEach((trim, i) => {
    if (visible && !visible.has(trim.id)) return
    const path = document.createElementNS(ns, 'path')
    const d = trim.points.map((p, j) => `${j ? 'L' : 'M'}${xs(p.flow).toFixed(1)},${ys(p.head).toFixed(1)}`).join(' ')
    path.setAttribute('class', 'viz-curve')
    path.setAttribute('d', d)
    path.setAttribute('stroke', palette[i % palette.length])
    svg.appendChild(path)
  })
  const xLabel = document.createElementNS(ns, 'text')
  xLabel.setAttribute('class', 'viz-axis')
  xLabel.setAttribute('x', w - pad.r)
  xLabel.setAttribute('y', h - 8)
  xLabel.setAttribute('text-anchor', 'end')
  xLabel.textContent = `Flow → ${xMax.toFixed(0)} m³/h`
  svg.appendChild(xLabel)
  const yLabel = document.createElementNS(ns, 'text')
  yLabel.setAttribute('class', 'viz-axis')
  yLabel.setAttribute('x', 4)
  yLabel.setAttribute('y', 12)
  yLabel.textContent = 'Head (m)'
  svg.appendChild(yLabel)
  return svg
}

const LLM_URL = 'https://us-central1-samantha-374622.cloudfunctions.net/openai-responses'

const obj = (properties, required = Object.keys(properties)) => ({ additionalProperties: false, properties, required, type: 'object' })
const arr = items => ({ items, type: 'array' })
const str = { type: 'string' }
const enm = values => ({ enum: values, type: 'string' })

const buildStructureSchema = () => ({
  name: 'flowiq_structure',
  schema: obj({
    curveFamilies: arr(obj({ description: str, id: str, name: str })),
    curves: arr(obj({
      description: str, family: str,
      fitStatus: enm(fixtures.fitStatuses.map(f => f.id)),
      id: str, impeller: str, motor: str, speedRange: str,
      status: enm(fixtures.statuses.map(s => s.id)),
      strategy: enm(fixtures.strategies.map(s => s.id)),
    })),
    productLines: arr(obj({ description: str, id: str, name: str })),
    pumps: arr(obj({
      curveId: str, description: str, dischargeNozzle: str,
      productLine: str, sizeName: str,
      status: enm(fixtures.statuses.map(s => s.id)), suctionNozzle: str,
      type: enm(fixtures.pumpTypes.map(t => t.id)),
    })),
  }),
  strict: true,
  type: 'json_schema',
})

const callLLM = async (input, instructions, format, model = 'gpt-4.1-mini') => {
  const r = await fetch(LLM_URL, {
    body: JSON.stringify({ input, instructions, model, text: { format }, tools: [{ type: 'web_search' }] }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (!r.ok) throw new Error(`LLM ${r.status}: ${await r.text()}`)
  return JSON.parse((await r.json()).output_text)
}

const pick = a => a[Math.floor(Math.random() * a.length)]
const rand = (lo, hi, dp = 2) => +(lo + Math.random() * (hi - lo)).toFixed(dp)
const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1))

const buildTrim = (curveId, diameter) => {
  const qMax = Math.round(200 * (diameter / 150) ** 1.5)
  const h0 = +(36 * (diameter / 150) ** 2).toFixed(0)
  const points = Array.from({ length: 5 }, (_, j) => {
    const t = j / 4
    return {
      efficiency: +(0.42 + 0.36 * Math.sin(Math.PI * t)).toFixed(2),
      flow: Math.round(qMax * t),
      head: +(h0 * (1 - 0.45 * t * t)).toFixed(1),
      id: `p-${j}`,
      npshr: +(1.8 + 2.4 * t).toFixed(1),
      power: +((4.1 + 2.8 * t) * (diameter / 150) ** 1.2).toFixed(1),
    }
  })
  return {
    diameter, fitStatus: pick(['fitted', 'needs-review']), id: String(diameter),
    impellerId: `IMP-${curveId}-${diameter}`, points, status: pick(['draft', 'published']),
  }
}

const buildTrims = curveId => {
  const count = randInt(2, 3)
  const base = randInt(24, 36) * 5
  return Array.from({ length: count }, (_, i) => buildTrim(curveId, base + i * 25))
}

const enrichCurve = c => {
  const trims = buildTrims(c.id)
  const diameters = trims.map(t => t.diameter)
  return {
    ...c,
    range: { increment: pick([5, 10]), max: Math.max(...diameters), min: Math.min(...diameters) },
    rpm: pick([1450, 1750, 2900, 3550]),
    serviceFactor: rand(1.0, 1.25),
    trims,
  }
}

const enrichPump = (p, curves) => {
  const c = curves.find(x => x.id === p.curveId) ?? curves[0]
  const stagesMin = randInt(1, 3)
  return {
    ...p,
    cutwaterDiameter: randInt(100, 300),
    id: `${p.productLine}-${p.sizeName}`.toLowerCase(),
    impellerId: pick(c.trims).impellerId,
    rpmRange: { max: c.rpm, min: Math.max(1200, c.rpm - randInt(200, 800)) },
    shaftPower: rand(2, 50, 1),
    solidsLimit: randInt(1, 10),
    stages: { max: stagesMin + randInt(0, 3), min: stagesMin },
    vfdLimit: randInt(40, 80),
  }
}

const setBtn = (label, disabled = true) => {
  const btn = g('generate-btn')
  btn.disabled = disabled
  btn.replaceChildren()
  btn.appendChild(el('i', { className: `fa-regular fa-${disabled ? 'spinner-third fa-spin' : 'sparkles'}` }))
  btn.appendChild(document.createTextNode(' ' + label))
}

const mergeBy = (key, existing, incoming) => {
  const seen = new Set(existing.map(x => x[key]))
  return [...existing, ...incoming.filter(x => !seen.has(x[key]) && (seen.add(x[key]), true))]
}

const BASE_PROMPT = `Generate additional taxonomy and records for a fluid-handling catalog covering centrifugal pumps (the most common type) and their performance curves, typical of commercial development applications (water, HVAC, wastewater, light industrial). Augment what already exists — extend, do not duplicate.

Generate:
- productLines: only add genuinely new ones (1-3 if natural gaps exist). id like "ACME-ES" short uppercase code; descriptive name; 1-sentence description. Reuse existing ids when applicable.
- curveFamilies: only add genuinely new ones (1-3 if natural gaps exist). id kebab-case slug, name title-case, 1-sentence description. Reuse existing ids when applicable.
- curves: id like "150IEQ-07-demo" (unique; avoid existing curve ids), 1-sentence description, family must reference a curveFamilies.id (existing or new), motor (e.g. "2 poles, 60.00Hz, 3550.00 RPM"), impeller (e.g. "1 eye"), speedRange (e.g. "500.00 - 3600.00 RPM"); status, fitStatus, strategy must all be ids from the taxonomy (e.g. status "draft" / "published" / "archived").
- pumps: sizeName like "1x1.5-6", 1-sentence description, productLine references a productLine id (existing or new), curveId references one of your newly-generated curves, type must be a pumpType id from the allowed list, suctionNozzle/dischargeNozzle (e.g. "1\\"", "2\\""), status.

All cross-references must resolve. Mostly Published; a few Draft. Output NO numeric engineering values — those are filled in afterward.`

const REPLACE_PROMPT = `Generate a fresh centrifugal pump catalog grounded in real products from the referenced source. Treat this as a brand-new catalog — do not reference or retain any prior data.

Generate:
- productLines reflecting the source's actual product lines. id short uppercase code; descriptive name; 1-sentence description.
- curveFamilies matching real performance groupings. id kebab-case slug, name title-case, 1-sentence description.
- curves with id like "150IEQ-07-demo", 1-sentence description, family reference, motor (e.g. "2 poles, 60.00Hz, 3550.00 RPM"), impeller (e.g. "1 eye"), speedRange (e.g. "500.00 - 3600.00 RPM"); status, fitStatus, strategy must all be ids from the taxonomy.
- pumps with sizeName like "1x1.5-6", 1-sentence description, productLine ref, curveId ref, type must be a pumpType id from the allowed list, suctionNozzle/dischargeNozzle (e.g. "1\\"", "2\\""), status.

All cross-references must resolve. Mostly Published; a few Draft. Output NO numeric engineering values — those are filled in afterward.`

const generate = async opts => {
  try {
    setBtn('Generating…')
    const ctx = {
      curveFamilies: (fixtures.curveFamilies ?? []).map(f => f.id).join(', ') || '(none yet)',
      curveIds: fixtures.curves.map(c => c.id).join(', ') || '(none yet)',
      productLines: (fixtures.productLines ?? []).map(p => p.id).join(', ') || '(none yet)',
    }
    const replace = !!opts.sourceUrl
    const sourceLine = replace ? `\nReference catalog: ${opts.sourceUrl}. Use web search to ground names and specifications in real products from this source.\n` : ''
    const context = replace
      ? `Allowed pumpType ids: ${fixtures.pumpTypes.map(t => t.id).join(', ')}`
      : `Existing productLine ids: ${ctx.productLines}
Existing curveFamily ids: ${ctx.curveFamilies}
Allowed pumpType ids: ${fixtures.pumpTypes.map(t => t.id).join(', ')}
Existing curve ids (avoid collisions): ${ctx.curveIds}`
    const input = `${opts.prompt}
${sourceLine}
Target: ${opts.curveCount} curves, ${opts.pumpCount} pumps.

${context}`
    const r = await callLLM(
      input,
      'You are a fluid-handling catalog architect for commercial pump applications. Output realistic, industry-accurate naming and classification — language and categorization only, no numeric engineering values.',
      buildStructureSchema(),
      opts.model,
    )
    const newCurves = r.curves.map(enrichCurve)
    const newPumps = r.pumps.map(p => enrichPump(p, newCurves))
    const next = {
      fixtures: {
        ...fixtures,
        curveFamilies: replace ? r.curveFamilies : mergeBy('id', fixtures.curveFamilies ?? [], r.curveFamilies),
        curves: replace ? newCurves : [...fixtures.curves, ...newCurves],
        productLines: replace ? r.productLines : mergeBy('id', fixtures.productLines ?? [], r.productLines),
        pumps: { ...fixtures.pumps, items: replace ? newPumps : [...fixtures.pumps.items, ...newPumps] },
      },
      types,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    hydrate(next)
    closeDrawer()
    render()
    syncReset()
    setBtn('Generate', false)
  } catch (err) {
    console.error(err)
    alert(`Generation failed: ${err.message}`)
    setBtn('Generate', false)
  }
}

g('gen-prompt').value = BASE_PROMPT
g('generate-btn').addEventListener('click', () => {
  const select = g('gen-source')
  select.replaceChildren(el('option', { textContent: 'Prompt only', value: '' }))
  for (const s of fixtures.sources ?? []) select.appendChild(el('option', { textContent: s.name, value: s.url }))
  g('gen-prompt').value = select.value ? REPLACE_PROMPT : BASE_PROMPT
  g('generate-dialog').showModal()
})
g('gen-source').addEventListener('change', e => { g('gen-prompt').value = e.target.value ? REPLACE_PROMPT : BASE_PROMPT })
g('data-btn').addEventListener('click', () => {
  const code = g('data-content').querySelector('code')
  code.textContent = JSON.stringify(data, null, 2)
  Prism.highlightElement(code)
  g('data-dialog').showModal()
})
g('data-close').addEventListener('click', () => g('data-dialog').close())
g('data-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2))
  const btn = g('data-copy')
  const orig = btn.innerHTML
  btn.innerHTML = '<i class="fa-regular fa-check"></i> Copied to clipboard'
  setTimeout(() => { btn.innerHTML = orig }, 1500)
})
g('gen-cancel').addEventListener('click', () => g('generate-dialog').close())
g('gen-close').addEventListener('click', () => g('generate-dialog').close())
g('gen-go').addEventListener('click', () => {
  g('generate-dialog').close()
  generate({
    curveCount: Number(g('gen-curve-count').value),
    model: g('gen-model').value,
    prompt: g('gen-prompt').value,
    pumpCount: Number(g('gen-pump-count').value),
    sourceUrl: g('gen-source').value,
  })
})
g('reset-btn').addEventListener('click', () => { localStorage.removeItem(STORAGE_KEY); closeDrawer(); loadFixture() })

g('nav').addEventListener('click', e => {
  const btn = e.target.closest('button[data-view]')
  if (!btn) return
  view = btn.dataset.view
  closeDrawer()
  q('#nav button[data-view]').forEach(b => b.classList.toggle('active', b === btn))
  render()
})

g('filter-btn').addEventListener('click', () => {
  const active = g('filter-btn').classList.toggle('active')
  grid?.setGridOption('defaultColDef', { ...gridDefaults().defaultColDef, floatingFilter: active })
})
g('columns-btn').addEventListener('click', () => grid?.showColumnChooser())

document.addEventListener('click', e => {
  if (e.target.closest('.menu-wrap')) return
  for (const m of document.querySelectorAll('.menu')) m.classList.remove('open')
})

const emptyPump = () => ({ curveId: '', id: '', productLine: '', rpmRange: { max: 0, min: 0 }, sizeName: '', stages: { max: 1, min: 1 }, status: 'draft', type: '' })
const emptyCurve = () => ({ family: '', id: '', range: { increment: 1, max: 0, min: 0 }, rpm: 0, status: 'draft', trims: [] })
const focusNewRow = api => {
  const i = api.getDisplayedRowCount() - 1
  const cols = api.getColumns?.() ?? []
  const target = ['model', 'id'].map(f => cols.find(c => c.getColId() === f)).find(Boolean) ?? cols.find(c => !c.getColDef().checkboxSelection)
  if (target) api.startEditingCell({ colKey: target.getColId(), rowIndex: i })
}

g('new-btn').addEventListener('click', () => {
  if (!grid) return
  const isP = view === 'pumps'
  const item = isP ? emptyPump() : emptyCurve()
  if (isP) fixtures.pumps.items.push(item)
  else { fixtures.curves.push(item); curveById[item.id] = item }
  grid.applyTransaction({ add: [item] })
  persist()
  openItem(isP ? 'pump' : 'curve', item.id)
})
const subGridSections = [
  { array: 'productLines', empty: () => ({ description: '', id: '', name: '' }), grid: () => plGrid, gridId: 'product-lines-grid', key: 'pl', newLabel: '+ New product line', title: 'Product lines' },
  { array: 'curveFamilies', empty: () => ({ description: '', id: '', name: '' }), grid: () => cfGrid, gridId: 'curve-families-grid', key: 'cf', newLabel: '+ New curve family', title: 'Curve families' },
  { array: 'statuses', empty: () => ({ description: '', name: '' }), grid: () => stGrid, gridId: 'statuses-grid', key: 'st', newLabel: '+ New status', title: 'Workflow' },
]

for (const [i, s] of subGridSections.entries()) {
  if (i > 0) g('more-page').appendChild(el('hr'))
  const sec = clone('sub-grid-section-template')
  slot(sec, 'title').textContent = s.title
  slot(sec, 'new-label').textContent = s.newLabel
  slot(sec, 'grid').id = s.gridId
  sec.querySelectorAll('button[data-action]').forEach(b => b.dataset.section = s.key)
  g('more-page').appendChild(sec)
}

const sectionByKey = Object.fromEntries(subGridSections.map(s => [s.key, s]))
const newGridMap = sectionByKey

g('more-page').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]')
  if (btn) {
    const cfg = sectionByKey[btn.dataset.section]
    const target = cfg?.grid()
    if (!target) return
    e.stopPropagation()
    if (btn.dataset.action === 'filter') {
      const active = btn.classList.toggle('active')
      target.setGridOption('defaultColDef', { ...gridDefaults().defaultColDef, floatingFilter: active })
    } else if (btn.dataset.action === 'columns') target.showColumnChooser()
    else if (btn.dataset.action === 'new') {
      const item = cfg.empty()
      fixtures[cfg.array].push(item)
      target.applyTransaction({ add: [item] })
      persist()
      focusNewRow(target)
    }
    return
  }
  const header = e.target.closest('.nav-section-header')
  if (header) header.parentElement.classList.toggle('collapsed')
})

g('grid-menu').appendChild(gridMenu(() => grid))

g('drawer-close').addEventListener('click', closeDrawer)
document.addEventListener('keydown', e => e.key === 'Escape' && open && closeDrawer())

window.flowiq = { get fixtures() { return fixtures } }

let persistTimer
const persist = () => {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    syncReset()
  }, 300)
}
const hydrate = json => {
  data = json
  ;({ fixtures, types } = json)
  curveById = Object.fromEntries(fixtures.curves.map(c => [c.id, c]))
  seedTaxonomy()
}
const syncReset = () => {
  const has = !!localStorage.getItem(STORAGE_KEY)
  g('reset-btn').hidden = !has
  g('generate-btn').hidden = has
}
const loadFixture = () => fetch('flowiq-v2.json').then(r => r.json()).then(json => { hydrate(json); render(); syncReset() })

const stored = localStorage.getItem(STORAGE_KEY)
const parsed = stored ? JSON.parse(stored) : null
if (parsed?.fixtures) { hydrate(parsed); render(); syncReset() }
else { localStorage.removeItem(STORAGE_KEY); loadFixture() }
