const axios = require("axios");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const { ipcRenderer, clipboard, shell } = require("electron");
const { spawn } = require("child_process");
const Bottleneck = require("bottleneck");

let downloadFolder = null;
let binPaths = null;
let videos = [];

function isValidUrl(string) {
    try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
        return false;
    }
}
// Limiter globale: massimo 2 download simultanei, 500ms tra richieste
const downloadLimiter = new Bottleneck({
    maxConcurrent: 50,
    minTime: 0
});
// ------------------ DOM ELEMENTS ------------------
const urlArea = document.getElementById("urlArea");
const videoList = document.getElementById("videoList");
const clearListBtn = document.getElementById("clearList");
const audioOnlyChk = document.getElementById("audioOnlyChk");
const convertMkvChk = document.getElementById("convertMkvChk");
const playlistChk = document.getElementById("playlistChk");
const folderInput = document.getElementById("folderLabel");
const themeToggle = document.getElementById("themeToggle");
const openFolderBtn = document.getElementById("openFolderBtn");
const setFolderBtn = document.getElementById("setFolderBtn");
const addInlineBtn = document.getElementById("addInlineBtn");
const resetTextareaBtn = document.getElementById("resetTextareaBtn");
const pasteBtn = document.getElementById("pasteBtn");

const { resolveM3U8FromTextarea } = require("./m3u8Resolver"); // percorso corretto
const resolveM3u8Btn = document.getElementById("resolveM3u8Btn");

if (resolveM3u8Btn && urlArea) {
    resolveM3u8Btn.addEventListener("click", async () => {
        // blocca il bottone per evitare doppie richieste
        resolveM3u8Btn.disabled = true;
        resolveM3u8Btn.textContent = "Converting... ⏳";

        await resolveM3U8FromTextarea(urlArea);

        resolveM3u8Btn.disabled = false;
        resolveM3u8Btn.textContent = "Get Real M3U8 🎬";
    });
}

pasteBtn.addEventListener("click", () => {
    if (!urlArea) return;
    const text = clipboard.readText().trim();
    if (text) {
        urlArea.value += (urlArea.value ? "\n" : "") + text;
        urlArea.focus();
    }
});

// Bottone "Add link" ✔️
addInlineBtn.addEventListener("click", () => {
    if (!urlArea) return;
    const text = urlArea.value.trim();
    if (!text) return;
    // Processa le righe valide
    processTextInput(text).forEach(url => {
        if (isValidUrl(url)) addVideo(url);
    });
});
function setFolderPath(path) {
    if (!folderInput) return;
    folderInput.innerHTML = path.replace(
        /^([A-Za-z]:)/,
        '<span style="color:#0b84ff;font-weight:bold;">$1</span>'
    );
}
if (resetTextareaBtn && urlArea) {
    resetTextareaBtn.addEventListener("click", () => {
        urlArea.value = "";
        m3u8Log.textContent = "";  // Pulisce anche eventuale log
        m3u8Log.style.color = "";
        urlArea.focus();
    });
}


// ------------------ FILTRO CARATTERI NON VALIDI ------------------
function filterInvalidChars(text) {
    // Permette solo caratteri visibili ASCII, numeri, lettere, punteggiatura base e spazi
    return text.replace(/[^\x20-\x7E\n\r]/g, '');
}

// Applica filtro quando si incolla o digita nella textarea
urlArea.addEventListener("input", () => {
    urlArea.value = filterInvalidChars(urlArea.value);
});

// Applica filtro ai file .txt caricati
function processTextInput(text) {
    return filterInvalidChars(text).split(/\r?\n/).map(u => u.trim()).filter(u => u);
}


document.addEventListener("DOMContentLoaded", async () => {
    const settings = await ipcRenderer.invoke("get-settings");

    downloadFolder = settings.downloadFolder || "";
    if (downloadFolder) setFolderPath(downloadFolder);


    downloadFolder = settings.downloadFolder || "";
    if (folderInput) folderInput.value = downloadFolder;
    const theme = settings.theme || "dark";
    document.body.dataset.theme = theme;
    themeToggle.textContent = theme === "dark" ? "🌙" : "☀️";

    // Carica opzioni
    if (settings.options) {
        audioOnlyChk.checked = settings.options.audioOnly || false;
        convertMkvChk.checked = settings.options.convertMkv || false;
        playlistChk.checked = settings.options.playlist || false;
    }

    binPaths = await ipcRenderer.invoke("get-bin-paths");


    if (settings.links && settings.links.length > 0) {
        showPopup().then(choice => {
            if (choice === "yes") {
                settings.links.forEach(url => addVideo(url));
            } else {
                ipcRenderer.send("save-settings", { links: [], options: settings.options || {} });
            }
        });
    }

    renderVideos();
});


