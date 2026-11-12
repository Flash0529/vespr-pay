// Visual highlighting only. Editing, selection, permissions and storage stay on the textarea.
import { highlight, MAX_CODE_LEN } from './highlight.js'
const mounted = new WeakMap()
export function codeMarkup (text) {
  if (typeof text !== 'string' || text.length > MAX_CODE_LEN || text.includes('\0')) return null
  return highlight(text) + '\n'
}
export function colorizeTextarea (input) {
  if (!input?.isConnected || !input.closest('.syntax-editor')) return null
  if (mounted.has(input)) return mounted.get(input)
  const paint = input.ownerDocument.createElement('pre')
  paint.className = 'syntax-paint'
  paint.setAttribute('aria-hidden', 'true')
  input.before(paint)
  const syncScroll = () => { paint.scrollTop = input.scrollTop; paint.scrollLeft = input.scrollLeft }
  const measure = () => { paint.style.width = input.clientWidth + 'px'; paint.style.height = input.clientHeight + 'px'; syncScroll() }
  const render = () => {
    const markup = codeMarkup(input.value)
    paint.hidden = markup === null
    input.classList.toggle('syntax-ready', markup !== null)
    // highlight() escapes every token; raw input is never assigned as markup.
    paint.innerHTML = markup === null ? '' : markup
    measure()
  }
  input.addEventListener('input', render)
  input.addEventListener('scroll', syncScroll)
  const Observer = input.ownerDocument.defaultView.ResizeObserver
  const observer = Observer ? new Observer(() => { if (input.isConnected) measure(); else handle.destroy() }) : null
  const handle = { render, destroy () {
    input.removeEventListener('input', render); input.removeEventListener('scroll', syncScroll)
    observer?.disconnect(); input.classList.remove('syntax-ready'); paint.remove(); mounted.delete(input)
  } }
  mounted.set(input, handle)
  observer?.observe(input)
  render()
  return handle
}
