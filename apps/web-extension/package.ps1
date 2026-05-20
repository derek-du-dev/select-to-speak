# PowerShell script to package the web extension for release (Edge/Chrome stores)
# Excludes node_modules, source files, and development tools to ensure a tiny, store-compliant package size.

Write-Output "[+] Starting Select-to-Speak extension packaging..."

# Resolve absolute paths using script root directory
$ReleaseDir = "$PSScriptRoot\release-temp"
$ZipName = "$PSScriptRoot\..\..\select-to-speak-extension.zip"

Write-Output "[+] Temp Directory: $ReleaseDir"
Write-Output "[+] Target Zip: $ZipName"

# 1. Clean previous release folders if any
if (Test-Path $ReleaseDir) {
    Remove-Item -Path $ReleaseDir -Recurse -Force
}
if (Test-Path $ZipName) {
    Remove-Item -Path $ZipName -Force
}

# 2. Create optimized release folder structure
New-Item -ItemType Directory -Path $ReleaseDir -Force > $null
New-Item -ItemType Directory -Path "$ReleaseDir\dist" -Force > $null
New-Item -ItemType Directory -Path "$ReleaseDir\assets" -Force > $null

# 3. Copy only necessary runtime assets
Write-Output "[+] Copying runtime files..."
Copy-Item -Path "$PSScriptRoot\manifest.json" -Destination "$ReleaseDir\"
Copy-Item -Path "$PSScriptRoot\background.js" -Destination "$ReleaseDir\"
Copy-Item -Path "$PSScriptRoot\content.js" -Destination "$ReleaseDir\"
Copy-Item -Path "$PSScriptRoot\options.html" -Destination "$ReleaseDir\"
Copy-Item -Path "$PSScriptRoot\options.js" -Destination "$ReleaseDir\"
Copy-Item -Path "$PSScriptRoot\dist\tailwind.css" -Destination "$ReleaseDir\dist\"
Copy-Item -Path "$PSScriptRoot\assets\logo.png" -Destination "$ReleaseDir\assets\"

# 4. Create zip archive
Write-Output "[+] Compressing files into select-to-speak-extension.zip..."
Compress-Archive -Path "$ReleaseDir\*" -DestinationPath $ZipName -Force

# 5. Clean up temporary directories
Write-Output "[+] Cleaning up temporary files..."
Remove-Item -Path $ReleaseDir -Recurse -Force

Write-Output "[*] Packaging complete! Created: select-to-speak-extension.zip at the project root."
