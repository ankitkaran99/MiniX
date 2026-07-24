$ErrorActionPreference = "Stop"

$distRoot = "dist"
New-Item -ItemType Directory -Force -Path $distRoot | Out-Null

$mxFiles = @(
    "src/mx/State.js",
    "src/mx/Utils.js",
    "src/mx/Renderer.js",
    "src/mx/EventBus.js",
    "src/mx/Sanitizer.js",
    "src/mx/Provider.js",
    "src/mx/Plugin.js",
    "src/mx/Listener.js",
    "src/mx/Signal.js",
    "src/mx/Effect.js",
    "src/mx/Compiler.js",
    "src/mx/Component.js",
    "src/mx/App.js",
    "src/mx/Request.js",
    "src/mx/Exports.js"
)

$combinedPath = Join-Path $distRoot "MiniX.js"
Get-Content $mxFiles | Set-Content $combinedPath
npx terser $combinedPath --compress --mangle --output (Join-Path $distRoot "MiniX.min.js")

Get-ChildItem "src" -File -Filter "*.js" | ForEach-Object {
    $minifiedPath = [System.IO.Path]::ChangeExtension($_.Name, ".min.js")
    $outputPath = Join-Path $distRoot $minifiedPath
    npx terser $_.FullName --compress --mangle --output $outputPath
}


