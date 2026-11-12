// Navigation log and bounce analyzer. Pure ES module.
export const DEFAULTS = { quickMs: 30000, threshold: 0.15, minVisits: 10, max: 500 }

export function createNavLog ({ now = () => Date.now(), max = DEFAULTS.max } = {}) {
  let entries = []
  const limit = Math.max(1, typeof max === 'number' && Number.isFinite(max) ? Math.floor(max) : DEFAULTS.max)

  function visit (screen) {
    if (typeof screen !== 'string' || !screen || screen.length > 60) return
    if (entries.length > 0 && entries[entries.length - 1].screen === screen) return
    entries.push({ screen, at: now() })
    if (entries.length > limit) {
      entries.shift()
    }
  }

  function report (opts) {
    opts = opts && typeof opts === 'object' ? opts : {}
    const quickMs = opts.quickMs ?? DEFAULTS.quickMs
    const threshold = opts.threshold ?? DEFAULTS.threshold
    const minVisits = opts.minVisits ?? DEFAULTS.minVisits

    const visitsMap = new Map()
    for (const e of entries) {
      visitsMap.set(e.screen, (visitsMap.get(e.screen) || 0) + 1)
    }

    const bouncesMap = new Map()
    const partnerCounts = new Map()
    const partnerFirstSeen = new Map()

    for (let i = 0; i + 2 < entries.length; i++) {
      const e1 = entries[i]
      const e2 = entries[i + 1]
      const e3 = entries[i + 2]
      const s = e1.screen
      const x = e2.screen

      if (e3.screen === s && x !== s && (e3.at - e1.at) <= quickMs) {
        bouncesMap.set(s, (bouncesMap.get(s) || 0) + 1)
        if (!partnerCounts.has(s)) {
          partnerCounts.set(s, new Map())
          partnerFirstSeen.set(s, new Map())
        }
        const counts = partnerCounts.get(s)
        const firstSeen = partnerFirstSeen.get(s)
        counts.set(x, (counts.get(x) || 0) + 1)
        if (!firstSeen.has(x)) {
          firstSeen.set(x, i)
        }
      }
    }

    const res = []
    for (const [screen, visits] of visitsMap.entries()) {
      if (visits < minVisits) continue
      const bounces = bouncesMap.get(screen) || 0
      const ratio = Math.round((bounces / visits) * 100) / 100
      if (ratio < threshold) continue

      let partner = null
      const counts = partnerCounts.get(screen)
      const firstSeen = partnerFirstSeen.get(screen)

      if (counts && counts.size > 0) {
        let maxCount = -1
        let bestSeen = Infinity
        for (const [p, cnt] of counts.entries()) {
          const seenIndex = firstSeen.get(p)
          if (cnt > maxCount || (cnt === maxCount && seenIndex < bestSeen)) {
            maxCount = cnt
            bestSeen = seenIndex
            partner = p
          }
        }
      }

      res.push({ screen, visits, bounces, ratio, partner })
    }

    res.sort((a, b) => {
      if (b.ratio !== a.ratio) return b.ratio - a.ratio
      return b.visits - a.visits
    })

    return res
  }

  function exportEntries () {
    return entries.map(e => ({ ...e }))
  }

  function importEntries (list) {
    if (!Array.isArray(list)) return
    const valid = []
    for (const item of list) {
      if (item && typeof item.screen === 'string' && item.screen.length > 0 && item.screen.length <= 60 && typeof item.at === 'number' && Number.isFinite(item.at)) {
        valid.push({ screen: item.screen, at: item.at })
      }
    }
    entries = valid.slice(-limit)
  }

  function clear () {
    entries = []
  }

  return {
    visit,
    report,
    export: exportEntries,
    import: importEntries,
    clear
  }
}
