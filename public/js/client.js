let allSongs = []

// Cargar canciones al abrir la página
loadSongs()

async function loadSongs() {
  const res = await fetch('/songs')
  allSongs = await res.json()
  renderSongs(allSongs)
}
function renderSongs(songs) {
  const container = document.getElementById('songList')

  if (songs.length === 0) {
    container.innerHTML = '<p class="empty">No hay canciones disponibles por ahora.</p>'
    return
  }

  container.innerHTML = ''

  songs.forEach(song => {
    const div = document.createElement('div')
    div.className = 'song-card'
    div.innerHTML = `
      <img src="${song.image}" alt="${song.name}">
      <div class="song-info">
        <div class="song-name">${song.name}</div>
        <div class="song-artist">${song.artist}</div>
      </div>
      <button class="add-btn" onclick="addToQueue('${song.id}', this)">
        + Pedir
      </button>
    `
    container.appendChild(div)
  })
}

function filterSongs() {
  const q = document.getElementById('searchInput').value.toLowerCase().trim()
  if (!q) {
    renderSongs(allSongs)
    return
  }
  const filtered = allSongs.filter(song =>
    song.name.toLowerCase().includes(q) ||
    song.artist.toLowerCase().includes(q)
  )
  renderSongs(filtered)
}

async function addToQueue(id, btn) {
  btn.disabled = true
  btn.textContent = '...'

  const res = await fetch('/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  })

  const data = await res.json()

  if (res.ok) {
    btn.textContent = '✓ Pedida'
    showToast('🎵 ¡Canción agregada a la cola!')
  } else {
    btn.disabled = false
    btn.textContent = '+ Pedir'
    showToast('❌ ' + data.error, true)
  }
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast')
  toast.textContent = msg
  toast.className = isError ? 'error' : ''
  toast.style.display = 'block'
  setTimeout(() => toast.style.display = 'none', 3000)
}