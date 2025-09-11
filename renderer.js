// renderer.js - completo
const { ipcRenderer, clipboard } = require("electron");
const { spawn } = require("child_process"); // usato solo se serve localmente (qui non utilizzato)

let downloadFolder = null;
let binPaths = null;
let videos = [];

// DOM elements
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
// ----------- INIT -----------
let currentLang = "it"; // default

//Rileva il click destro o selezione del mouse
// urlArea.addEventListener("mouseenter", async () => {
    // try {
        // const clipboardText = await navigator.clipboard.readText();
        // if (!clipboardText) return;
        //Inserisce il testo nella textarea senza aggiungerlo alla lista
        // urlArea.value = clipboardText;
    // } catch (err) {
        // console.error("Errore lettura clipboard:", err);
    // }
// });

// Bottone "+" per aggiungere i link dalla textarea alla lista
const addBtn = document.getElementById("addInlineBtn");
addBtn.addEventListener("click", () => {
    const text = urlArea.value.trim();
    if (!text) return;

    // Può contenere più link separati da \n
    const urls = text.split(/\r?\n/).map(u => u.trim()).filter(u => u);
    urls.forEach(url => addVideo(url)); // usa la tua funzione addVideo
});
document.addEventListener("DOMContentLoaded", async () => {
    // Prende le impostazioni salvate dal main
    const settings = await ipcRenderer.invoke("get-settings");
        // lingua salvata
		
		    // lingua salvata
    currentLang = settings.language || "it";

    updateFolderButtonText();
	    localStorage.setItem("lang", currentLang); // 🔹 salva la lingua scelta in localStorage
updateTexts();            // 🔹 aggiorna subito tutti i testi
    // Controlla se ci sono link salvati
    if (settings.links && settings.links.length > 0) {
        // Mostra popup personalizzato per chiedere se ricaricarli
        showPopup().then(choice => {
            if (choice === "yes") {
                // Ricarica tutti i link salvati nella lista
                settings.links.forEach(url => addVideo(url));
            } else {
                // Se l'utente dice no, pulisce i link salvati
                ipcRenderer.send("save-settings", { links: [], options: settings.options || {} });
            }
        });
    }

    // Ripristina le opzioni salvate (audioOnly, convertMkv, playlist)
    if (settings.options) {
        const options = settings.options;
        document.getElementById("audioOnlyChk").checked = options.audioOnly || false;
        document.getElementById("convertMkvChk").checked = options.convertMkv || false;
        if (document.getElementById("playlistChk")) {
            document.getElementById("playlistChk").checked = options.playlist || false;
        }
    }

    // Imposta cartella di download e tema
    downloadFolder = settings.downloadFolder || downloadFolder;
    if (folderInput) folderInput.value = downloadFolder || "";
    const theme = settings.theme || "dark";
    document.body.dataset.theme = theme;
    themeToggle.textContent = theme === "dark" ? "🌙" : "☀️";

    // Carica i percorsi dei binari (yt-dlp, ffmpeg)
    binPaths = await ipcRenderer.invoke("get-bin-paths");
});

// ====== Funzione popup personalizzato ======
function showPopup() {
    return new Promise(resolve => {
        const overlay = document.getElementById("popupOverlay");
        const yesBtn = document.getElementById("popupYes");
        const noBtn = document.getElementById("popupNo");

        // Disabilita bottoni lingua e themeToggle
        document.querySelectorAll(".lang-btn").forEach(btn => btn.disabled = true);
        document.getElementById("themeToggle").disabled = true;

        overlay.style.opacity = 0;
        overlay.style.display = "flex";
        requestAnimationFrame(() => { overlay.style.transition = "opacity 0.3s"; overlay.style.opacity = 1; });

        const closePopup = (choice) => {
            overlay.style.opacity = 0;
            setTimeout(() => { 
                overlay.style.display = "none"; 
                // Riabilita bottoni lingua e themeToggle
                document.querySelectorAll(".lang-btn").forEach(btn => btn.disabled = false);
                document.getElementById("themeToggle").disabled = false;
                resolve(choice); 
            }, 300);
        };

        yesBtn.onclick = () => closePopup("yes");
        noBtn.onclick = () => closePopup("no");
    });
}





