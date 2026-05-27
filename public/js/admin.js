// Cargar datos al abrir la página
loadActivePlaylist()
loadMyPlaylists()

// ─── PLAYLIST ACTIVA ──────────────────────────────────────────────────────────

async function loadActivePlaylist() {
  const res = await fetch('/admin/active-playlist')
  const data = await res.json()

  const container = document.getElementById('activePlaylist')

  if (!data.id) {
    container.innerHTML = '<p class="empty">No hay playlist activa. Selecciona una abajo.</p>'
    return
  }

  container.innerHTML = `
    <div class="active-playlist-box">
      ${data.image
        ? `<img src="${data.image}" alt="${data.name}">`
        : `<div class="no-image">🎵</div>`
      }
      <div class="active-info">
        <div class="active-name">${data.name}</div>
        <div class="active-meta">${data.total} canciones disponibles para clientes</div>
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

// ─── BUSCAR PLAYLISTS ─────────────────────────────────────────────────────────

async function searchPlaylists() {
  const q = document.getElementById('searchInput').value.trim()
  if (!q) return

  const res = await fetch(`/admin/search-playlists?q=${encodeURIComponent(q)}`)
  const playlists = await res.json()

  renderPlaylists(playlists, 'searchResults')
}

function renderPlaylists(playlists, containerId) {
  const container = document.getElementById(containerId)

  if (!playlists || playlists.length === 0) {
    container.innerHTML = '<p class="empty">No se encontraron playlists</p>'
    return
  }

  container.innerHTML = playlists.map(pl => `
    <div class="playlist-card">
      ${pl.image
        ? `<img src="${pl.image}" alt="${pl.name}">`
        : `<div class="no-image">🎵</div>`
      }
      <div class="playlist-info">
        <div class="playlist-name">${pl.name}</div>
        <div class="playlist-meta">
          ${pl.owner ? pl.owner + ' · ' : ''}${pl.total} canciones
        </div>
      </div>
      <button onclick="activatePlaylist('${pl.id}', '${escape(pl.name)}', '${pl.image || ''}')">
        Activar
      </button>
    </div>
  `).join('')
}

// ─── ACTIVAR PLAYLIST ─────────────────────────────────────────────────────────

async function activatePlaylist(id, name, image) {
  showStatus('Cargando canciones...')

  const res = await fetch('/admin/activate-playlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: unescape(name), image })
  })

  const data = await res.json()

  if (res.ok) {
    showStatus(`✅ Playlist activada — ${data.total} canciones`)
    loadActivePlaylist()
  } else {
    showStatus('❌ ' + data.error, true)
  }
}

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function showStatus(msg, isError = false) {
  const el = document.getElementById('status')
  el.textContent = msg
  el.className = isError ? 'error' : ''
  el.style.display = 'block'
  setTimeout(() => el.style.display = 'none', 3000)
}

document.getElementById('searchInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') searchPlaylists()
})

// ─── BUSCAR CANCIONES SUELTAS ─────────────────────────────────────────────────

async function searchSongs() {
  const q = document.getElementById('songSearchInput').value.trim()
  if (!q) return

  const res = await fetch(`/admin/search?q=${encodeURIComponent(q)}`)
  const songs = await res.json()

  const container = document.getElementById('songSearchResults')

  if (!songs || songs.length === 0) {
    container.innerHTML = '<p class="empty">No se encontraron canciones</p>'
    return
  }

  container.innerHTML = songs.map(song => `
    <div class="playlist-card">
      ${song.image
        ? `<img src="${song.image}" alt="${song.name}">`
        : `<div class="no-image">🎵</div>`
      }
      <div class="playlist-info">
        <div class="playlist-name">${song.name}</div>
        <div class="playlist-meta">${song.artist} · ${song.album}</div>
      </div>
      <button onclick="addSong('${song.id}', '${escape(song.name)}', '${escape(song.artist)}', '${escape(song.album)}', '${song.image || ''}')">
        + Agregar
      </button>
    </div>
  `).join('')
}

async function addSong(id, name, artist, album, image) {
  const res = await fetch('/admin/add-song', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      name: unescape(name),
      artist: unescape(artist),
      album: unescape(album),
      image
    })
  })

  const data = await res.json()
  if (res.ok) {
    showStatus('✅ Canción agregada a la lista')
    loadActivePlaylist()
  } else {
    showStatus('⚠️ ' + data.error, true)
  }
}

document.getElementById('songSearchInput').addEventListener('keypress', e => {
  if (e.key === 'Enter') searchSongs()
})