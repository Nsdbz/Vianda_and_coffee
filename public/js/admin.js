// ─── INICIO ───────────────────────────────────────────────────────────────────
 
document.addEventListener('DOMContentLoaded', () => {
  loadActivePlaylist()
  loadMyPlaylists()
  loadStats()
  loadDailyStats()
  loadSuggestions()
 
  // Refresca sugerencias cada 30 segundos automáticamente
  setInterval(loadSuggestions, 30000)
  // Refresca stats cada 60 segundos
  setInterval(loadStats, 60000)
  // Refresca actividad diaria cada 60 segundos
  setInterval(loadDailyStats, 60000)
})
 
// ─── PLAYLIST ACTIVA ──────────────────────────────────────────────────────────
 
async function loadActivePlaylist() {
  const res = await fetch('/admin/active-playlist')
  const pl = await res.json()
  const el = document.getElementById('activePlaylist')
 
  if (!pl.id) {
    el.innerHTML = '<p class="empty-msg">No hay playlist activa. Activa una abajo.</p>'
    return
  }
 
  el.innerHTML = `
    <div class="playlist-card active-card">
      ${pl.image ? `<img src="${pl.image}" alt="${pl.name}">` : '<div class="no-img">♪</div>'}
      <div class="pl-info">
        <div class="pl-name">${pl.name}</div>
        <div class="pl-meta">${pl.total} canciones disponibles</div>
      </div>
    </div>
  `
}
 
// ─── MIS PLAYLISTS ────────────────────────────────────────────────────────────
 
async function loadMyPlaylists() {
  const res = await fetch('/admin/my-playlists')
  const playlists = await res.json()
  renderPlaylists(playlists, 'myPlaylists')
}
 
async function searchPlaylists() {
  const q = document.getElementById('searchInput').value.trim()
  if (!q) return
  document.getElementById('searchResults').innerHTML = '<p class="loading-msg">Buscando…</p>'
  const res = await fetch(`/admin/search-playlists?q=${encodeURIComponent(q)}`)
  const playlists = await res.json()
  renderPlaylists(playlists, 'searchResults')
}
 
function renderPlaylists(playlists, containerId) {
  const el = document.getElementById(containerId)
  if (!playlists.length) {
    el.innerHTML = '<p class="empty-msg">No se encontraron playlists.</p>'
    return
  }
  el.innerHTML = playlists.map(pl => `
    <div class="playlist-card">
      ${pl.image ? `<img src="${pl.image}" alt="${pl.name}">` : '<div class="no-img">♪</div>'}
      <div class="pl-info">
        <div class="pl-name">${pl.name}</div>
        <div class="pl-meta">${pl.owner ? `por ${pl.owner} · ` : ''}${pl.total || '?'} canciones</div>
      </div>
      <button class="btn-activate" onclick="activatePlaylist('${pl.id}', '${escapeAttr(pl.name)}', '${pl.image || ''}')">
        Activar
      </button>
    </div>
  `).join('')
}
 
async function activatePlaylist(id, name, image) {
  showStatus('Cargando canciones…')
  const res = await fetch('/admin/activate-playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, image })
  })
  const data = await res.json()
  if (data.ok) {
    showStatus(`✅ "${data.name}" activada — ${data.total} canciones`)
    loadActivePlaylist()
  } else {
    showStatus('❌ ' + data.error, true)
  }
}
 
// ─── BUSCAR CANCIONES SUELTAS ─────────────────────────────────────────────────
 
async function searchSongs() {
  const q = document.getElementById('songSearchInput').value.trim()
  if (!q) return
  document.getElementById('songSearchResults').innerHTML = '<p class="loading-msg">Buscando…</p>'
  const res = await fetch(`/admin/search?q=${encodeURIComponent(q)}`)
  const tracks = await res.json()
  const el = document.getElementById('songSearchResults')
  if (!tracks.length) {
    el.innerHTML = '<p class="empty-msg">No se encontraron canciones.</p>'
    return
  }
  el.innerHTML = tracks.map(t => `
    <div class="song-card">
      ${t.image ? `<img src="${t.image}" alt="${t.name}">` : '<div class="no-img">♪</div>'}
      <div class="song-info">
        <div class="song-name">${t.name}</div>
        <div class="song-meta">${t.artist} · ${t.album}</div>
      </div>
      <button class="btn-add" onclick="addSong('${t.id}', '${escapeAttr(t.name)}', '${escapeAttr(t.artist)}', '${escapeAttr(t.album)}', '${t.image || ''}')">
        + Agregar
      </button>
    </div>
  `).join('')
}
 
