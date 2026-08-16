$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8000
$prefix = "http://localhost:$port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "        Family - local server" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Family: $prefix" -ForegroundColor Green
Write-Host "Закрой это окно, чтобы остановить сервер." -ForegroundColor Yellow
Write-Host ""

Start-Process $prefix

$mime = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".gif"  = "image/gif"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".webp" = "image/webp"
    ".txt"  = "text/plain; charset=utf-8"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $relative = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart("/"))

            if ([string]::IsNullOrWhiteSpace($relative)) {
                $relative = "index.html"
            }

            $relative = $relative -replace "/", [IO.Path]::DirectorySeparatorChar
            $file = Join-Path $root $relative
            $fullRoot = [IO.Path]::GetFullPath($root)
            $fullFile = [IO.Path]::GetFullPath($file)

            if (-not $fullFile.StartsWith($fullRoot, [StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $response.Close()
                continue
            }

            if ((Test-Path $file -PathType Container)) {
                $file = Join-Path $file "index.html"
            }

            if (-not (Test-Path $file -PathType Leaf)) {
                $response.StatusCode = 404
                $response.ContentType = "text/plain; charset=utf-8"
                $bytes = [Text.Encoding]::UTF8.GetBytes("404 - File not found")
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                $response.Close()
                continue
            }

            $bytes = [IO.File]::ReadAllBytes($file)
            $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()

            if ($mime.ContainsKey($ext)) {
                $response.ContentType = $mime[$ext]
            } else {
                $response.ContentType = "application/octet-stream"
            }

            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
        }
        catch {
            try {
                $response.StatusCode = 500
                $response.Close()
            } catch {}
        }
    }
}
finally {
    if ($listener) {
        $listener.Stop()
        $listener.Close()
    }
}
