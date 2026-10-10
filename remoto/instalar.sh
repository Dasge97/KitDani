#!/usr/bin/env bash
# Instala la parte de KitDani para un servidor Linux: comandos kit-estado, kit-avisar y kit-kuma en ~/bin.
#
# Uso, desde la carpeta remoto/ copiada al servidor:
#   ./instalar.sh <url-de-ntfy> <tema>
# El token de ntfy no se pasa como argumento: se copia aparte a ~/.config/kit/ntfy-token (permisos 600).
set -euo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
DESTINO="$HOME/.local/share/kitdani"
mkdir -p "$DESTINO" "$HOME/bin" "$HOME/kit/estado" "$HOME/.config/kit"
chmod 700 "$HOME/.config/kit"

install -m 755 "$AQUI/kit.py" "$DESTINO/kit.py"
for c in estado avisar kuma; do
  ln -sf "$DESTINO/kit.py" "$HOME/bin/kit-$c"
done

if [ $# -ge 2 ]; then
  printf '{\n  "ntfy_url": "%s",\n  "ntfy_tema": "%s"\n}\n' "$1" "$2" > "$HOME/.config/kit/config.json"
fi

[ -f "$HOME/.config/kit/ntfy-token" ] && chmod 600 "$HOME/.config/kit/ntfy-token" \
  || echo "Falta el token: guárdalo en ~/.config/kit/ntfy-token (solo el token, permisos 600)."

echo "Instalado: ~/bin/kit-estado, ~/bin/kit-avisar, ~/bin/kit-kuma"
echo "Estados en ~/kit/estado/. Registro en ~/kit/registro.log."
