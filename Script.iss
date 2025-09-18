;by AL
#define MyAppName "YT-DLP Downloader"
#define MyAppVersion "1.0"
#define MyAppExeName "YT-DLP Downloader.exe"
#define id "YTDLPD18092025"
#define AppPublisher "AL"


[Setup]
AppId={#id}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName} 
VersionInfoVersion={#MyAppVersion}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
DisableProgramGroupPage=yes
OutputBaseFilename=setup_{#MyAppName}
SetupIconFile=assets\icon.ico
SolidCompression=yes
WizardStyle=classic
Compression=none
OutputDir=.
UninstallFilesDir={app}\Unins
InternalCompressLevel=ultra
AppPublisher={#AppPublisher}
WizardSmallImageFile=assets\ws.bmp
DisableFinishedPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; 

[Files]
Source: "dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon