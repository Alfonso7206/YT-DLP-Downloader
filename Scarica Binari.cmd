@echo off
setlocal enabledelayedexpansion

:: === Percorso della cartella app passato come parametro ===
if "%~1" neq "" (
    set "APP_DIR=%~1"
) else (
    set "APP_DIR=%~dp0Bin"
)

:: === Crea cartella app se non esiste ===
if not exist "%APP_DIR%" mkdir "%APP_DIR%"

:: === URL dei binari ===
set "YTDLP_URL=https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
set "FFMPEG_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
set "FFMPEG_ZIP=%APP_DIR%\ffmpeg.zip"

:: === Scarica yt-dlp.exe ===
echo Scaricamento yt-dlp.exe...
powershell -Command "Invoke-WebRequest -Uri '%YTDLP_URL%' -OutFile '%APP_DIR%\yt-dlp.exe'"
if errorlevel 1 (
    echo Errore nel download di yt-dlp.exe
    exit /b 1
)

:: === Mostra dimensione yt-dlp.exe in MB ===
for %%F in ("%APP_DIR%\yt-dlp.exe") do set "YTDLP_SIZE=%%~zF"
for /f "usebackq" %%M in (`powershell -Command "[math]::Round(%YTDLP_SIZE%/1MB,2)"`) do set "YTDLP_MB=%%M"
echo yt-dlp.exe dimensione: %YTDLP_MB% MB

:: === Scarica ffmpeg.zip ===
echo Scaricamento ffmpeg...
powershell -Command "Invoke-WebRequest -Uri '%FFMPEG_URL%' -OutFile '%FFMPEG_ZIP%'"
if errorlevel 1 (
    echo Errore nel download di ffmpeg.zip
    exit /b 1
)

:: === Mostra dimensione ffmpeg.zip in MB ===
for %%F in ("%FFMPEG_ZIP%") do set "FFMPEG_SIZE=%%~zF"
for /f "usebackq" %%M in (`powershell -Command "[math]::Round(%FFMPEG_SIZE%/1MB,2)"`) do set "FFMPEG_MB=%%M"
echo ffmpeg.zip dimensione: %FFMPEG_MB% MB

:: === Estrai ffmpeg ===
echo Estrazione ffmpeg...
powershell -Command "Expand-Archive -Path '%FFMPEG_ZIP%' -DestinationPath '%APP_DIR%' -Force"

:: === Copia ffmpeg.exe e ffprobe.exe direttamente nella cartella Bin ===
for /d %%D in ("%APP_DIR%\ffmpeg-*") do (
    if exist "%%D\bin\ffmpeg.exe" (
        copy /Y "%%D\bin\ffmpeg.exe" "%APP_DIR%\ffmpeg.exe" >nul
        copy /Y "%%D\bin\ffprobe.exe" "%APP_DIR%\ffprobe.exe" >nul
        echo ffmpeg.exe e ffprobe.exe copiati in %APP_DIR%
    )
)

:: === Pulizia ===
del "%FFMPEG_ZIP%" >nul 2>&1
for /d %%D in ("%APP_DIR%\ffmpeg-*") do if exist "%%D" rmdir /S /Q "%%D"

echo Installazione completata. Tutti i file sono in: %APP_DIR%
pause
endlocal
