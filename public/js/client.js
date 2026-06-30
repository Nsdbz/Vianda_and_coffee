// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
 
let allSongs = []
let isRequesting = false
 
// ─── IDENTIFICACIÓN DEL CLIENTE ───────────────────────────────────────────────
// Genera un ID único por dispositivo y lo guarda en localStorage.
// Sirve para el límite de 15 minutos y para limitar sugerencias pendientes.
 
function getClientId() {
  let id = localStorage.getItem('vianda_client_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('vianda_client_id', id)
  }
  return id
}

// Registra una visita a la página (para las estadísticas del admin).
// No bloquea ni afecta nada visible; si falla, no pasa nada.
function registerVisit() {
  fetch('/visit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: getClientId() })
  }).catch(() => {})
}
 
// ─── CARGA Y RENDER DE CANCIONES ──────────────────────────────────────────────
 
async function loadSongs() {
  try {
    const res = await fetch('/songs')
    allSongs = await res.json()
    renderSongs(allSongs)
  } catch (e) {
    document.getElementById('songList').innerHTML = '<p style="color:#888;text-align:center;padding:20px">Error cargando canciones</p>'
  }
}
 
function renderSongs(songs) {
  const el = document.getElementById('songList')
  if (!songs.length) {
    el.innerHTML = '<p style="color:#888;text-align:center;padding:20px">No hay canciones disponibles</p>'
    return
  }
  el.innerHTML = songs.map(s => `
    <div class="song-item">
      ${s.image ? `<img class="s-img" src="${s.image}" alt="${s.name}">` : '<div class="s-img s-img-ph">♪</div>'}
      <div class="s-info">
        <div class="s-name">${s.name}</div>
        <div class="s-artist">${s.artist}</div>
      </div>
      <button class="req-btn" onclick="addToQueue('${s.id}', this)">+ Pedir</button>
    </div>
  `).join('')
}
 
// ─── BÚSQUEDA INTELIGENTE (normalización + tokens + fuzzy + scoring) ──────────
// 1) Normaliza texto: quita tildes, minúsculas, limpia signos.
// 2) Compara por tokens (palabras), no por substring completo → el orden no importa.
// 3) Si una palabra no aparece exacta, prueba fuzzy (distancia de Levenshtein)
//    para tolerar errores de tipeo.
// 4) Da un puntaje a cada canción y ordena los mejores resultados primero.

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes/diacríticos
    .replace(/[^a-z0-9\s]/g, ' ')                       // quita signos de puntuación
    .replace(/\s+/g, ' ')
    .trim()
}

// Distancia de Levenshtein (mínimo de ediciones para convertir a en b)
function levenshtein(a, b) {
  const la = a.length, lb = b.length
  if (la === 0) return lb
  if (lb === 0) return la
  let prevRow = new Array(lb + 1)
  for (let j = 0; j <= lb; j++) prevRow[j] = j

  for (let i = 1; i <= la; i++) {
    const currRow = [i]
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      currRow[j] = Math.min(
        prevRow[j] + 1,      // eliminación
        currRow[j - 1] + 1,  // inserción
        prevRow[j - 1] + cost // sustitución
      )
    }
    prevRow = currRow
  }
  return prevRow[lb]
}

// ¿Qué tan bien matchea una palabra de búsqueda (token) contra una palabra del texto?
// Devuelve un puntaje > 0 si hay match aceptable, o 0 si no hay match.
function tokenMatchScore(token, word) {
  if (!token || !word) return 0
  if (word === token) return 100                 // coincidencia exacta
  if (word.startsWith(token)) return 80           // empieza igual (autocompletado natural)
  if (word.includes(token)) return 60             // está contenida en algún lugar

  // Fuzzy: tolera typos, pero solo en palabras razonablemente parecidas en longitud
  const maxLen = Math.max(token.length, word.length)
  if (maxLen < 3) return 0 // palabras muy cortas: evita falsos positivos
  const dist = levenshtein(token, word)
  const allowedErrors = token.length <= 4 ? 1 : token.length <= 7 ? 2 : 3
  if (dist <= allowedErrors) {
    return Math.max(10, 50 - dist * 15) // mientras menos errores, mejor puntaje
  }
  return 0
}