const ytBtn = document.getElementById('ytDlpHelpBtn');
const outputContainer = document.getElementById('ytHelpContainer');
const output = document.getElementById('outputHelp');
const closeBtn = document.getElementById('closeYtHelp');

if (ytBtn && outputContainer && output && closeBtn) {
    ytBtn.addEventListener('click', async () => {
        outputContainer.style.display = 'block';
        output.textContent = "Caricamento...";
        closeBtn.style.display = 'none'; // nascondi il bottone inizialmente

        try {
            const result = await ipcRenderer.invoke('yt-dlp-help');
            output.textContent = result;
            
            // Mostra il bottone dopo 3 secondi
            setTimeout(() => {
                closeBtn.style.display = 'inline-block';
            }, 3000);

        } catch (err) {
            output.textContent = `Errore: ${err}`;
            closeBtn.style.display = 'inline-block'; // mostra comunque in caso di errore
        }
    });

    closeBtn.addEventListener('click', () => {
        outputContainer.style.display = 'none';
    });
}
//
function showPopup() {
    return new Promise(resolve => {
        const overlay = document.getElementById("popupOverlay");
        const yesBtn = document.getElementById("popupYes");
        const noBtn = document.getElementById("popupNo");

        overlay.style.opacity = 0;
        overlay.style.display = "flex";
        requestAnimationFrame(() => {
            overlay.style.transition = "opacity 0.3s";
            overlay.style.opacity = 1;
        });

        const closePopup = (choice) => {
            overlay.style.opacity = 0;
            setTimeout(() => {
                overlay.style.display = "none";
                resolve(choice);
            }, 300);
        };

        yesBtn.onclick = () => closePopup("yes");
        noBtn.onclick = () => closePopup("no");
    });
}


themeToggle.addEventListener("click", () => {
    const newTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = newTheme;
    themeToggle.textContent = newTheme === "dark" ? "🌙" : "☀️";
    ipcRenderer.send("set-theme", newTheme);
});


openFolderBtn.addEventListener("click", () => ipcRenderer.invoke("open-folder"));
setFolderBtn.addEventListener("click", async () => {
    const folder = await ipcRenderer.invoke("set-folder");
    if (folder) {
        ipcRenderer.invoke("save-download-folder", folder).then(savedFolder => {
            downloadFolder = savedFolder;
            if (folderInput) {
                folderInput.value = savedFolder;  // testo normale
                setFolderPath(savedFolder);       // evidenzia unità
            }
            saveSettingsToMain();
        });
    }
});


audioOnlyChk.addEventListener("change", () => {
    if (audioOnlyChk.checked) convertMkvChk.checked = false;
    convertMkvChk.disabled = audioOnlyChk.checked || playlistChk.checked;
    saveSettingsToMain();
});
convertMkvChk.addEventListener("change", () => {
    if (convertMkvChk.checked) audioOnlyChk.checked = false;
    saveSettingsToMain();
});
playlistChk.addEventListener("change", () => {
    if (playlistChk.checked) convertMkvChk.checked = false;
    convertMkvChk.disabled = playlistChk.checked;
    saveSettingsToMain();
});


function addVideo(url) {
    if (!url || videos.find(v => v.url === url)) return;

    const video = {
        url,
        title: "Loading...",
        thumbnail: "",
        duration: "",
        formats: null,
        status: "",
        progress: 0,
        pid: Date.now(),
        format: null
    };
    videos.push(video);
    renderVideos();
    fetchVideoDetails(video);
    saveSettingsToMain();
}
// Supponendo che tu abbia un contenitore div che raggruppa i due bottoni
const groupBox = document.getElementById("groupBox");

