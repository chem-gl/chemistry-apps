#!/bin/bash

# Obtener archivos versionados respetando .gitignore
git ls-files -z \
| grep -zEv '(^frontend/public/|^archivos/|^node_modules/|^backend/libs|(^|/)(generated|coverage)/|(^|/)coverage\.)|backend/openapi/schema.yaml|sonar*|.github/*|(^|/)*.md' \
| xargs -0 file --mime \
| grep 'text/' \
| cut -d: -f1 \
| xargs wc -l