// Puntaje total de una canción contra la consulta completa.
// Cada palabra escrita por el usuario debe encontrar AL MENOS una buena
// coincidencia en el nombre o el artista (así "rhapsody bohemian" encuentra
// "Bohemian Rhapsody" sin importar el orden de las palabras).
function scoreSong(song, queryTokens) {
  const nameNorm = normalizeText(song.name)
  const artistNorm = normalizeText(song.artist)
  const nameWords = nameNorm.split(' ').filter(Boolean)
  const artistWords = artistNorm.split(' ').filter(Boolean)

  let total = 0

  for (const qt of queryTokens) {
    let best = 0

    // Bonus extra si el título completo empieza exactamente con el query token
    if (nameNorm.startsWith(qt)) best = Math.max(best, 90)

    for (const w of nameWords) best = Math.max(best, tokenMatchScore(qt, w))
    for (const w of artistWords) best = Math.max(best, tokenMatchScore(qt, w) * 0.85) // artista pesa un poco menos que el título

    if (best === 0) return 0 // si una palabra del query no matchea nada, la canción queda descartada
    total += best
  }

  return total
}

function filterSongs() {
  const raw = document.getElementById('searchInput').value
  const q = normalizeText(raw)

  if (!q) { renderSongs(allSongs); return }

  const queryTokens = q.split(' ').filter(Boolean)

  const scored = allSongs
    .map(song => ({ song, score: scoreSong(song, queryTokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)

  renderSongs(scored.map(item => item.song))
}
 
// ─── PEDIR CANCIÓN ────────────────────────────────────────────────────────────
 
async function addToQueue(id, btn) {
  if (isRequesting) return
  isRequesting = true
 
  // Deshabilitar todos los botones mientras dura la petición
  document.querySelectorAll('.req-btn').forEach(b => b.disabled = true)
  const original = btn.textContent
  btn.textContent = '…'
 
  try {
    const res = await fetch('/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, clientId: getClientId() })
    })
    const data = await res.json()
 
    if (data.ok) {
      btn.textContent = '✓'
      btn.classList.add('done')
      showToast('¡Canción agregada a la cola! 🎵')
      // Actualizar cola luego de 2 segundos
      setTimeout(refreshQueue, 2000)
    } else {
      btn.textContent = original
      showToast(data.error, true)
    }
  } catch (e) {
    btn.textContent = original
    showToast('Error de conexión', true)
  } finally {
    isRequesting = false
    document.querySelectorAll('.req-btn:not(.done)').forEach(b => b.disabled = false)
  }
}
 
// ─── NOW PLAYING ──────────────────────────────────────────────────────────────
 
async function refreshNowPlaying() {
  try {
    const res = await fetch('/now-playing')
    const data = await res.json()
    const titleEl = document.getElementById('nowTitle')
    const artistEl = document.getElementById('nowArtist')
    const imgEl = document.getElementById('nowImg')
    const block = document.getElementById('nowBlock')
 
    if (data.playing && data.name) {
      titleEl.textContent = data.name
      artistEl.textContent = data.artist
      if (data.image) {
        imgEl.src = data.image
        imgEl.style.display = 'block'
      }
      block.classList.add('is-playing')
    } else {
      titleEl.textContent = 'Sin reproducción'
      artistEl.textContent = '—'
      imgEl.style.display = 'none'
      block.classList.remove('is-playing')
    }
  } catch (e) {}
}
 
// ─── COLA ─────────────────────────────────────────────────────────────────────
 
async function refreshQueue() {
  try {
    const res = await fetch('/queue-list')
    const items = await res.json()
    const fullSection = document.getElementById('fullQueueSection')
    const nextEl = document.getElementById('nextTrack')
    const fabCount = document.getElementById('fabCount')
    const qCount = document.getElementById('qCount')
 
    if (fabCount) fabCount.textContent = items.length > 0 ? items.length : ''
    if (qCount) qCount.textContent = items.length
 
    // Bloque "Próxima": siempre muestra queue[0]
    if (items.length > 0) {
      const next = items[0]
      nextEl.className = 'qi next-track'
      nextEl.innerHTML = `
        ${next.image ? `<img src="${next.image}" alt="${next.name}">` : '<div class="qi-ph">♪</div>'}
        <div class="qi-info">
          <div class="qi-name">${next.name}</div>
          <div class="qi-artist">${next.artist}</div>
        </div>
      `
    } else {
      nextEl.className = 'next-track-empty'
      nextEl.textContent = 'Sin canciones en cola'
    }
 
    // Cola completa siempre oculta
    if (fullSection) fullSection.style.display = 'none'
  } catch (e) {}
}
 
function scrollToQueue() {
  document.getElementById('queuePanel')?.scrollIntoView({ behavior: 'smooth' })
}
 
// ─── MODAL DE SUGERENCIAS ─────────────────────────────────────────────────────
// El cliente puede buscar una canción en Spotify y sugerirla al admin.
// Flujo: abrir modal → buscar → seleccionar → enviar sugerencia
 
let suggestSearchResults = []
 
function openSuggestModal() {
  document.getElementById('suggestModal').classList.add('open')
  document.getElementById('suggestSearchInput').focus()
  document.getElementById('suggestResults').innerHTML = ''
  document.getElementById('suggestSearchInput').value = ''
  document.getElementById('suggestStatus').textContent = ''
}
 
function closeSuggestModal() {
  document.getElementById('suggestModal').classList.remove('open')
}
 
// Buscar canciones en Spotify (usa el mismo endpoint del admin)
async function searchSuggestSongs() {
  const q = document.getElementById('suggestSearchInput').value.trim()
  if (!q) return
 
  const el = document.getElementById('suggestResults')
  el.innerHTML = '<p class="suggest-loading">Buscando…</p>'
 
  try {
    const res = await fetch(`/admin/search?q=${encodeURIComponent(q)}`)
    const tracks = await res.json()
    suggestSearchResults = tracks
 
    if (!tracks.length) {
      el.innerHTML = '<p class="suggest-empty">No se encontraron canciones.</p>'
      return
    }
 
    el.innerHTML = tracks.map((t, i) => `
      <div class="suggest-track" onclick="selectSuggestTrack(${i})">
        ${t.image ? `<img src="${t.image}" alt="${t.name}">` : '<div class="s-img-ph">♪</div>'}
        <div class="suggest-track-info">
          <div class="suggest-track-name">${t.name}</div>
          <div class="suggest-track-artist">${t.artist} · ${t.album}</div>
        </div>
        <span class="suggest-select-btn">Sugerir</span>
      </div>
    `).join('')
  } catch (e) {
    el.innerHTML = '<p class="suggest-empty">Error buscando canciones.</p>'
  }
}
 
// Envía la sugerencia seleccionada al servidor
async function selectSuggestTrack(index) {
  const track = suggestSearchResults[index]
  if (!track) return
 
  const statusEl = document.getElementById('suggestStatus')
  statusEl.textContent = 'Enviando sugerencia…'
  statusEl.className = 'suggest-status'
 
  try {
    const res = await fetch('/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trackId: track.id,
        name: track.name,
        artist: track.artist,
        album: track.album,
        image: track.image,
        clientId: getClientId()
      })
    })
    const data = await res.json()
 
    if (data.ok) {
      statusEl.textContent = '✓ ' + data.message
      statusEl.className = 'suggest-status ok'
      // Cerrar el modal después de 2 segundos
      setTimeout(closeSuggestModal, 2000)
    } else {
      statusEl.textContent = data.error
      statusEl.className = 'suggest-status error'
    }
  } catch (e) {
    statusEl.textContent = 'Error de conexión'
    statusEl.className = 'suggest-status error'
  }
}
 
// Cerrar modal al hacer click fuera
document.addEventListener('click', e => {
  const modal = document.getElementById('suggestModal')
  if (modal && e.target === modal) closeSuggestModal()
})
 
// Buscar con Enter en el modal
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('suggestSearchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchSuggestSongs()
  })
})
 
// ─── TOAST ────────────────────────────────────────────────────────────────────
 
function showToast(msg, isError = false) {
  const el = document.getElementById('toastEl')
  el.textContent = msg
  el.className = 'toast show' + (isError ? ' error' : '')
  setTimeout(() => el.classList.remove('show'), 2800)
}
 
// ─── POLLING ──────────────────────────────────────────────────────────────────
 
setInterval(refreshNowPlaying, 15000)
setInterval(refreshQueue, 20000)
 
// ─── INICIO ───────────────────────────────────────────────────────────────────
 
loadSongs()
refreshNowPlaying()
refreshQueue()
registerVisit()