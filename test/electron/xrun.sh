#!/bin/sh
# Run the Electron checks under a virtual display, hiding Chromium's noise.
cd "$(dirname "$0")/../.." || exit 1
xvfb-run -a -s "-screen 0 1920x1080x24" npx electron --no-sandbox --disable-gpu test/electron/run.js 2>&1 \
  | grep -v -E "GLib|dbus|Gtk|libva|viz_main|gpu_init|ui/gl|sandbox|SharpElectronLinux|trace-warnings|Fontconfig"
