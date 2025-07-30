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

searchAndRender()

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

async function searchAndRender () {
  const searchTerm = searchInput.value.trim() || ' .*'
  resultsContainer.innerHTML = ''
  for await (const { url, host, pathname, title, id } of search(searchTerm)) {
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

const sanitizeItem = document.createElement('span')
function sanitizeHTML (string) {
  sanitizeItem.innerText = string
  return sanitizeItem.innerHTML
}

async function * search (query = '', maxResults = MAX_RESULTS, _signal) {
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
  const range = IDBKeyRange.upperBound(start)
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
      if (sent >= MAX_RESULTS) break
    }
  }
}
