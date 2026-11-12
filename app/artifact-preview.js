// Workspace HTML is rendered in an opaque-origin frame, never in the app document.
export const MAX_HTML_BYTES = 2 * 1024 * 1024
export const ARTIFACT_SANDBOX = 'allow-scripts'
const CLOSE_MESSAGE = 'vespr-artifact-close'
const POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const ESCAPE_RELAY = `<script>document.addEventListener('keydown',function(e){if(e.key==='Escape'){e.preventDefault();parent.postMessage({type:'${CLOSE_MESSAGE}'},'*')}},true)<\/script>`

export function isHtmlArtifact (name, kind = '') {
  return typeof name === 'string' && (/\.html?$/i.test(name) || String(kind).toLowerCase() === 'html')
}

export function artifactDocument (html) {
  if (typeof html !== 'string' || html.includes('\0')) throw new TypeError('This file is not HTML text.')
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) throw new RangeError('This HTML file is too large for inline preview.')
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${POLICY}">${ESCAPE_RELAY}</head><body>${html}</body></html>`
}

let sequence = 0
export class ArtifactPreview {
  constructor (doc = document) {
    this.document = doc
    this.window = doc.defaultView
    const make = (tag, className, text) => {
      const node = doc.createElement(tag)
      node.className = className
      if (text) node.textContent = text
      return node
    }
    const dialog = this.dialog = make('dialog', 'artifact-preview')
    const header = make('header', 'artifact-preview-header')
    const titles = make('div', 'artifact-preview-titles')
    const label = make('span', 'artifact-preview-label', 'HTML preview')
    this.title = make('h2', 'artifact-preview-title')
    this.title.id = 'artifact-preview-title-' + (++sequence)
    dialog.setAttribute('aria-labelledby', this.title.id)
    titles.append(label, this.title)
    const actions = make('div', 'artifact-preview-actions')
    this.sourceButton = make('button', 'artifact-preview-source', 'View source')
    this.sourceButton.type = 'button'
    this.closeButton = make('button', 'artifact-preview-close', '×')
    this.closeButton.type = 'button'
    this.closeButton.setAttribute('aria-label', 'Close preview')
    actions.append(this.sourceButton, this.closeButton)
    header.append(titles, actions)
    this.stage = make('div', 'artifact-preview-stage')
    this.note = make('p', 'artifact-preview-note')
    dialog.append(header, this.stage, this.note)
    doc.body.append(dialog)
    this.closeButton.addEventListener('click', () => this.close())
    this.sourceButton.addEventListener('click', () => {
      const callback = this.onSource
      this.close(false)
      callback?.()
    })
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close() })
    dialog.addEventListener('close', () => { if (!dialog.open) this.clear() })
    dialog.addEventListener('keydown', event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); this.close() }
    })
    dialog.addEventListener('click', event => {
      event.stopPropagation()
      const rect = dialog.getBoundingClientRect()
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) this.close()
    })
    this.onMessage = event => {
      // The child can request only closing its own preview. No command/data bridge.
      if (dialog.open && this.frame && event.source === this.frame.contentWindow && event.origin === 'null' && event.data?.type === CLOSE_MESSAGE) this.close()
    }
    this.window.addEventListener('message', this.onMessage)
  }

  open ({ name, html, onSource, sourceLabel = 'View source', note = 'Preview of the saved workspace file.' }) {
    const content = artifactDocument(html)
    const opener = this.dialog.open ? this.previousFocus : this.document.activeElement
    this.close(false)
    this.previousFocus = opener
    this.title.textContent = String(name || 'HTML artifact')
    this.title.title = this.title.textContent
    this.note.textContent = note
    this.onSource = typeof onSource === 'function' ? onSource : null
    this.sourceButton.hidden = !this.onSource
    this.sourceButton.textContent = sourceLabel
    const frame = this.frame = this.document.createElement('iframe')
    frame.title = 'HTML artifact preview'
    frame.setAttribute('sandbox', ARTIFACT_SANDBOX)
    frame.setAttribute('referrerpolicy', 'no-referrer')
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'")
    frame.srcdoc = content
    this.stage.append(frame)
    this.dialog.showModal()
    this.closeButton.focus()
  }

  clear (restoreFocus = true) {
    this.frame?.remove()
    this.frame = null
    this.onSource = null
    const previous = this.previousFocus
    this.previousFocus = null
    if (restoreFocus && previous?.isConnected) previous.focus()
  }

  close (restoreFocus = true) {
    if (this.dialog.open) this.dialog.close()
    this.clear(restoreFocus)
  }

  destroy () {
    this.close()
    this.window.removeEventListener('message', this.onMessage)
    this.dialog.remove()
  }
}