async function addSong(id, name, artist, album, image) {
  const res = await fetch('/admin/add-song', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, artist, album, image })
  })
  const data = await res.json()
  if (data.ok) {
    showStatus(`✅ "${name}" agregada (${data.total} canciones)`)
    loadActivePlaylist()
  } else {
    showStatus('❌ ' + data.error, true)
  }
}
 
// ─── ACTIVIDAD DIARIA ─────────────────────────────────────────────────────────
// Muestra, por día, cuántas canciones se pidieron, cuántas visitas tuvo la
// página, visitantes únicos y la tasa de conversión (visitantes que pidieron
// al menos una canción).

async function loadDailyStats() {
  try {
    const res = await fetch('/admin/daily-stats?days=14')
    const days = await res.json()
    const el = document.getElementById('dailyStats')

    if (!days.length || days.every(d => d.requests === 0 && d.visits === 0)) {
      el.innerHTML = '<p class="empty-msg">Aún no hay actividad registrada.</p>'
      return
    }

    // Máximo entre pedidas y visitas, para que ambas barras compartan la misma escala
    const max = Math.max(1, ...days.map(d => Math.max(d.requests, d.visits)))

    // Totales del período visible
    const totalRequests = days.reduce((acc, d) => acc + d.requests, 0)
    const totalVisits = days.reduce((acc, d) => acc + d.visits, 0)

    el.innerHTML = `
      <div class="daily-summary">
        <div class="daily-summary-item">
          <span class="daily-summary-num daily-num-requests">${totalRequests}</span>
          <span class="daily-summary-label">pedidas en total</span>
        </div>
        <div class="daily-summary-item">
          <span class="daily-summary-num daily-num-visits">${totalVisits}</span>
          <span class="daily-summary-label">visitas en total</span>
        </div>
      </div>
      <div class="daily-legend">
        <span class="daily-legend-item"><span class="daily-dot dot-requests"></span>Pedidas</span>
        <span class="daily-legend-item"><span class="daily-dot dot-visits"></span>Visitas</span>
      </div>
      ${days.map(d => `
        <div class="daily-row">
          <div class="daily-date">${formatDayLabel(d.date)}</div>
          <div class="daily-bars">
            <div class="daily-bar-track">
              <div class="daily-bar bar-requests" style="width:${Math.round((d.requests / max) * 100)}%"></div>
            </div>
            <div class="daily-bar-track">
              <div class="daily-bar bar-visits" style="width:${Math.round((d.visits / max) * 100)}%"></div>
            </div>
          </div>
          <div class="daily-numbers">
            <span class="daily-num daily-num-requests">${d.requests}</span>
            <span class="daily-num daily-num-visits">${d.visits}</span>
            <span class="daily-num daily-num-unique" title="Visitantes únicos">${d.uniqueVisitors}👤</span>
            <span class="daily-num daily-num-conv" title="Tasa de conversión: visitantes que pidieron una canción">${d.conversionRate}%</span>
          </div>
        </div>
      `).join('')}
    `
  } catch (e) {
    document.getElementById('dailyStats').innerHTML = '<p class="empty-msg">Error cargando actividad diaria.</p>'
  }
}

// Convierte "YYYY-MM-DD" a una etiqueta corta tipo "lun 30"
function formatDayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const dayName = date.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '')
  return `${dayName} ${d}`
}

// ─── ESTADÍSTICAS ─────────────────────────────────────────────────────────────
// Muestra el total de peticiones y el top 10 de canciones más pedidas.
 