// ----------- THEME -----------
themeToggle.addEventListener("click", () => {
    const newTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
    document.body.dataset.theme = newTheme;
    themeToggle.textContent = newTheme === "dark" ? "🌙" : "☀️";
    ipcRenderer.send("set-theme", newTheme);
});

// ----------- FOLDER BUTTONS -----------
openFolderBtn.addEventListener("click", () => ipcRenderer.invoke("open-folder"));
setFolderBtn.addEventListener("click", async () => {
    const folder = await ipcRenderer.invoke("set-folder");
    if (folder) {
        ipcRenderer.invoke("save-download-folder", folder).then(savedFolder => {
            downloadFolder = savedFolder;
            if (folderInput) folderInput.value = savedFolder;
            saveSettingsToMain();
        });
    }
});

// ----------- CHECKBOX INTERLOCK LOGIC -----------
// audio <-> convert MKV are mutually exclusive
audioOnlyChk.addEventListener("change", () => {
    if (audioOnlyChk.checked) {
        convertMkvChk.checked = false;
        convertMkvChk.disabled = true;
    } else {
        convertMkvChk.disabled = false;
    }
    saveSettingsToMain();
});

convertMkvChk.addEventListener("change", () => {
    if (convertMkvChk.checked) {
        audioOnlyChk.checked = false;
        audioOnlyChk.disabled = true;
    } else {
        audioOnlyChk.disabled = false;
    }
    saveSettingsToMain();
});

// playlist: allow audioOnly, but disable convertMkv (we assume MKV conversion for single video only)
playlistChk.addEventListener("change", () => {
    if (playlistChk.checked) {
        // allow audioOnly, disable convert MKV
        convertMkvChk.checked = false;
        convertMkvChk.disabled = true;
    } else {
        convertMkvChk.disabled = false;
    }
    saveSettingsToMain();
});

