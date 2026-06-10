#!/bin/bash
# ============== start.sh — script de inicio rápido ==============
# Mata cualquier servidor anterior en puerto 8000 y arranca server.py.

cd "$(dirname "$0")"

# Buscar y matar procesos previos
PIDS=$(lsof -ti:8000 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "Matando procesos previos en puerto 8000: $PIDS"
  kill -9 $PIDS 2>/dev/null
  sleep 0.5
fi

# Verificar Python
if ! command -v python3 &>/dev/null; then
  echo "❌ Python 3 no está instalado. Instálalo desde https://www.python.org/"
  exit 1
fi

# Verificar que server.py existe
if [ ! -f "server.py" ]; then
  echo "❌ server.py no encontrado en $(pwd)"
  exit 1
fi

# Arrancar
echo "⚽ Mundial 2026 — arrancando servidor..."
echo ""
python3 server.py
