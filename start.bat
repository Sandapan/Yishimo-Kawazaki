@echo off
echo Demarrage du jeu Yishimo Kawazaki...
echo.

REM Lancer le backend sur toutes les interfaces réseau
start "Backend Server" cmd /k "cd backend && python -m uvicorn server:app --reload --host 0.0.0.0 --port 8000"

REM Attendre 3 secondes
timeout /t 3 /nobreak > nul

REM Lancer le frontend (HOST est maintenant dans .env)
start "Frontend Server" cmd /k "cd frontend && npm start"

echo.
echo Les deux serveurs sont lances sur le reseau !
echo Backend: http://192.168.1.98:8000
echo Frontend: http://192.168.1.98:3000
echo.
echo Fermez cette fenetre pour garder les serveurs actifs.
pause