// ----------- ADD / RENDER VIDEO LIST -----------
function addVideo(url) {
    if (!url) return;
    url = url.trim();
    if (!url) return;

    if (videos.find(v => v.url === url)) return;

    const video = {
        url,
        title: "Caricamento...",
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

// Oggetto con le traduzioni
const i18n = {
    it: {
        download: "Download",
        remove: "Rimuovi",
        bestQuality: "Migliore disponibile",
        quality: "🎞️",
        downloadArrow: "⬇️",
        durationClock: "⏱️",
        openFolder: "📁 Apri Cartella",
        setFolder: "📁 Seleziona Cartella",
		clearList: "❌ Cancella Lista",
		reloadListTitle: "Vuoi ricaricare la lista salvata dei link?",
		popupYes: "SI",
		popupNo: "NO"
    },
    en: {
        download: "Download",
        remove: "Remove",
        bestQuality: "Best available",
        quality: "🎞️",
        downloadArrow: "⬇️",
        durationClock: "⏱️",
        openFolder: "📁 Open Folder",
        setFolder: "📁 Select Folder",
		clearList: "❌ Clear List",
		reloadListTitle: "Do you want to reload the saved list of links?",
		popupYes: "YES",
		popupNo: "NO"
    }
};

// Imposta lingua corrente


function updateFolderButtonText() {
    openFolderBtn.textContent = i18n[currentLang].openFolder;
    setFolderBtn.textContent = i18n[currentLang].setFolder;
	clearListBtn.textContent = i18n[currentLang].clearList;
}



// Chiami subito per impostare testo iniziale
updateFolderButtonText();

function renderVideos() {
    videoList.innerHTML = "";
    videos.forEach((video, index) => {
        const div = document.createElement("div");
        div.className = "video-item";
        div.dataset.pid = video.pid;
        div.draggable = true;

        // 🔹 aggiunta qui: se c’è formato selezionato, mostralo come badge
        if (video.format) {
            div.setAttribute("data-quality", video.format);
        }
		
		

        const thumb = video.thumbnail 
            ? `<img src="${video.thumbnail}" class="thumbnail" title="${video.url}">` 
            : `<div class="spinner"></div>`;

        const formatOptions = video.formats 
            ? video.formats.map(f =>
                `<option value="${f.format_id}">${f.format_id} (${f.ext})${f.sizeStr ? ' - ' + f.sizeStr : ''}</option>`
              ).join('')
            : '';

const durationLabel = video.duration ? `${i18n[currentLang].durationClock} ${video.duration}` : "";

div.innerHTML = `
    ${thumb}
    <div class="video-info">
        <strong>${escapeHtml(video.title)}</strong>
        <div class="status">${video.status || ""}</div>
<label>${i18n[currentLang].quality}
    <select class="quality-select" onchange="setFormat(${index}, this.value)">
        <option value="">${i18n[currentLang].bestQuality}</option>
        ${formatOptions}
    </select>
</label>
        <div class="duration">${durationLabel}</div>
        <div class="download-details">${i18n[currentLang].downloadArrow}</div>
        <div class="progress-container" style="width:100%; height:8px; background:#383838; border-radius:4px; margin-top:20px; overflow:hidden;">
            <div class="progress-bar" style="width:0%; height:100%; background:#2196F3; transition: width 0.2s ease;"></div>
        </div>
    </div>
    <div class="video-buttons">
        <button class="download-btn" onclick="downloadVideo(${index})">${i18n[currentLang].download}</button>
        <button class="remove-btn" onclick="removeVideo(${index})">${i18n[currentLang].remove}</button>
    </div>
`;

        videoList.appendChild(div);
    });

    clearListBtn.style.display = videos.length > 0 ? "inline-block" : "none";
    addDragAndDropHandlers();
}

window.setFormat = (index, formatId) => {
    if (!videos[index]) return;

    // Aggiorna il formato nel video
    videos[index].format = formatId;

    // Trova il div corrispondente
    const videoDiv = document.querySelector(`.video-item[data-pid="${videos[index].pid}"]`);
    if (!videoDiv) return;

    // Aggiorna il badge qualità
    if (formatId) {
        videoDiv.setAttribute("data-quality", formatId);
    } else {
        videoDiv.removeAttribute("data-quality");
    }
	    // Test rapido: log in console
   // console.log(`Video #${index} format:`, formatId, "data-quality attr:", videoDiv.getAttribute("data-quality"));
};


window.removeVideo = (index) => {
    const video = videos[index];
    if (!video) return;
    if (clipboard.readText().trim() === video.url) clipboard.writeText("");
    videos.splice(index, 1);
    renderVideos();
    saveSettingsToMain();
};
function setLanguage(lang) {
	localStorage.setItem("lang", lang); // 🔹 salva scelta
    currentLang = lang;
	updateTexts(); 
    updateFolderButtonText(); // aggiorna i pulsanti generali
    renderVideos();           // aggiorna testi dei video
    saveSettingsToMain();     // salva lingua corrente nelle impostazioni
}
clearListBtn.addEventListener("click", () => {
    videos = [];
    renderVideos();
    saveSettingsToMain();
});
// 👇 QUESTA la incolli qui nel renderer
function updateTexts() {
    // Aggiorna tutti gli elementi che hanno l’attributo data-i18n
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        el.textContent = i18n[currentLang][key];
    });

    // Aggiorna manualmente l’H3
    const reloadTitle = document.getElementById("reloadListTitle");
    if (reloadTitle) {
        reloadTitle.textContent = i18n[currentLang].reloadListTitle;
    }
	    const popupYes_ = document.getElementById("popupYes");
    if (popupYes_) {
        popupYes_.textContent = i18n[currentLang].popupYes;
    }
	    const popupNO_ = document.getElementById("popupNO");
    if (popupNO_) {
        popupNO_.textContent = i18n[currentLang].popupNO;
    }
}
document.addEventListener("DOMContentLoaded", updateTexts);
// ---------- CLIPBOARD MONITOR ----------
/*
setInterval(() => {
    const text = clipboard.readText().trim();
    if (text.startsWith("http") && !videos.find(v => v.url === text)) addVideo(text);
}, 1000);
*/

// ---------- DRAG & DROP FILE INTO TEXTAREA ----------
if (urlArea) {
    urlArea.addEventListener("dragover", e => { e.preventDefault(); urlArea.style.border = "2px dashed #007ACC"; });
    urlArea.addEventListener("dragleave", e => { e.preventDefault(); urlArea.style.border = ""; });
    urlArea.addEventListener("drop", e => {
        e.preventDefault();
        urlArea.style.border = "";
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (file.type === "text/plain" || file.name.endsWith(".txt")) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target.result.trim();
                const urls = content.split(/\r?\n/).map(u => u.trim()).filter(u => u);
                urls.forEach(url => addVideo(url));
            };
            reader.readAsText(file);
        } else {
            alert("Trascina un file di testo (.txt) con i link, uno per riga.");
        }
    });
}

