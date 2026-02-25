#!/bin/bash
# Generate config.js from Railway environment variable at deploy time
echo "Working directory: $(pwd)"
echo "MAPBOX_TOKEN set: $([ -n "$MAPBOX_TOKEN" ] && echo 'yes' || echo 'NO - MISSING')"
mkdir -p js
echo "var MAPBOX_TOKEN = '${MAPBOX_TOKEN}';" > js/config.js
echo "Config generated at js/config.js"
ls -la js/config.js
