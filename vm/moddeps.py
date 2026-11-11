#!/usr/bin/env python3
"""Print module files (relative to /lib/modules/<ver>) needed for the given module names, dependencies first."""
import os, sys
base, names = sys.argv[1], sys.argv[2:]
deps, byname = {}, {}
for line in open(os.path.join(base, 'modules.dep')):
    k, _, v = line.partition(':')
    deps[k] = v.split()
    n = os.path.basename(k).split('.ko')[0].replace('-', '_')
    byname[n] = k
builtin = set()
try:
    for l in open(os.path.join(base, 'modules.builtin')):
        builtin.add(os.path.basename(l.strip()).split('.ko')[0].replace('-', '_'))
except FileNotFoundError:
    pass
out = []
def add(k):
    for d in deps.get(k, []):
        add(d)
    if k not in out:
        out.append(k)
for n in names:
    n = n.replace('-', '_')
    if n in byname:
        add(byname[n])
    elif n not in builtin:
        print('missing module', n, file=sys.stderr)
print('\n'.join(out))
