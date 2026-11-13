const fs = require('fs');
const path = require('path');
const jsmediatags = require('jsmediatags');

// Polyfill fetch for Node environments older than 18 (though GitHub Actions uses Node 20 which has it)
const fetch = global.fetch || require('node-fetch');

const MUSIC_DIR = path.join(__dirname, '..', 'music');
const MANIFEST_FILE = path.join(MUSIC_DIR, 'manifest.json');

// Helper to get metadata from local file
function getLocalMetadata(filePath) {
    return new Promise((resolve, reject) => {
        jsmediatags.read(filePath, {
            onSuccess: (tag) => resolve(tag.tags),
            onError: (error) => reject(error)
        });
    });
}

// Helper to get metadata from remote URL
async function getRemoteMetadata(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return new Promise((resolve, reject) => {
        jsmediatags.read(buffer, {
            onSuccess: (tag) => resolve(tag.tags),
            onError: (error) => reject(error)
        });
    });
}

// Convert picture data to base64 data URL
function pictureToDataUrl(picture) {
    if (!picture || !picture.data) return '';
    try {
        const data = picture.data;
        const len = data.length;
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < len; i += chunkSize) {
            const chunk = data.subarray ? data.subarray(i, i + chunkSize) : data.slice(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        const base64 = Buffer.from(binary, 'binary').toString('base64');
        const format = ((picture.format || 'image/jpeg').split(' ')[0] || 'image/jpeg').toLowerCase();
        return 'data:' + format + ';base64,' + base64;
    } catch (e) {
        console.warn('Failed to convert picture:', e.message);
        return '';
    }
}

async function processPlaylist(playlistPath) {
    let data;
    try {
        data = JSON.parse(fs.readFileSync(playlistPath, 'utf8'));
    } catch (e) {
        console.warn(`Skipping ${playlistPath}: invalid JSON`);
        return false;
    }

    let changed = false;
    const songs = data.songs || [];

    for (let i = 0; i < songs.length; i++) {
        let song = songs[i];
        let url = typeof song === 'string' ? song : song.url;
        
        // Skip if no URL
        if (!url) continue;

        // If the song is a string, or is missing title/artist/cover, fetch it.
        if (typeof song === 'string' || !song.title || !song.cover || !song.artist) {
            console.log(`Fetching metadata for: ${url}`);
            
            let meta = { title: 'Untitled', artist: 'Unknown Artist', cover: '' };
            
            try {
                if (url.startsWith('http')) {
                    const tags = await getRemoteMetadata(url);
                    meta.title = tags.title || meta.title;
                    meta.artist = tags.artist || meta.artist;
                    meta.cover = pictureToDataUrl(tags.picture);
                } else {
                    // Assume it's a local file relative to the music folder
                    const localPath = path.join(MUSIC_DIR, url.replace(/^\//, ''));
                    if (fs.existsSync(localPath)) {
                        const tags = await getLocalMetadata(localPath);
                        meta.title = tags.title || meta.title;
                        meta.artist = tags.artist || meta.artist;
                        meta.cover = pictureToDataUrl(tags.picture);
                    } else {
                        console.warn(`Local file not found: ${localPath}`);
                    }
                }
            } catch (err) {
                console.warn(`Could not read tags for ${url}: ${err.type || err.message}`);
                // If tag reading fails, fallback to filename parsing
                const filename = url.split('/').pop().replace(/\.[^/.]+$/, "").replace(/_/g, ' ');
                meta.title = filename || meta.title;
            }

            // Update the song object in the array
            songs[i] = { url, ...meta };
            changed = true;
        }
    }

    if (changed) {
        data.songs = songs;
        fs.writeFileSync(playlistPath, JSON.stringify(data, null, 2));
        console.log(`Updated ${playlistPath}`);
        return true;
    }
    return false;
}

async function main() {
    if (!fs.existsSync(MANIFEST_FILE)) {
        console.log('No music manifest found. Skipping.');
        return;
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
    const playlists = manifest.playlists || [];

    for (const playlist of playlists) {
        const playlistPath = path.join(MUSIC_DIR, playlist.file);
        if (fs.existsSync(playlistPath)) {
            await processPlaylist(playlistPath);
        }
    }
}

main().catch(console.error);
