/* global idb, IDBKeyRange, AbortController, searchForm, searchInput, resultsContainer */

const HISTORY_DB = 'history'
const HISTORY_VERSION = 1

const HISTORY_STORE = 'navigated'
const MAX_RESULTS = 256

const SEARCH_DELAY = 100

const db = await idb.openDB(HISTORY_DB, HISTORY_VERSION)

let aborter = null

window.db = db
window.search = search
window.deleteHistoryItem = deleteHistoryItem

console.log(`
Try this:
for await(const item of search("ex")) {
  console.log(item)
}
`)

let searchTimeout = null
let currentRange = 'all'

searchAndRender()

const timeFilter = document.getElementById('timeFilter')
const deleteRangeBtn = document.getElementById('deleteRangeBtn')
const deleteAllBtn = document.getElementById('deleteAllBtn')

if (timeFilter) {
  timeFilter.onchange = () => {
    currentRange = timeFilter.value || 'all'
    updateDeleteRangeState()
    searchAndRender()
  }
}

if (deleteAllBtn) {
  deleteAllBtn.onclick = async () => {
    if (confirm('Delete all history?')) {
      await db.clear(HISTORY_STORE)
      await searchAndRender()
    }
  }
}

if (deleteRangeBtn) {
  deleteRangeBtn.onclick = async () => {
    if (currentRange === 'all') return
    const label = getRangeLabel(currentRange)
    if (confirm(`Delete history for ${label}?`)) {
      const since = getRangeStart(currentRange)
      await deleteHistoryRange(since)
      await searchAndRender()
    }
  }
}

updateDeleteRangeState()

searchForm.onchange = () => {
  devouncedSearch()
}
searchForm.onsubmit = (e) => {
  e.preventDefault()
  searchAndRender()
}

function devouncedSearch () {
// Inefficient debounce 🤷
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(searchAndRender, SEARCH_DELAY)
}

function getRangeLabel (range) {
  if (range === 'day') return 'the last 24 hours'
  if (range === 'week') return 'the last 7 days'
  if (range === 'month') return 'the last 30 days'
  return 'all time'
}

function getRangeStart (range) {
  const now = Date.now()
  if (range === 'day') return now - 24 * 60 * 60 * 1000
  if (range === 'week') return now - 7 * 24 * 60 * 60 * 1000
  if (range === 'month') return now - 30 * 24 * 60 * 60 * 1000
  return 0
}

function updateDeleteRangeState () {
  if (!deleteRangeBtn) return
  const label = getRangeLabel(currentRange)
  deleteRangeBtn.textContent = currentRange === 'all' ? 'Delete Period' : `Delete ${label}`
  deleteRangeBtn.disabled = currentRange === 'all'
}

async function searchAndRender () {
  const searchTerm = searchInput.value.trim() || ' .*'
  const since = getRangeStart(currentRange)
  resultsContainer.innerHTML = ''
  for await (const { url, host, pathname, title, id } of search(searchTerm, MAX_RESULTS, undefined, { since })) {
    const tr = document.createElement('tr')
    const sanitizedTitle = sanitizeHTML(title)
    const sanitizedURL = sanitizeHTML(host) + sanitizeHTML(pathname.slice(0, 32))
    tr.innerHTML = `
        <td>
          <button title="Delete this item">❌</button>
        </td>
        <td title="${sanitizedTitle}">${sanitizedTitle.slice(0, 32)}</td>
        <td>
          <a href="${new URL(url).href}">${sanitizedURL}</a>
        </td>
    `
    tr.querySelector('button').onclick = () => {
      deleteHistoryItem(id)
    }
    resultsContainer.appendChild(tr)
  }
}

async function deleteHistoryItem (id) {
  console.log('Deleting', id)
  await db.delete(HISTORY_STORE, id)
  searchAndRender()
}

async function deleteHistoryRange (since) {
  const now = Date.now()
  const tx = db.transaction(HISTORY_STORE, 'readwrite')
  const index = tx.store.index('timestamp')
  const range = since ? IDBKeyRange.bound(since, now) : IDBKeyRange.upperBound(now)
  let cursor = await index.openCursor(range, 'prev')
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

const sanitizeItem = document.createElement('span')
function sanitizeHTML (string) {
  sanitizeItem.innerText = string
  return sanitizeItem.innerHTML
}

async function * search (query = '', maxResults = MAX_RESULTS, _signal, options = {}) {
  let signal = _signal
  if (!signal) {
    if (aborter) aborter.abort()
    aborter = new AbortController()
    signal = aborter.signal
  }
  let sent = 0
  const seen = new Set()

  const regexText = query.split(' ').reduce((result, letter) => `${result}.*${letter}`, '')
  const filter = new RegExp(regexText, 'iu')

  const index = db.transaction(HISTORY_STORE, 'readonly').store.index('timestamp')
  const start = Date.now()
  const since = Number.isFinite(options?.since) ? options.since : 0
  const range = since ? IDBKeyRange.bound(since, start) : IDBKeyRange.upperBound(start)
  const iterator = index.iterate(range, 'prev')

  for await (const { value } of iterator) {
    if (signal && signal.aborted) {
      console.debug('Aborted search')
      break
    }
    const { search: searchString, url } = value
    if (searchString.match(filter)) {
      if (seen.has(url)) continue
      seen.add(url)
      yield value
      sent++
      if (sent >= maxResults) break
    }
  }
}
