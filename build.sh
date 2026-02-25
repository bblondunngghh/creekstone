#!/bin/bash
# Generate config.js from Railway environment variable at deploy time
echo "var MAPBOX_TOKEN = '${MAPBOX_TOKEN}';" > js/config.js
echo "Config generated successfully"
