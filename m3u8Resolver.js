const axios = require("axios");

async function findM3U8(url) {
    try {
        const response = await axios.get(url);
        const html = response.data;
        const regex = /https?:\/\/[^\s'"]+\.m3u8/g;
        const matches = html.match(regex);
        return matches && matches.length > 0 ? matches[0] : null;
    } catch (err) {
        console.error("Errore su", url, err.message);
        return null;
    }
}

async function resolveM3U8FromTextarea(textarea) {
    const lines = textarea.value.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;
    const promises = lines.map(line => findM3U8(line));
    const results = await Promise.all(promises);
    const final = results.map((m3u8, idx) => m3u8 || lines[idx]);

    textarea.value = final.join("\n");
}

module.exports = { resolveM3U8FromTextarea };
