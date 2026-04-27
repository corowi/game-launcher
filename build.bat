@echo off
title Game Launcher - Build para todos os sistemas
color 0B
cd /d "%~dp0"

echo.
echo  ============================================
echo   GAME LAUNCHER - Build multiplataforma
echo   Gera: .exe (Win) + .deb (Linux) + .dmg (Mac)
echo  ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo  [ERRO] Node.js nao encontrado!
    echo  Instale em: https://nodejs.org
    pause & exit /b 1
)

echo  [OK] Node.js: 
node --version

echo.
echo  [1/3] Instalando dependencias (Electron + builder)...
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo  [ERRO] Falha no npm install
    pause & exit /b 1
)

echo.
echo  [2/3] Gerando icones validos...
if not exist src\assets mkdir src\assets
node gerar-icone.js

echo.
echo  [3/3] Compilando para todas as plataformas...
echo  (isso pode levar alguns minutos na primeira vez)
echo.
call npm run build:all

if %errorlevel% neq 0 (
    color 0E
    echo.
    echo  [AVISO] Build completo falhou (Mac/Linux requerem ambiente especifico).
    echo  Tentando apenas Windows...
    call npm run build:win
)

echo.
color 0A
echo  ============================================
echo   Arquivos gerados em: dist\
echo.
echo   Windows : dist\Game Launcher Setup.exe
echo             dist\Game Launcher Portable.exe
echo   Linux   : dist\game-launcher.deb
echo             dist\game-launcher.AppImage
echo   Mac     : dist\Game Launcher.dmg
echo  ============================================
echo.
pause