async function loadStats() {
  try {
    const res = await fetch('/admin/stats')
    const { totalRequests, topSongs } = await res.json()
 
    // Actualizar contador total
    document.getElementById('totalRequestsCount').textContent = totalRequests
 
    const el = document.getElementById('topSongsList')
 
    if (!topSongs.length) {
      el.innerHTML = '<p class="empty-msg">Aún no hay canciones pedidas.</p>'
      return
    }
 
    // Máximo de votos (para la barra de progreso relativa)
    const max = topSongs[0].count
 
    el.innerHTML = topSongs.map((song, i) => `
      <div class="stat-row">
        <div class="stat-rank">#${i + 1}</div>
        ${song.image ? `<img class="stat-img" src="${song.image}" alt="${song.name}">` : '<div class="stat-img no-img">♪</div>'}
        <div class="stat-info">
          <div class="stat-name">${song.name}</div>
          <div class="stat-artist">${song.artist}</div>
          <div class="stat-bar-wrap">
            <div class="stat-bar" style="width: ${Math.round((song.count / max) * 100)}%"></div>
          </div>
        </div>
        <div class="stat-count">${song.count} <span>vez${song.count !== 1 ? 'es' : ''}</span></div>
      </div>
    `).join('')
  } catch (e) {
    document.getElementById('topSongsList').innerHTML = '<p class="empty-msg">Error cargando estadísticas.</p>'
  }
}
 
// ─── SUGERENCIAS ──────────────────────────────────────────────────────────────
// Carga las sugerencias pendientes y las muestra con botones Aceptar / Rechazar.
 
async function loadSuggestions() {
  try {
    const res = await fetch('/admin/suggestions')
    const suggestions = await res.json()
 
    // Actualizar badge del título
    const badge = document.getElementById('suggestionsBadge')
    badge.textContent = suggestions.length
    badge.style.display = suggestions.length > 0 ? 'inline-flex' : 'none'
 
    const el = document.getElementById('suggestionsList')
 
    if (!suggestions.length) {
      el.innerHTML = '<p class="empty-msg">No hay sugerencias pendientes.</p>'
      return
    }
 
    el.innerHTML = suggestions.map(s => `
      <div class="suggestion-card" id="sug-${s.id}">
        ${s.image ? `<img src="${s.image}" alt="${s.name}">` : '<div class="no-img">♪</div>'}
        <div class="sug-info">
          <div class="sug-name">${s.name}</div>
          <div class="sug-meta">${s.artist}${s.album ? ' · ' + s.album : ''}</div>
          <div class="sug-time">${timeAgo(s.timestamp)}</div>
        </div>
        <div class="sug-actions">
          <button class="btn-accept" onclick="acceptSuggestion('${s.id}', '${escapeAttr(s.name)}')">✓ Aceptar</button>
          <button class="btn-reject" onclick="rejectSuggestion('${s.id}')">✕ Rechazar</button>
        </div>
      </div>
    `).join('')
  } catch (e) {
    document.getElementById('suggestionsList').innerHTML = '<p class="empty-msg">Error cargando sugerencias.</p>'
  }
}
 
async function acceptSuggestion(id, name) {
  const res = await fetch(`/admin/suggestions/${id}/accept`, { method: 'POST' })
  const data = await res.json()
  if (data.ok) {
    showStatus(`✅ "${name}" agregada a la playlist`)
    loadSuggestions()
    loadActivePlaylist()
  } else {
    showStatus('❌ ' + data.error, true)
  }
}
 
async function rejectSuggestion(id) {
  const res = await fetch(`/admin/suggestions/${id}/reject`, { method: 'POST' })
  const data = await res.json()
  if (data.ok) {
    // Animar la tarjeta antes de refrescar
    const card = document.getElementById(`sug-${id}`)
    if (card) {
      card.style.opacity = '0'
      card.style.transition = 'opacity 0.3s'
    }
    setTimeout(loadSuggestions, 350)
  } else {
    showStatus('❌ ' + data.error, true)
  }
}
 
// ─── UTILIDADES ───────────────────────────────────────────────────────────────
 
function showStatus(msg, isError = false) {
  const el = document.getElementById('status')
  el.textContent = msg
  el.className = isError ? 'status error' : 'status ok'
  el.style.display = 'block'
  setTimeout(() => { el.style.display = 'none' }, 3000)
}
 
// Escapa comillas simples para usarlas en atributos onclick inline
function escapeAttr(str) {
  return (str || '').replace(/'/g, "\\'")
}
 
// Convierte un timestamp a "hace X minutos / horas"
function timeAgo(timestamp) {
  const diff = Date.now() - timestamp
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'hace un momento'
  if (mins < 60) return `hace ${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `hace ${hours} h`
  return `hace ${Math.floor(hours / 24)} días`
}
 
// Permitir buscar con Enter
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('searchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchPlaylists()
  })
  document.getElementById('songSearchInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchSongs()
  })
})