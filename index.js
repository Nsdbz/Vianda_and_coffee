require('dotenv').config()
const express = require('express')
const axios = require('axios')
const { Redis } = require('@upstash/redis')
 
const app = express()
app.use(express.json())
app.use(express.static('public'))
 
// ─── UPSTASH REDIS ────────────────────────────────────────────────────────────
 
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
})
 
let spotifyTokens = { access_token: null, refresh_token: null, expires_at: null }
let activePlaylist = { id: null, name: null, songs: [] }
const pendingRequests = new Set()
 
async function loadTokens() {
  try {
    const saved = await redis.get('spotify_tokens')
    if (saved) spotifyTokens = saved
  } catch (e) {}
}
 
async function saveTokens() {
  await redis.set('spotify_tokens', spotifyTokens)
}
 
async function loadPlaylist() {
  try {
    const saved = await redis.get('active_playlist')
    if (saved) activePlaylist = saved
  } catch (e) {}
}
 
async function savePlaylist() {
  await redis.set('active_playlist', activePlaylist)
}
 
// ─── REQUEST LOG ──────────────────────────────────────────────────────────────
 
const LIMIT_MS = 5 * 60 * 1000
const REQUEST_LOG_KEY = 'request_log'
 
async function getRequestLog() {
  try {
    const saved = await redis.get(REQUEST_LOG_KEY)
    return saved || {}
  } catch (e) {
    return {}
  }
}
 
async function saveRequestLog(log) {
  try {
    await redis.set(REQUEST_LOG_KEY, log)
  } catch (e) {}
}
 
// ─── ESTADÍSTICAS DE CANCIONES ────────────────────────────────────────────────
// Guarda en Redis cuántas veces se ha pedido cada canción
// Estructura: { trackId: { name, artist, image, count } }
 
async function getSongStats() {
  try {
    const saved = await redis.get('song_stats')
    return saved || {}
  } catch (e) {
    return {}
  }
}
 
async function incrementSongStat(song) {
  try {
    const stats = await getSongStats()
    if (stats[song.id]) {
      stats[song.id].count += 1
    } else {
      stats[song.id] = { name: song.name, artist: song.artist, image: song.image, count: 1 }
    }
    await redis.set('song_stats', stats)
  } catch (e) {}
}
 
// ─── SUGERENCIAS ──────────────────────────────────────────────────────────────
// Guarda en Redis las sugerencias de canciones de los clientes
// Estructura: [ { id, trackId, name, artist, album, image, clientId, timestamp, status } ]
// status puede ser: 'pending' | 'accepted' | 'rejected'
 
async function getSuggestions() {
  try {
    const saved = await redis.get('suggestions')
    return saved || []
  } catch (e) {
    return []
  }
}
 
async function saveSuggestions(suggestions) {
  try {
    await redis.set('suggestions', suggestions)
  } catch (e) {}
}
 
// ─── AUTENTICACIÓN ────────────────────────────────────────────────────────────
 
app.get('/auth/login', (req, res) => {
  const scopes = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'streaming',
    'user-read-email',
    'user-read-private',
    'playlist-read-private',
    'playlist-read-collaborative'
  ].join(' ')
 
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scopes,
    redirect_uri: process.env.REDIRECT_URI
  })
 
  res.redirect(`https://accounts.spotify.com/authorize?${params}`)
})
 
app.get('/callback', async (req, res) => {
  const code = req.query.code
  try {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
          ).toString('base64')
        }
      }
    )
 
    spotifyTokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_at: Date.now() + (response.data.expires_in * 1000)
    }
    await saveTokens()
    res.redirect('/admin.html')
  } catch (error) {
    res.send('❌ Algo salió mal. Revisa la terminal.')
  }
})
 
app.get('/auth/reset', async (req, res) => {
  spotifyTokens = { access_token: null, refresh_token: null, expires_at: null }
  await saveTokens()
  res.redirect('/auth/login')
})
 
// ─── REFRESH TOKEN ────────────────────────────────────────────────────────────
 
async function getValidToken() {
  if (!spotifyTokens.access_token) {
    throw new Error('No autenticado. Ve a /auth/login')
  }
 
  if (Date.now() > spotifyTokens.expires_at - 60000) {
    const response = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: spotifyTokens.refresh_token
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(
            process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
          ).toString('base64')
        }
      }
    )
    spotifyTokens.access_token = response.data.access_token
    spotifyTokens.expires_at = Date.now() + (response.data.expires_in * 1000)
    await saveTokens()
  }
 
  return spotifyTokens.access_token
}
 
// ─── ADMIN: playlists ─────────────────────────────────────────────────────────
 