// ---------- FETCH VIDEO DETAILS (yt-dlp -j) ----------
function fetchVideoDetails(video) {
    if (!binPaths || !binPaths.ytDlp) return;
    const args = ["-j"];
    if (!playlistChk.checked) args.push("--no-playlist");
    args.push(video.url);

    const proc = spawn(binPaths.ytDlp, args);
    let dataStr = "";

    proc.stdout.on("data", chunk => dataStr += chunk.toString());
    proc.stderr.on("data", chunk => {
        // sometimes yt-dlp prints progress to stderr; ignore for detail fetch
        // console.error("yt-dlp fetch err:", chunk.toString());
    });

    proc.on("close", () => {
        try {
            const info = JSON.parse(dataStr);
            video.title = info.title || video.title;
			video.thumbnail = info.thumbnail?.replace(/hqdefault/, 'maxresdefault') || info.thumbnail;
            video.duration = info.duration_string || "";
            video.formats = info.formats || [];
            video.formats = video.formats.map(f => {
                let sizeStr = '';
                if (f.filesize || f.filesize_approx) {
                    let bytes = f.filesize || f.filesize_approx;
                    if (bytes < 1024*1024) sizeStr = (bytes/1024).toFixed(1) + ' KB';
                    else if (bytes < 1024*1024*1024) sizeStr = (bytes/(1024*1024)).toFixed(1) + ' MB';
                    else sizeStr = (bytes/(1024*1024*1024)).toFixed(2) + ' GB';
                }
                return { ...f, sizeStr };
            });
        } catch (e) {
            console.error("Errore parsing info:", e);
        }
        renderVideos();
    });
}

// ---------- DOWNLOAD ----------

window.downloadVideo = (index) => {
    const video = videos[index];
    if (!video) return;

    const audioOnly = audioOnlyChk.checked;
    const convertMkv = convertMkvChk.checked;
    const playlist = playlistChk.checked;
    const selectedFormat = video.format || null;

    ipcRenderer.invoke("start-download", {
        ...video,
        outputDir: downloadFolder || null,
        audioOnly: audioOnly,
        recode: convertMkv ? "mkv" : null,
        playlist: playlist,
        format: selectedFormat
    });

    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    const progressBar = videoDiv.querySelector(".progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");

    if (progressBar) {
        progressBar.style.width = "0%";
        progressBar.style.backgroundColor = "#2196F3";
    }
    if (statusText) statusText.textContent = "⏳ In coda...";
    if (detailsText) detailsText.textContent = "⬇️";

    let stopBtn = videoDiv.querySelector(".stop-btn");
    if (!stopBtn) {
        stopBtn = document.createElement("button");
        stopBtn.textContent = "Stop";
        stopBtn.className = "stop-btn";
        stopBtn.onclick = () => {
            ipcRenderer.send("stop-download", video.url);
            stopBtn.disabled = true;
        };
        videoDiv.appendChild(stopBtn);
    }
    stopBtn.disabled = false;
};

// ---------- PROGRESS FROM MAIN ----------
ipcRenderer.on("download-progress", (event, { url, data }) => {
    const video = videos.find(v => v.url === url);
    if (!video) return;

    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if (!videoDiv) return;

    const progressBar = videoDiv.querySelector(".progress-bar");
    const detailsText = videoDiv.querySelector(".download-details");

    let percentMatch = data.match(/(\d+(\.\d+)?)%/);
    let percent = percentMatch ? parseFloat(percentMatch[1]) : video.progress || 0;
    let etaMatch = data.match(/ETA\s*([\d:]+)/);
    let eta = etaMatch ? etaMatch[1] : "";
    let speedMatch = data.match(/([\d\.]+[KMG]i?B\/s)/i);
    let speedStr = speedMatch ? speedMatch[0] : "";

    video.progress = percent;
    if (progressBar) progressBar.style.width = percent + "%";
    if (detailsText) detailsText.textContent = `⬇️   ${percent}%   ${speedStr}   ${eta}`;
});

