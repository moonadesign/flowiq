const $ = document.getElementById.bind(document)
const mk = (tag, props = {}, children = []) => {
  const n = Object.assign(document.createElement(tag), props)
  for (const c of [].concat(children)) c != null && n.appendChild(c.nodeType ? c : document.createTextNode(c))
  return n
}

const highlightClass = 'test-highlight'
const TTS_URL = 'https://us-central1-samantha-374622.cloudfunctions.net/openai-tts'
let currentAudio = null
const speak = async text => {
  if (currentAudio) { currentAudio.pause(); currentAudio = null }
  try {
    const r = await fetch(TTS_URL, {
      body: JSON.stringify({ input: text, instructions: 'Speak with a warm, soft British female voice. Friendly and conversational.', model: 'gpt-4o-mini-tts', voice: 'shimmer' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (!r.ok) return
    const blob = await r.blob()
    await new Promise(resolve => {
      const audio = new Audio(URL.createObjectURL(blob))
      currentAudio = audio
      audio.onended = audio.onerror = () => { currentAudio = null; resolve() }
      audio.play().catch(() => resolve())
    })
  } catch {}
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

const highlight = el => {
  if (!el) return
  el.classList.add(highlightClass)
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  return () => el.classList.remove(highlightClass)
}

const performAction = async action => {
  if (!action) return
  if (action.type === 'wait') return sleep(action.value ?? 1000)
  const target = document.querySelector(action.selector)
  if (!target) return
  const clear = highlight(target)
  await sleep(400)
  if (action.type === 'click') target.click()
  else if (action.type === 'fill') {
    target.focus()
    target.value = action.value
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (action.type === 'select') {
    target.value = action.value
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await sleep(600)
  clear?.()
}

let running = false
let stopRequested = false

const anchorLeft = () => {
  const p = $('test-panel')
  p.style.left = '0.75rem'
  p.style.right = 'auto'
  p.style.bottom = '0.75rem'
  p.style.top = 'auto'
}

const runTest = async test => {
  if (running) return
  running = true
  stopRequested = false
  anchorLeft()
  $('test-pills').hidden = true
  $('test-stop').hidden = false
  const log = $('test-log')
  log.replaceChildren()
  const STEP_DELAY = 1000
  for (const step of test.steps) {
    if (stopRequested) break
    log.replaceChildren(mk('div', { className: 'bubble' }, step.narrate))
    await speak(step.narrate)
    if (stopRequested) break
    await performAction(step.action)
    if (stopRequested) break
    await sleep(STEP_DELAY)
  }
  if (!stopRequested) {
    const signOff = 'And that\'s it — let me know if you\'d like to try another.'
    log.replaceChildren(mk('div', { className: 'bubble' }, signOff))
    await speak(signOff)
  }
  running = false
  $('test-pills').hidden = false
  $('test-stop').hidden = true
}

const stopTest = () => {
  stopRequested = true
  if (currentAudio) { currentAudio.pause(); currentAudio = null }
  document.querySelectorAll('.' + highlightClass).forEach(el => el.classList.remove(highlightClass))
  running = false
  $('test-pills').hidden = false
  $('test-stop').hidden = true
}

const openPanel = () => {
  const tests = window.flowiq?.fixtures?.tests ?? []
  const pills = $('test-pills')
  pills.replaceChildren()
  tests.forEach(t => {
    const btn = mk('button', { className: 'button outline pill', type: 'button' }, t.name)
    btn.onclick = () => runTest(t)
    pills.appendChild(btn)
  })
  $('test-panel').hidden = false
  $('test-toggle').hidden = true
}

const closePanel = () => {
  stopTest()
  $('test-panel').hidden = true
  $('test-toggle').hidden = false
}

const addBubble = (text, kind) => {
  const log = $('test-log')
  log.appendChild(mk('div', { className: kind === 'user' ? 'bubble bubble-right' : 'bubble' }, text))
  log.scrollTop = log.scrollHeight
}

const askLLM = async userText => {
  addBubble(userText, 'user')
  const placeholder = mk('div', { className: 'test-bubble' }, '…')
  $('test-log').appendChild(placeholder)
  try {
    const r = await fetch(LLM_URL, {
      body: JSON.stringify({
        input: userText,
        instructions: 'You are Flo, a friendly assistant for FlowIQ — a centrifugal pump catalog admin tool. Users can create pumps, manage curves, and set up product lines. Keep answers short (1-2 sentences) and warm.',
        model: 'gpt-4.1-mini',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (!r.ok) throw new Error('LLM failed')
    const { output_text } = await r.json()
    placeholder.textContent = output_text?.trim() || 'Sorry, I didn\'t catch that.'
    speak(placeholder.textContent)
  } catch {
    placeholder.textContent = 'Sorry, I had trouble answering that.'
  }
  $('test-log').scrollTop = $('test-log').scrollHeight
}

document.addEventListener('click', e => {
  if (e.target.closest('#test-toggle')) openPanel()
  else if (e.target.closest('#test-close')) closePanel()
  else if (e.target.closest('#test-stop')) stopTest()
})
document.addEventListener('pointerdown', e => {
  const handle = e.target.closest('#test-panel > header')
  if (!handle || e.target.closest('button')) return
  const p = $('test-panel')
  const rect = p.getBoundingClientRect()
  const dx = e.clientX - rect.left
  const dy = e.clientY - rect.top
  handle.setPointerCapture(e.pointerId)
  const onMove = ev => {
    const x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, ev.clientX - dx))
    const y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, ev.clientY - dy))
    p.style.left = x + 'px'
    p.style.top = y + 'px'
    p.style.right = 'auto'
    p.style.bottom = 'auto'
  }
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
})
document.addEventListener('submit', e => {
  if (e.target.id !== 'test-form') return
  e.preventDefault()
  const input = $('test-input')
  const text = input.value.trim()
  if (!text || running) return
  input.value = ''
  askLLM(text)
})