app.get('/admin/search-playlists', async (req, res) => {
  const { q } = req.query
  try {
    const token = await getValidToken()
    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { q, type: 'playlist', limit: 10 }
    })
    res.json(response.data.playlists.items.map(pl => ({
      id: pl.id,
      name: pl.name,
      owner: pl.owner.display_name,
      total: pl.tracks.total,
      image: pl.images[0]?.url
    })))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
app.get('/admin/search', async (req, res) => {
  const { q } = req.query
  try {
    const token = await getValidToken()
    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { q, type: 'track', limit: 10 }
    })
    res.json(response.data.tracks.items.map(track => ({
      id: track.id,
      name: track.name,
      artist: track.artists[0].name,
      album: track.album.name,
      image: track.album.images[1]?.url
    })))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
app.get('/admin/my-playlists', async (req, res) => {
  try {
    const token = await getValidToken()
    const response = await axios.get('https://api.spotify.com/v1/me/playlists', {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { limit: 20 }
    })
    res.json(response.data.items
      .filter(pl => pl)
      .map(pl => ({
        id: pl.id,
        name: pl.name,
        total: pl.items?.total || 0,
        image: pl.images?.[0]?.url || null
      })))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
app.post('/admin/activate-playlist', async (req, res) => {
  const { id, name, image } = req.body
  try {
    const token = await getValidToken()
    let songs = []
    let url = `https://api.spotify.com/v1/playlists/${id}/items?limit=50`
 
    while (url) {
      const response = await axios.get(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const tracks = response.data.items
        .filter(item => item.item && item.item.id)
        .map(item => ({
          id: item.item.id,
          name: item.item.name,
          artist: item.item.artists[0].name,
          album: item.item.album.name,
          image: item.item.album.images[1]?.url
        }))
      songs = [...songs, ...tracks]
      url = response.data.next
    }
 
    activePlaylist = { id, name, image, songs }
    await savePlaylist()
    res.json({ ok: true, name, total: songs.length })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
app.post('/admin/add-song', async (req, res) => {
  const { id, name, artist, album, image } = req.body
 
  if (!activePlaylist.id) {
    return res.status(400).json({ error: 'No hay playlist activa. Activa una primero.' })
  }
  if (activePlaylist.songs.find(s => s.id === id)) {
    return res.status(400).json({ error: 'La canción ya está en la lista' })
  }
 
  activePlaylist.songs.push({ id, name, artist, album, image })
  await savePlaylist()
  res.json({ ok: true, total: activePlaylist.songs.length })
})
 
app.delete('/admin/remove-song/:id', async (req, res) => {
  if (!activePlaylist.id) {
    return res.status(400).json({ error: 'No hay playlist activa' })
  }
  activePlaylist.songs = activePlaylist.songs.filter(s => s.id !== req.params.id)
  await savePlaylist()
  res.json({ ok: true, total: activePlaylist.songs.length })
})
 
app.get('/admin/active-playlist', (req, res) => {
  res.json({
    id: activePlaylist.id,
    name: activePlaylist.name,
    image: activePlaylist.image,
    total: activePlaylist.songs.length
  })
})
 
// ─── ADMIN: ESTADÍSTICAS ──────────────────────────────────────────────────────
// Devuelve:
//   - totalRequests: número total de veces que se pidió una canción
//   - topSongs: array de las 10 canciones más pedidas, ordenadas de mayor a menor
 
app.get('/admin/stats', async (req, res) => {
  try {
    const stats = await getSongStats()
    const songs = Object.values(stats)
 
    // Suma total de todas las peticiones
    const totalRequests = songs.reduce((acc, s) => acc + s.count, 0)
 
    // Ordena de mayor a menor y toma las 10 primeras
    const topSongs = songs
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
 
    res.json({ totalRequests, topSongs })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
// ─── ADMIN: SUGERENCIAS ───────────────────────────────────────────────────────
 
// Devuelve todas las sugerencias pendientes
app.get('/admin/suggestions', async (req, res) => {
  try {
    const suggestions = await getSuggestions()
    // Solo devuelve las pendientes, ordenadas de más reciente a más antigua
    const pending = suggestions
      .filter(s => s.status === 'pending')
      .sort((a, b) => b.timestamp - a.timestamp)
    res.json(pending)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
// Acepta una sugerencia: la agrega a la playlist activa y la marca como aceptada
app.post('/admin/suggestions/:id/accept', async (req, res) => {
  try {
    const suggestions = await getSuggestions()
    const suggestion = suggestions.find(s => s.id === req.params.id)
 
    if (!suggestion) return res.status(404).json({ error: 'Sugerencia no encontrada' })
    if (!activePlaylist.id) return res.status(400).json({ error: 'No hay playlist activa' })
 
    // Agregar a playlist si no está ya
    if (!activePlaylist.songs.find(s => s.id === suggestion.trackId)) {
      activePlaylist.songs.push({
        id: suggestion.trackId,
        name: suggestion.name,
        artist: suggestion.artist,
        album: suggestion.album || '',
        image: suggestion.image
      })
      await savePlaylist()
    }
 
    // Marcar como aceptada
    suggestion.status = 'accepted'
    await saveSuggestions(suggestions)
 
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
// Rechaza una sugerencia: solo la marca como rechazada
app.post('/admin/suggestions/:id/reject', async (req, res) => {
  try {
    const suggestions = await getSuggestions()
    const suggestion = suggestions.find(s => s.id === req.params.id)
 
    if (!suggestion) return res.status(404).json({ error: 'Sugerencia no encontrada' })
 
    suggestion.status = 'rejected'
    await saveSuggestions(suggestions)
 
    res.json({ ok: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
 
// ─── CLIENTE ──────────────────────────────────────────────────────────────────
 
app.get('/songs', (req, res) => {
  res.json(activePlaylist.songs)
})
 
app.post('/queue', async (req, res) => {
  const { id, clientId } = req.body
 
  if (!activePlaylist.songs.find(s => s.id === id)) {
    return res.status(403).json({ error: 'Canción no permitida' })
  }
 
  const identifier = clientId || req.headers['x-forwarded-for'] || req.socket.remoteAddress
 
  if (pendingRequests.has(identifier)) {
    return res.status(429).json({ error: 'Ya tienes una petición en proceso, espera un momento' })
  }
 
  const now = Date.now()
  const log = await getRequestLog()
 
  if (log[identifier] && now - log[identifier] < LIMIT_MS) {
    const remaining = Math.ceil((LIMIT_MS - (now - log[identifier])) / 60000)
    return res.status(429).json({
      error: `Puedes pedir otra canción en ${remaining} minuto${remaining !== 1 ? 's' : ''}`
    })
  }
 
  pendingRequests.add(identifier)
 
  try {
    const token = await getValidToken()
    await axios.post(
      `https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${id}`,
      {},
      { headers: { 'Authorization': `Bearer ${token}` } }
    )
 
    log[identifier] = now
    await saveRequestLog(log)
 
    // Registrar estadística de la canción pedida
    const song = activePlaylist.songs.find(s => s.id === id)
    if (song) await incrementSongStat(song)
 
    res.json({ ok: true, message: '¡Canción agregada a la cola!' })
  } catch (error) {
    res.status(500).json({ error: 'No se pudo agregar. ¿Spotify está reproduciendo en algún dispositivo?' })
  } finally {
    pendingRequests.delete(identifier)
  }
})
 
// ─── CLIENTE: SUGERIR CANCIÓN ─────────────────────────────────────────────────
// El cliente puede sugerir una canción buscándola en Spotify.
// La sugerencia queda en estado 'pending' hasta que el admin la acepte o rechace.
// Límite: un cliente solo puede tener 1 sugerencia pendiente a la vez.
 
app.post('/suggest', async (req, res) => {
  const { trackId, name, artist, album, image, clientId } = req.body
 
  if (!trackId || !name || !artist) {
    return res.status(400).json({ error: 'Datos incompletos' })
  }
 
  const identifier = clientId || req.headers['x-forwarded-for'] || req.socket.remoteAddress
 
  try {
    const suggestions = await getSuggestions()
 
    // Verificar que este cliente no tenga ya una sugerencia pendiente
    const alreadyPending = suggestions.find(
      s => s.clientId === identifier && s.status === 'pending'
    )
    if (alreadyPending) {
      return res.status(429).json({ error: 'Ya tienes una sugerencia pendiente. Espera a que el admin la revise.' })
    }
 
    // Crear la sugerencia nueva
    const newSuggestion = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, // ID único simple
      trackId,
      name,
      artist,
      album: album || '',
      image: image || null,
      clientId: identifier,
      timestamp: Date.now(),
      status: 'pending'
    }
 
    suggestions.push(newSuggestion)
    await saveSuggestions(suggestions)
 
    res.json({ ok: true, message: '¡Sugerencia enviada! El admin la revisará pronto.' })
  } catch (error) {
    res.status(500).json({ error: 'No se pudo enviar la sugerencia' })
  }
})
 
// ─── NOW PLAYING & QUEUE ──────────────────────────────────────────────────────
 
app.get('/now-playing', async (req, res) => {
  try {
    const token = await getValidToken()
    const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!response.data || !response.data.item) {
      return res.json({ playing: false })
    }
    const track = response.data.item
    res.json({
      playing: response.data.is_playing,
      name: track.name,
      artist: track.artists[0].name,
      image: track.album.images[1]?.url,
      duration_ms: track.duration_ms,
      progress_ms: response.data.progress_ms
    })
  } catch (error) {
    res.json({ playing: false })
  }
})
 
app.get('/queue-list', async (req, res) => {
  try {
    const token = await getValidToken()
    const response = await axios.get('https://api.spotify.com/v1/me/player/queue', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const items = (response.data.queue || []).slice(0, 10).map(track => ({
      name: track.name,
      artist: track.artists[0].name,
      image: track.album.images[2]?.url
    }))
    res.json(items)
  } catch (error) {
    res.json([])
  }
})
 
// ─── SERVIDOR ─────────────────────────────────────────────────────────────────
 
Promise.all([loadTokens(), loadPlaylist()]).then(() => {
  app.listen(process.env.PORT, '0.0.0.0', () => {
    console.log(`\nServidor corriendo en http://127.0.0.1:${process.env.PORT}`)
    console.log(`Admin: http://127.0.0.1:${process.env.PORT}/auth/login\n`)
  })
})
 