// Funzione per mostrare/nascondere il groupBox con fade
function updateGroupBoxVisibility() {
    if (!groupBox) return;
    if (videos.length > 0) {
        groupBox.style.display = "flex";        // Mostra il contenitore
        requestAnimationFrame(() => {
            groupBox.style.opacity = 1;          // Fade-in
        });
    } else {
        groupBox.style.opacity = 0;             // Fade-out
        setTimeout(() => {
            if(videos.length === 0) groupBox.style.display = "none";
        }, 300); // tempo fade-out
    }
}
function renderVideos() {
    videoList.innerHTML = "";
    let anyThumbnailLoaded = false; // ← variabile per controllare se almeno una miniatura c'è

    videos.forEach((video, index) => {
        const div = document.createElement("div");
        div.className = "video-item";
        div.dataset.pid = video.pid;
        div.draggable = true;

        // Thumbnail o spinner
        let thumbHTML = '';
        if(video.thumbnail){
            anyThumbnailLoaded = true; // almeno una miniatura presente
            thumbHTML = `<img src="${video.thumbnail}" class="thumbnail" onclick="openThumbnail(${index})">`;
        } else {
            thumbHTML = `<div class="spinner"></div>`;
        }

        const formatOptions = video.formats 
            ? video.formats.map(f => `<option value="${f.format_id}">${f.format_id} (${f.ext})${f.sizeStr ? ' - ' + f.sizeStr : ''}</option>`).join('')
            : '';

        const durationLabel = video.duration ? `⏱️ Duration: ${video.duration}` : "";

        div.innerHTML = `
            <div class="thumbnail-container">
                ${thumbHTML}
                <div class="thumb-progress-bar" style="
                    width: 0%; 
                    height: 10px; 
                    background: #2196F3; 
                    border-radius: 2px; 
                    position: absolute; 
                    bottom: 0; 
                    left: 0;
                    transition: width 0.2s ease;
                "></div>
            </div>
            <div class="video-info">
                <strong>${escapeHtml(video.title)}</strong>
                <div class="status">${video.status || ""}</div>
                <label>
                    <select class="quality-select" onchange="setFormat(${index}, this.value)">
                        <option value="">Best Resolution</option>
                        ${formatOptions}
                    </select>
                </label>
                <div class="duration">${durationLabel}</div>
                <div class="download-details">⬇️</div>
            </div>
            <div class="video-buttons">
                <button class="download-btn" title="Download" onclick="downloadVideo(${index})">⬇️</button>
                <button class="remove-btn" title="Remove link" onclick="removeVideo(${index})">❌</button>
                <button class="paste-btn" title="Paste link" onclick="pasteLink(${index})">🔗</button>
                <button class="open-btn" title="Open link" onclick="openLink(${index})">🌐</button>
                <button class="open-folder-btn" title="Open download folder" onclick="openDownloadFolder(${index})">📂</button>
            </div>
        `;
        videoList.appendChild(div);
    });

    // Mostra/Nascondi bottoni globali
    clearListBtn.style.display = videos.length > 0 ? "inline-block" : "none";

    // Mostra i bottoni solo se c'è almeno una miniatura
    const groupBox = document.getElementById("groupBox");
    if(groupBox){
        if(anyThumbnailLoaded){
            groupBox.style.display = "flex";
            requestAnimationFrame(() => groupBox.style.opacity = 1);
        } else {
            groupBox.style.opacity = 0;
            setTimeout(() => { if(!anyThumbnailLoaded) groupBox.style.display = "none"; }, 300);
        }
    }

    addDragAndDropHandlers();
}

window.pasteLink = (index) => { urlArea.value = videos[index]?.url || ""; urlArea.focus(); };
window.openLink = (index) => { if(videos[index]) shell.openExternal(videos[index].url); };
window.openThumbnail = (index) => { if(videos[index]?.thumbnail) shell.openExternal(videos[index].thumbnail); };
window.setFormat = (index, formatId) => { if(videos[index]) videos[index].format = formatId; };
window.openDownloadFolder = (index) => {
    if (!downloadFolder) {
        alert("No download folder set!");
        return;
    }
    shell.openPath(downloadFolder);
};

