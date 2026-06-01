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
 
// Peticiones en vuelo — solo en memoria (se limpia sola en milisegundos)
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
 
// ─── REQUEST LOG en Upstash ───────────────────────────────────────────────────
 
const LIMIT_MS = 15 * 60 * 1000
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
 
// ─── CLIENTE ──────────────────────────────────────────────────────────────────
 
app.get('/songs', (req, res) => {
  res.json(activePlaylist.songs)
})
 
app.post('/queue', async (req, res) => {
  const { id, clientId } = req.body
 
  // Validar que la canción existe en la lista activa
  if (!activePlaylist.songs.find(s => s.id === id)) {
    return res.status(403).json({ error: 'Canción no permitida' })
  }
 
  // Usar clientId si viene, si no caer a IP (compatibilidad)
  const identifier = clientId || req.headers['x-forwarded-for'] || req.socket.remoteAddress
 
  // Verificar que no haya una petición en vuelo para este cliente
  if (pendingRequests.has(identifier)) {
    return res.status(429).json({ error: 'Ya tienes una petición en proceso, espera un momento' })
  }
 
  // Verificar límite de 15 minutos leyendo desde Upstash
  const now = Date.now()
  const log = await getRequestLog()
 
  if (log[identifier] && now - log[identifier] < LIMIT_MS) {
    const remaining = Math.ceil((LIMIT_MS - (now - log[identifier])) / 60000)
    return res.status(429).json({
      error: `Puedes pedir otra canción en ${remaining} minuto${remaining !== 1 ? 's' : ''}`
    })
  }
 
  // Marcar como en proceso
  pendingRequests.add(identifier)
 
  try {
    const token = await getValidToken()
    await axios.post(
      `https://api.spotify.com/v1/me/player/queue?uri=spotify:track:${id}`,
      {},
      { headers: { 'Authorization': `Bearer ${token}` } }
    )
 
    // Guardar timestamp en Upstash
    log[identifier] = now
    await saveRequestLog(log)
 
    res.json({ ok: true, message: '¡Canción agregada a la cola!' })
  } catch (error) {
    res.status(500).json({ error: 'No se pudo agregar. ¿Spotify está reproduciendo en algún dispositivo?' })
  } finally {
    // Siempre liberar la petición en vuelo
    pendingRequests.delete(identifier)
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