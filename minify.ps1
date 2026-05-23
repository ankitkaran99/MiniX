$ErrorActionPreference = "Stop"

$srcRoot = Resolve-Path "src"
$distRoot = "dist"

Get-ChildItem $srcRoot -Recurse -Filter "*.js" -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($srcRoot.Path.Length).TrimStart([char[]]@(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    ))
    $minifiedPath = [System.IO.Path]::ChangeExtension($relativePath, ".min.js")
    $outputPath = Join-Path $distRoot $minifiedPath
    $outputDir = Split-Path $outputPath

    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    npx terser $_.FullName --compress --mangle --output $outputPath
}