window.removeVideo = (index) => {
    if (!videos[index]) return;
    if (clipboard.readText().trim() === videos[index].url) clipboard.writeText("");
	    // Cancella clipboard se corrisponde al video
    if (clipboard.readText().trim() === videos[index].url) clipboard.writeText("");

    // Cancella il log se la textarea contiene il link rimosso
    if (urlArea.value.trim() === videos[index].url) {
        m3u8Log.textContent = "";
        m3u8Log.style.color = "";
    }
    videos.splice(index, 1);
    renderVideos();
    saveSettingsToMain();
};


if (clearListBtn) {
    clearListBtn.addEventListener("click", () => {
        const overlay = document.getElementById("clearPopupOverlay");
        const yesBtn = document.getElementById("clearPopupYes");
        const noBtn = document.getElementById("clearPopupNo");

        overlay.style.display = "flex";
        overlay.style.opacity = 0;
        requestAnimationFrame(() => overlay.style.opacity = 1);

        const closePopup = () => { 
            overlay.style.opacity = 0; 
            setTimeout(() => overlay.style.display = "none", 300); 
        };

        yesBtn.onclick = () => {
            videos = [];
            renderVideos();
            saveSettingsToMain();
            closePopup();
        };
        noBtn.onclick = () => closePopup();
    });
}



if (urlArea) {
    const allowedExtensions = [".txt", ".json", ".html", ".htm", ".md", ".dat"];

    urlArea.addEventListener("dragover", e => {
        e.preventDefault();
        urlArea.style.border = "2px dashed #007ACC";
    });

    urlArea.addEventListener("dragleave", e => {
        e.preventDefault();
        urlArea.style.border = "";
    });

    urlArea.addEventListener("drop", e => {
        e.preventDefault();
        urlArea.style.border = "";

        // Nuova funzione per processare URL da qualunque testo
        const processUrls = (text) => {
            const urlRegex = /https?:\/\/[^\s"'<>]+/gi; // trova URL ovunque
            const urls = (text.match(urlRegex) || []).map(u => u.trim()).filter(u => isValidUrl(u));
            return [...new Set(urls)]; // rimuove duplicati
        };

        // File
        if (e.dataTransfer.files.length > 0) {
            Array.from(e.dataTransfer.files).forEach(file => {
                const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
                if (allowedExtensions.includes(ext)) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        processUrls(event.target.result).forEach(url => addVideo(url));
                    };
                    reader.readAsText(file);
                } else {
                    alert(`Drag a valid file (${allowedExtensions.join(", ")}) with links.`);
                }
            });
            return;
        }

        // Testo incollato / URL
        const textData = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
        if (textData) {
            processUrls(textData).forEach(url => addVideo(url));
        }
    });
}

function fetchVideoDetails(video){
    if(!binPaths?.ytDlp) return;
    const args = ["-j"];
    if(!playlistChk.checked) args.push("--flat-playlist");
    args.push(video.url);

    const proc = spawn(binPaths.ytDlp, args);
    let dataStr = "";

    proc.stdout.on("data", chunk => dataStr += chunk.toString());
    proc.stderr.on("data", () => {});

    proc.on("close", () => {
        try{
            const info = JSON.parse(dataStr);
            video.title = info.title || video.title;
            video.thumbnail = info.thumbnail?.replace(/hqdefault/, 'maxresdefault') || info.thumbnail;
            video.duration = info.duration_string || "";
            video.formats = (info.formats||[]).map(f=>{
                let sizeStr = '';
                let bytes = f.filesize || f.filesize_approx;
                if(bytes) sizeStr = bytes < 1024*1024 ? (bytes/1024).toFixed(1)+' KB' : bytes < 1024*1024*1024 ? (bytes/(1024*1024)).toFixed(1)+' MB' : (bytes/(1024*1024*1024)).toFixed(2)+' GB';
                return {...f, sizeStr};
            });
        } catch(e){ console.error("Parsing info error:", e); }
        renderVideos();
    });
}
function updateM3u8Live(video, m3u8Url) {
    if (!video || !m3u8Url) return;

    // Aggiorna l'URL del video con quello M3U8
    video.url = m3u8Url;

    // Mantieni la miniatura originale
    video.thumbnail = video.thumbnail || "";

    // Aggiorna lo stato e re-renderizza
    video.status = "HLS detected, updated URL";
    renderVideos();
}

