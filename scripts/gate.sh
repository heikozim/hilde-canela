#!/bin/sh
# The gate of Canela, run from the root of the repository.  Every name
# follows the case rule of Hilde: values snake_case, functions
# camelCase, modules and types PascalCase (scripts/check-naming.pl).
# Exit 0 only when every step is green.
#
#     sh scripts/gate.sh
perl scripts/check-naming.pl --self-test || exit 1
perl scripts/check-naming.pl . || exit 1
echo "gate: green"
