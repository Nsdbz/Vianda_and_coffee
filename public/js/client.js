let allSongs = []
let isRequesting = false
let totalVotes = 0
 
// ── CLIENT ID ──────────────────────────────────────────────────────────────────
function getClientId() {
  let id = localStorage.getItem('vianda_client_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('vianda_client_id', id)
  }
  return id
}
 
// ── INIT ───────────────────────────────────────────────────────────────────────
loadSongs()
refreshNowPlaying()
refreshQueue()
 
// Polling: now playing cada 15s, cola cada 20s
setInterval(refreshNowPlaying, 15000)
setInterval(refreshQueue, 20000)
 
document.getElementById('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; filterSongs() }
})
 
// ── CANCIONES ─────────────────────────────────────────────────────────────────
async function loadSongs() {
  try {
    const res = await fetch('/songs')
    allSongs = await res.json()
    renderSongs(allSongs)
  } catch (e) {
    document.getElementById('songList').innerHTML =
      '<p class="no-results">Error cargando canciones</p>'
  }
}
 
function renderSongs(songs) {
  const container = document.getElementById('songList')
 
  if (!songs.length) {
    container.innerHTML = '<p class="no-results">No hay canciones disponibles</p>'
    return
  }
 
  container.innerHTML = songs.map((s, i) => {
    const coverHTML = s.image
      ? `<img src="${s.image}" alt="${s.name}">`
      : `<svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="rgba(212,164,62,0.3)" stroke-width="1"><path d="M9 19V6l12-3v13M9 19c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zm12-3c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2z"/></svg>`
 
    return `
    <div class="song-item">
      <span class="song-num">${String(i + 1).padStart(2, '0')}</span>
      <div class="song-cover ${s.image ? '' : 'placeholder'}">${coverHTML}</div>
      <div class="song-info">
        <p class="song-title">${s.name}</p>
        <p class="song-artist">${s.artist}</p>
      </div>
      <button class="req-btn" data-id="${s.id}" onclick="addToQueue('${s.id}', this)">
        <span>+ Pedir</span>
      </button>
    </div>`
  }).join('')
}
 
function filterSongs() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim()
  renderSongs(q
    ? allSongs.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q))
    : allSongs)
}
 
// ── PEDIR CANCIÓN ─────────────────────────────────────────────────────────────
async function addToQueue(id, btn) {
  if (isRequesting) return
 
  isRequesting = true
  const allBtns = document.querySelectorAll('.req-btn')
  allBtns.forEach(b => b.disabled = true)
  btn.querySelector('span').textContent = '…'
 
  try {
    const res = await fetch('/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, clientId: getClientId() })
    })
 
    const data = await res.json()
 
    if (res.ok) {
      btn.classList.add('done')
      btn.querySelector('span').textContent = 'Pedida ✓'
      totalVotes++
      document.getElementById('totalVotes').textContent = totalVotes
      showToast(`🎵 ¡Canción agregada a la cola!`)
      // Refrescar cola tras 2s para que aparezca
      setTimeout(refreshQueue, 2000)
    } else {
      btn.querySelector('span').textContent = '+ Pedir'
      showToast(data.error, true)
    }
  } catch (e) {
    btn.querySelector('span').textContent = '+ Pedir'
    showToast('Error de conexión', true)
  } finally {
    isRequesting = false
    allBtns.forEach(b => {
      if (!b.classList.contains('done')) b.disabled = false
    })
  }
}
 
// ── NOW PLAYING ───────────────────────────────────────────────────────────────
async function refreshNowPlaying() {
  try {
    const res = await fetch('/now-playing')
    const data = await res.json()
 
    const titleEl  = document.getElementById('nowTitle')
    const artistEl = document.getElementById('nowArtist')
    const imgEl    = document.getElementById('nowImg')
 
    if (data.playing && data.name) {
      titleEl.textContent  = data.name
      artistEl.textContent = data.artist
      if (data.image) {
        imgEl.src = data.image
        imgEl.style.display = 'block'
      }
    } else {
      titleEl.textContent  = 'Sin reproducción activa'
      artistEl.textContent = '—'
      imgEl.style.display  = 'none'
    }
  } catch (e) {
    // silencioso — no interrumpir UX
  }
}
 
// ── COLA REAL ─────────────────────────────────────────────────────────────────
async function refreshQueue() {
  try {
    const res = await fetch('/queue-list')
    const items = await res.json()
 
    const ul = document.getElementById('queueList')
    const countEl = document.getElementById('queueCount')
    const qCountEl = document.getElementById('qCount')
 
    if (!items.length) {
      ul.innerHTML = '<li class="qi-empty">La cola está vacía</li>'
      countEl.textContent = '—'
      qCountEl.textContent = '0'
      return
    }
 
    countEl.textContent = items.length + (items.length === 1 ? ' canción' : ' canciones')
    qCountEl.textContent = items.length
 
    ul.innerHTML = items.map((s, i) => {
      const isFirst = i === 0
      const artHTML = s.image
        ? `<img src="${s.image}" alt="">`
        : `<svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="rgba(212,164,62,0.3)" stroke-width="1"><path d="M9 19V6l12-3v13M9 19c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2zm12-3c0 1.1-1.34 2-3 2s-3-.9-3-2 1.34-2 3-2 3 .9 3 2z"/></svg>`
 
      return `
      <li class="qi${isFirst ? ' active' : ''}">
        ${isFirst
          ? `<div class="mwrap"><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div><div class="mb"></div></div>`
          : `<span class="qi-num">${i + 1}</span>`}
        <div class="qi-art ${s.image ? '' : 'placeholder'}">${artHTML}</div>
        <div class="qi-info">
          <p class="qi-t">${s.name}</p>
          <p class="qi-a">${s.artist}</p>
        </div>
        ${isFirst ? '<span class="qi-badge">Ahora</span>' : ''}
      </li>`
    }).join('')
  } catch (e) {
    // silencioso
  }
}
 
// ── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const t = document.getElementById('toastEl')
  t.textContent = msg
  t.className = isError ? 'toast error show' : 'toast show'
  clearTimeout(t._timer)
  t._timer = setTimeout(() => t.classList.remove('show'), 2800)
}