window.downloadVideo = (index) => {
    downloadLimiter.schedule(() => actualDownloadVideo(index));
};

function actualDownloadVideo(index){
    const video = videos[index]; if(!video) return;

    // --- Aggiorna stato in coda ---
    video.status = "⏳ Queued...";
    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if(videoDiv){
        const statusText = videoDiv.querySelector(".status");
        if(statusText) statusText.textContent = video.status;
    }

    const audioOnly = audioOnlyChk.checked;
    const convertMkv = convertMkvChk.checked;
    const playlist = playlistChk.checked;
    const selectedFormat = video.format || null;

    // Scarica dopo la coda del limiter
    return new Promise(resolve => {
        downloadLimiter.schedule(async () => {
            // --- Aggiorna stato download effettivo ---
            video.status = "⏳ Downloading...";
            if(videoDiv){
                const statusText = videoDiv.querySelector(".status");
                if(statusText) statusText.textContent = video.status;
            }

            await ipcRenderer.invoke("start-download", {
                ...video,
                outputDir: downloadFolder || null,
                audioOnly,
                recode: convertMkv ? "mkv" : null,
                playlist,
                format: selectedFormat
            });

            resolve(); // segnala al limiter che ha finito
        });
    });
}



ipcRenderer.on("download-progress", (event, {url,data})=>{
    const video = videos.find(v=>v.url===url); if(!video) return;
    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`); if(!videoDiv) return;
    const progressBar = videoDiv.querySelector(".thumb-progress-bar"); // ← qui
    const detailsText = videoDiv.querySelector(".download-details");

    const percentMatch = data.match(/(\d+(\.\d+)?)%/);
    const percent = percentMatch ? parseFloat(percentMatch[1]) : video.progress || 0;
    const etaMatch = data.match(/ETA\s*([\d:]+)/);
    const eta = etaMatch ? etaMatch[1] : "";
    const speedMatch = data.match(/([\d\.]+[KMG]i?B\/s)/i);
    const speedStr = speedMatch ? speedMatch[0] : "";

    video.progress = percent;
    if(progressBar) progressBar.style.width = percent+"%";
    if(detailsText) detailsText.textContent = `⬇️   ${percent}%   ${speedStr}   ${eta}`;
});


ipcRenderer.on("download-complete", (event, { url, code, error }) => {
    const video = videos.find(v => v.url === url);
    if (!video) return;

    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if (!videoDiv) return;

    const progressBar = videoDiv.querySelector(".thumb-progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");
    const stopBtn = videoDiv.querySelector(".stop-btn");

    if (progressBar) {
        progressBar.style.width = "100%";
        progressBar.style.backgroundColor = code === 0 ? "#4CAF50" : "#F44336";
    }

    if (statusText) {
        statusText.textContent = code === 0
            ? "✅ Completed"
            : `💀 Error${error ? ": " + error : ""}`;
    }

    if (detailsText) {
        detailsText.textContent = code === 0
            ? "⬇️   Completed"
            : `💀 ${error || "Unknown error"}`;
    }

    if (stopBtn) stopBtn.disabled = true;
});

ipcRenderer.on("download-stopped",(event,{url})=>{
    const video = videos.find(v=>v.url===url); if(!video) return;
    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`); if(!videoDiv) return;
    const progressBar = videoDiv.querySelector(".progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");
    const stopBtn = videoDiv.querySelector(".stop-btn");

    if(progressBar) progressBar.style.backgroundColor="#F44336";
    if(statusText) statusText.textContent="⛔ Interrupted";
    if(detailsText) detailsText.textContent="⬇️   Interrupted";
    if(stopBtn) stopBtn.disabled=true;
});
//
const logArea = document.getElementById("logArea");

// ----------------- ADD LINK BUTTON -----------------
addInlineBtn.addEventListener("click", () => {
    const text = urlArea.value.trim();
    if (!text) return;

    const added = processTextInput(text)
        .filter(url => isValidUrl(url))
        .map(url => addVideo(url));

    if (added.length === 0) {
        logArea.textContent = "⚠️ No valid link to add!";
        logArea.style.color = "orange";
    } else {
        logArea.textContent = `✅ Added ${added.length} valid links.`;
        logArea.style.color = "green";
    }

    urlArea.value = ""; // pulisce textarea
    setTimeout(() => { logArea.textContent = ""; }, 5000); // sparisce dopo 5s
});

