@echo off
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "CLIO_ENGINE_URL=http://127.0.0.1:8088"
echo Starting Clio Web Application with High-Performance Rust Engine...

:: Start Clio Rust Engine in a new window
echo Starting Clio Rust Engine on port 8088...
start "Clio Rust Engine" cmd /k "cd engine-rust && cargo run --release"

:: Start Frontend in a new window
echo Starting Frontend on port 3000...
start "Clio Frontend" cmd /k "cd frontend && npm run dev"

echo ====================================================
echo Clio is running!
echo Frontend:    http://localhost:3000
echo Rust Engine: http://localhost:8088
echo ====================================================
pause