// ---------- COMPLETE ----------
ipcRenderer.on("download-complete", (event, { url, code }) => {
    const video = videos.find(v => v.url === url);
    if (!video) return;
    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if (!videoDiv) return;

    const progressBar = videoDiv.querySelector(".progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");
    const stopBtn = videoDiv.querySelector(".stop-btn");

    if (progressBar) {
        progressBar.style.width = "100%";
        progressBar.style.backgroundColor = code === 0 ? "#4CAF50" : "#F44336";
    }
    if (statusText) statusText.textContent = code === 0 ? "✅ Completato" : "💀 Errore";
    if (detailsText) detailsText.textContent = code === 0 ? "⬇️   Completato" : "💀 Errore";
    if (stopBtn) stopBtn.remove();
});

// ---------- STOPPED ----------
ipcRenderer.on("download-stopped", (event, { url }) => {
    const video = videos.find(v => v.url === url);
    if (!video) return;
    const videoDiv = document.querySelector(`.video-item[data-pid="${video.pid}"]`);
    if (!videoDiv) return;

    const progressBar = videoDiv.querySelector(".progress-bar");
    const statusText = videoDiv.querySelector(".status");
    const detailsText = videoDiv.querySelector(".download-details");
    const stopBtn = videoDiv.querySelector(".stop-btn");

    if (progressBar) progressBar.style.backgroundColor = "#F44336";
    if (statusText) statusText.textContent = "⛔ Interrotto";
    if (detailsText) detailsText.textContent = "⬇️   Interrotto";
    if (stopBtn) stopBtn.disabled = true;
});

// ---------- DRAG & DROP REORDER ----------
let dragSrcEl = null;
function handleDragStart(e) { dragSrcEl = this; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/html', this.outerHTML); this.classList.add('dragging'); }
function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDragEnter() { this.classList.add('over'); }
function handleDragLeave() { this.classList.remove('over'); }
function handleDrop(e) {
    e.stopPropagation();
    if (dragSrcEl !== this) {
        const parent = this.parentNode;
        const mouseY = e.clientY;
        const targetRect = this.getBoundingClientRect();
        const insertAfter = mouseY > targetRect.top + targetRect.height / 2;
        parent.removeChild(dragSrcEl);
        if (insertAfter) this.insertAdjacentElement('afterend', dragSrcEl);
        else this.insertAdjacentElement('beforebegin', dragSrcEl);
        const newOrder = [];
        parent.querySelectorAll('.video-item').forEach(el => {
            const pid = parseInt(el.dataset.pid);
            const vid = videos.find(v => v.pid === pid);
            if (vid) newOrder.push(vid);
        });
        videos = newOrder;
        addDragAndDropHandlers();
        saveSettingsToMain();
    }
    this.classList.remove('over');
    return false;
}
function handleDragEnd() { this.classList.remove('dragging'); document.querySelectorAll('.video-item').forEach(item => item.classList.remove('over')); }
function addDragAndDropHandlers() {
    document.querySelectorAll('.video-item').forEach(item => {
        item.addEventListener('dragstart', handleDragStart, false);
        item.addEventListener('dragenter', handleDragEnter, false);
        item.addEventListener('dragover', handleDragOver, false);
        item.addEventListener('dragleave', handleDragLeave, false);
        item.addEventListener('drop', handleDrop, false);
        item.addEventListener('dragend', handleDragEnd, false);
    });
}

// ---------- UTILS ----------
function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function getOptions() {
    return {
        audioOnly: !!audioOnlyChk.checked,
        convertMkv: !!convertMkvChk.checked,
        playlist: !!playlistChk.checked
    };
}

function saveSettingsToMain() {
    const links = videos.map(v => v.url);
    const opts = getOptions();
    ipcRenderer.send("save-settings", {
        links,
        options: opts,
        downloadFolder,
        theme: document.body.dataset.theme,
        language: currentLang // salva correttamente la lingua
    });
}

// expose functions to HTML
window.addVideo = addVideo;
window.clearList = () => { videos = []; renderVideos(); saveSettingsToMain(); };

// For thumbnail display: show full image (no crop) by using object-fit: contain in CSS (see style.css)