// ----------------- PASTE BUTTON -----------------
pasteBtn.addEventListener("click", async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) {
            logArea.textContent = "⚠️ Blank clipboard!";
            logArea.style.color = "orange";
            setTimeout(() => { logArea.textContent = ""; }, 5000);
            return;
        }

        const added = processTextInput(text)
            .filter(url => isValidUrl(url))
            .map(url => addVideo(url));

        if (added.length === 0) {
            logArea.textContent = "⚠️ No valid link in clipboard!";
            logArea.style.color = "orange";
        } else {
            logArea.textContent = `✅ Added ${added.length} link from clipboard.`;
            logArea.style.color = "green";
        }

        setTimeout(() => { logArea.textContent = ""; }, 5000);

    } catch (err) {
        console.error("🥺 Error reading from clipboard:", err);
        logArea.textContent = "❌ Cannot read from clipboard.";
        logArea.style.color = "red";
        setTimeout(() => { logArea.textContent = ""; }, 5000);
    }
});

// ------------------ DOWNLOAD ALL ------------------
if(downloadAllBtn){
    downloadAllBtn.addEventListener("click", () => {
        videos.forEach((_, idx) => {
            downloadLimiter.schedule(() => actualDownloadVideo(idx));
        });
    });
}
// Pulisce il log quando la textarea è vuota
urlArea.addEventListener("input", () => {
    if (!urlArea.value.trim()) {
        m3u8Log.textContent = "";
        m3u8Log.style.color = "";
    }
});


let dragSrcEl=null;
function handleDragStart(e){dragSrcEl=this;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/html',this.outerHTML);this.classList.add('dragging');}
function handleDragOver(e){e.preventDefault(); e.dataTransfer.dropEffect='move'; return false;}
function handleDragEnter(){this.classList.add('over');}
function handleDragLeave(){this.classList.remove('over');}
function handleDrop(e){
    e.stopPropagation();
    if(dragSrcEl!==this){
        const parent=this.parentNode;
        const mouseY=e.clientY;
        const targetRect=this.getBoundingClientRect();
        const insertAfter=mouseY>targetRect.top+targetRect.height/2;
        parent.removeChild(dragSrcEl);
        if(insertAfter) this.insertAdjacentElement('afterend', dragSrcEl);
        else this.insertAdjacentElement('beforebegin', dragSrcEl);
        const newOrder=[];
        parent.querySelectorAll('.video-item').forEach(el=>{
            const pid=parseInt(el.dataset.pid);
            const vid=videos.find(v=>v.pid===pid);
            if(vid) newOrder.push(vid);
        });
        videos=newOrder;
        addDragAndDropHandlers();
        saveSettingsToMain();
    }
    this.classList.remove('over');
    return false;
}
function handleDragEnd(){this.classList.remove('dragging'); document.querySelectorAll('.video-item').forEach(item=>item.classList.remove('over'));}
function addDragAndDropHandlers(){document.querySelectorAll('.video-item').forEach(item=>{
    item.addEventListener('dragstart', handleDragStart,false);
    item.addEventListener('dragenter', handleDragEnter,false);
    item.addEventListener('dragover', handleDragOver,false);
    item.addEventListener('dragleave', handleDragLeave,false);
    item.addEventListener('drop', handleDrop,false);
    item.addEventListener('dragend', handleDragEnd,false);
});}


function escapeHtml(str){if(!str) return ""; return str.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function getOptions(){ return { audioOnly: audioOnlyChk.checked, convertMkv: convertMkvChk.checked, playlist: playlistChk.checked }; }
function saveSettingsToMain(){ ipcRenderer.send("save-settings",{links: videos.map(v=>v.url), options:getOptions(), downloadFolder}); }


// --- altre funzioni esistenti ---

const updateBtn = document.getElementById("updateYtDlpBtn");
const updateLog = document.getElementById("updateLog");

updateBtn.addEventListener("click", async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = "Updating...";
    updateLog.textContent = "";

    try {
        const result = await ipcRenderer.invoke("update-yt-dlp");
        updateLog.textContent = result.output || "✅ Update finished";

        // Timer per far sparire il log dopo 5 secondi
        setTimeout(() => {
            updateLog.textContent = "";
        }, 5000);

    } catch (err) {
        updateLog.textContent = "❌ Error updating: " + err.message;
        setTimeout(() => {
            updateLog.textContent = "";
        }, 5000);
    } finally {
        updateBtn.disabled = false;
        updateBtn.textContent = "Update YT-DLP ⬆️";
    }
});
//
const downloadBtn = document.getElementById("download-binaries");
const downloadBarInner = document.getElementById("download-bar-inner");
const downloadPercentInner = document.getElementById("download-percent-inner");
const downloadStatus = document.getElementById("download-status");


// Listener del bottone "Scarica Binaries"
downloadBtn.addEventListener("click", async () => {
    if(downloadBarInner) downloadBarInner.style.width = "0%";
    if(downloadPercentInner) downloadPercentInner.innerText = "0%";
    if(downloadStatus) downloadStatus.innerText = "";

    try {
        const result = await ipcRenderer.invoke("download-binaries");
        if(downloadStatus) downloadStatus.innerText = result;

        setTimeout(() => {
            if(downloadBarInner) downloadBarInner.style.width = "0%";
            if(downloadPercentInner) downloadPercentInner.innerText = "0%";
            if(downloadStatus) downloadStatus.innerText = "";
        }, 3000);

    } catch (err) {
        if(downloadStatus) downloadStatus.innerText = `Error: ${err}`;
        setTimeout(() => {
            if(downloadBarInner) downloadBarInner.style.width = "0%";
            if(downloadPercentInner) downloadPercentInner.innerText = "0%";
            if(downloadStatus) downloadStatus.innerText = "";
        }, 3000);
    }
});
function setDownloadProgressInner(percent, message) {
    if(downloadBarInner) downloadBarInner.style.width = `${percent}%`;
    if(downloadPercentInner) downloadPercentInner.innerText = `${percent}%`;
    if(downloadStatus) downloadStatus.innerText = message;
}

ipcRenderer.on("download-binaries-log", (event, msg) => {
    // Mantieni percentuale corrente, aggiorna solo il messaggio
    const barWidth = parseFloat(document.getElementById("download-bar-inner").style.width) || 0;
    setDownloadProgressInner(barWidth, msg);
});

ipcRenderer.on("download-binaries-progress", (event, { percent }) => {
    const currentMsg = document.getElementById("download-status").innerText || "Downloading...";
    setDownloadProgressInner(percent, currentMsg);
});
const resetFormBtn = document.getElementById("resetFormBtn");

if (resetFormBtn) {
    resetFormBtn.addEventListener("click", async () => {
        console.log("♻️ Reset Form clicked");

        if (!urlArea) return;

        // Mostra messaggio temporaneo nella textarea
        urlArea.value = "🔄 I'm reloading the videos, make sure you've downloaded the binaries...";
        urlArea.disabled = true;

        // Pulisci lista video e DOM
        videos = [];
        if (videoList) videoList.innerHTML = "";

        // Nascondi bottoni globali
        if (clearListBtn) clearListBtn.style.display = "none";
        const groupBox = document.getElementById("groupBox");
        if (groupBox) {
            groupBox.style.opacity = 0;
            setTimeout(() => { groupBox.style.display = "none"; }, 300);
        }

        // Ricarica link dalle impostazioni
        const settings = await ipcRenderer.invoke("get-settings");
        if (settings.links && settings.links.length > 0) {
            settings.links.forEach(url => addVideo(url));
        }

        // Salva settings aggiornati
        saveSettingsToMain();

        // Funzione per rimuovere il messaggio appena compare almeno una miniatura
        const checkThumbnails = setInterval(() => {
            const anyThumbnail = document.querySelector(".video-item img.thumbnail");
            if (anyThumbnail) {
                urlArea.value = "";
                urlArea.disabled = false;
                urlArea.focus();
                clearInterval(checkThumbnails);
            }
        }, 200); // Controlla ogni 200ms
    });
}



// --- fine file ---
window.addVideo = addVideo;

